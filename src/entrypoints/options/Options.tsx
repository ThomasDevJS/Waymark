import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import { primaryLang, type VoiceSettings } from '../../core/voice/voice';
import { originToMatchPattern } from '../../core/url/url';
import type { LibraryState } from '../../background/discovery';
import type { Problem } from '../../core/storage/problems';
import { libraryUrlAllowed } from '../../core/sharing/library';

const library = signal<LibraryState | null>(null);
const problems = signal<Problem[]>([]);
const copied = signal(false);

/** Plain text a learner can send to the author (no server in v1). */
export function problemReport(list: Problem[]): string {
  return list
    .map((p) => `Guide: ${p.guideTitle}\nStep ${p.stepIndex + 1}: ${p.stepTitle.replace(/\*\*/g, '')}\nPage: ${p.url}\nWhen: ${new Date(p.at).toLocaleString()}`)
    .join('\n\n');
}
const libraryUrl = signal('');
const libraryBusy = signal(false);
const libraryError = signal<string | null>(null);

/** Subscribing needs the library's site as a permission, unless it sends CORS headers (SPEC). */
async function subscribe() {
  libraryError.value = null;
  let url: URL;
  try {
    url = new URL(libraryUrl.value.trim());
  } catch {
    libraryError.value = 'Enter the full address of the pack file, starting with https://';
    return;
  }
  if (!libraryUrlAllowed(url.href)) {
    libraryError.value = 'The library URL must start with https://';
    return;
  }
  libraryBusy.value = true;
  try {
    let readable = false;
    try {
      // Works when the host sends CORS headers. Kept short so the click still counts as a user
      // gesture for the permission request that may follow.
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 1500);
      readable = (await fetch(url.href, { method: 'GET', cache: 'no-store', credentials: 'omit', signal: ac.signal })).ok;
      clearTimeout(t);
    } catch {
      readable = false;
    }
    if (!readable) {
      const granted = await chrome.permissions.request({ origins: [originToMatchPattern(url.origin)] });
      if (!granted) {
        libraryError.value = 'Waymark needs access to the library site to read the pack.';
        return;
      }
    }
    library.value = await send('library.set', { url: url.href });
  } catch (e) {
    libraryError.value = e instanceof Error ? e.message : String(e);
  } finally {
    libraryBusy.value = false;
  }
}

const settings = signal<VoiceSettings | null>(null);
const voices = signal<{ voiceName: string; lang: string; remote: boolean }[]>([]);
const available = signal(true);
const lang = signal('en');
const status = signal<string | null>(null);

async function load() {
  problems.value = (await send('problems.list', {})).problems;
  library.value = await send('library.get', {});
  libraryUrl.value = library.value.url ?? '';
  settings.value = await send('voice.settings.get', {});
  const v = await send('voice.list', {});
  voices.value = v.voices;
  available.value = v.available;
}

async function update(patch: Partial<VoiceSettings>) {
  settings.value = await send('voice.settings.set', { patch });
  voices.value = (await send('voice.list', {})).voices;
}

export function Options() {
  useEffect(() => void load(), []);
  const s = settings.value;
  if (!s) return <main />;
  const forLang = voices.value.filter((v) => primaryLang(v.lang) === lang.value);
  const langs = [...new Set(['en', ...voices.value.map((v) => primaryLang(v.lang))])].sort();
  return (
    <main>
      <h1>Waymark settings</h1>
      <section class="site" aria-label="Voice">
        <h2>Voice</h2>
        {!available.value && <p role="status">This browser has no extension voice API. Guides will be read with the page's speech engine where possible.</p>}
        <label class="row">
          <input type="checkbox" data-testid="autoplay" checked={s.autoPlay} onChange={(e) => void update({ autoPlay: (e.target as HTMLInputElement).checked })} />
          Read each step aloud when it appears
        </label>
        <label class="grow">
          <span class="muted">Language</span>
          <select value={lang.value} onChange={(e) => (lang.value = (e.target as HTMLSelectElement).value)}>
            {langs.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label class="grow">
          <span class="muted">Voice for “{lang.value}” guides</span>
          <select
            data-testid="voice"
            value={s.voices[lang.value] ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              const next = { ...s.voices };
              if (v) next[lang.value] = v;
              else delete next[lang.value];
              void update({ voices: next });
            }}
          >
            <option value="">Automatic (first on-device voice)</option>
            {forLang.map((v) => (
              <option key={v.voiceName} value={v.voiceName}>
                {v.voiceName}
                {v.remote ? ' (online)' : ''}
              </option>
            ))}
          </select>
        </label>
        {forLang.length === 0 && <p class="muted">No on-device voice for this language: guides stay silent; their text still shows.</p>}
        <label class="grow">
          <span class="muted">Speed: {s.rate.toFixed(1)}×</span>
          <input type="range" min="0.5" max="2" step="0.1" value={s.rate} onChange={(e) => void update({ rate: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="row">
          <input type="checkbox" data-testid="online" checked={s.allowOnlineVoices} onChange={(e) => void update({ allowOnlineVoices: (e.target as HTMLInputElement).checked })} />
          Allow online voices
        </label>
        <p class="muted">Online voices (such as Chrome's “Google …” voices) send the step text to the voice provider. They are off by default.</p>
        <div class="row">
          <button
            type="button"
            data-testid="test-voice"
            onClick={() =>
              void send('voice.test', { lang: lang.value }).then((r) => (status.value = r.ok ? 'Playing a sample…' : 'No usable voice for this language.'))
            }
          >
            Test voice
          </button>
          {status.value && <span role="status">{status.value}</span>}
        </div>
      </section>
      <section class="site" aria-label="Team library">
        <h2>Team library</h2>
        <p class="muted">
          Subscribe to a pack file your team publishes at a fixed HTTPS address. Waymark reads it now and every 6 hours, and shows its guides as read-only team guides. Anyone with the address can read the pack.
        </p>
        <label class="grow">
          <span class="muted">Library URL</span>
          <input data-testid="library-url" type="url" placeholder="https://example.com/guides.waymark.json" value={libraryUrl.value} onInput={(e) => (libraryUrl.value = (e.target as HTMLInputElement).value)} />
        </label>
        <div class="row">
          <button type="button" class="primary" data-testid="library-subscribe" disabled={libraryBusy.value || !libraryUrl.value.trim()} onClick={() => void subscribe()}>
            {library.value?.url ? 'Save and refresh' : 'Subscribe'}
          </button>
          {library.value?.url && (
            <>
              <button type="button" data-testid="library-refresh" onClick={() => void send('library.refresh', {}).then((r) => (library.value = r))}>
                Refresh now
              </button>
              <button
                type="button"
                data-testid="library-unsubscribe"
                onClick={() =>
                  void send('library.set', { url: null }).then((r) => {
                    library.value = r;
                    libraryUrl.value = '';
                  })
                }
              >
                Unsubscribe
              </button>
            </>
          )}
        </div>
        {library.value?.url && (
          <p class="muted" role="status" data-testid="library-status">
            {library.value.lastError
              ? `Last refresh failed: ${library.value.lastError}`
              : library.value.lastFetchAt
                ? `${library.value.count} team ${library.value.count === 1 ? 'guide' : 'guides'}, refreshed ${new Date(library.value.lastFetchAt).toLocaleString()}.`
                : 'Not refreshed yet.'}
          </p>
        )}
        {libraryError.value && <p role="alert">{libraryError.value}</p>}
      </section>
      <section class="site" aria-label="Problems">
        <h2>Problems</h2>
        {problems.value.length === 0 ? (
          <p class="muted">No broken steps reported. When a guide can't find a step, the learner can press “Report broken step”; reports are listed here.</p>
        ) : (
          <>
            <ul class="guides" data-testid="problems">
              {problems.value.map((p) => (
                <li key={`${p.stepId}-${p.at}`}>
                  <strong>{p.guideTitle}</strong> · step {p.stepIndex + 1}: {p.stepTitle.replace(/\*\*/g, '')}
                  <div class="muted">
                    {p.url} · {new Date(p.at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
            <div class="row">
              <button
                type="button"
                data-testid="copy-problems"
                onClick={() => void navigator.clipboard.writeText(problemReport(problems.value)).then(() => (copied.value = true))}
              >
                {copied.value ? 'Copied' : 'Copy'}
              </button>
              <button type="button" onClick={() => void send('problems.clear', {}).then(() => (problems.value = []))}>
                Clear
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
