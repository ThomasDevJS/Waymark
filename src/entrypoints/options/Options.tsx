import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import { isHighQuality, pickVoice, primaryLang, rankVoices } from '../../core/voice/voice';
import type { VoiceSettings } from '../../core/voice/settings';
import { originToMatchPattern } from '../../core/url/url';
import type { LibraryState } from '../../background/discovery';
import type { Problem } from '../../core/storage/problems';
import { libraryUrlAllowed } from '../../core/sharing/library';
import { useHd } from '../../core/voice/hd';
import { HdVoice, hdStatus } from './HdVoice';

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
      const pattern = originToMatchPattern(url.origin);
      // A site the user already allowed stays a guide site. Otherwise the grant is only for
      // fetching: mark it first, so the grant never registers the content script there (D80).
      const already = await chrome.permissions.contains({ origins: [pattern] });
      if (!already) await send('site.fetchOnly', { origin: url.origin, on: true });
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        if (!already) await send('site.fetchOnly', { origin: url.origin, on: false });
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
const platform = signal<string | null>(null);

/** Where to get better voices, per OS (chrome.runtime.getPlatformInfo().os). */
const BETTER_VOICES: Record<string, string> = {
  win: 'Windows 11: Settings → Time & language → Speech → Manage voices → Add voices adds more voices for your language; restart the browser afterwards. The natural voices you add for Narrator are only for Narrator, so browsers can’t use them. In Edge, the natural-sounding voices are the “Online (Natural)” ones: turn on Allow online voices below to use them.',
  mac: 'macOS: System Settings → Accessibility → Spoken Content → System voice → Manage Voices…, then download a Premium or Enhanced voice for your language. Restart the browser afterwards.',
  cros: 'ChromeOS: Settings → Accessibility → Text-to-Speech → Text-to-Speech voice settings, and install the voices offered for your language.',
  linux: 'Linux: the browser uses the voices of speech-dispatcher. A better speech-dispatcher voice module (for example RHVoice or Piper) sounds better than the default eSpeak, even if Waymark still calls it a basic voice.',
};

async function load() {
  problems.value = (await send('problems.list', {})).problems;
  library.value = await send('library.get', {});
  libraryUrl.value = library.value.url ?? '';
  settings.value = await send('voice.settings.get', {});
  const v = await send('voice.list', {});
  voices.value = v.voices;
  available.value = v.available;
  platform.value = (await chrome.runtime.getPlatformInfo().catch(() => null))?.os ?? null;
}

async function update(patch: Partial<VoiceSettings>) {
  settings.value = await send('voice.settings.set', { patch });
  voices.value = (await send('voice.list', {})).voices;
}

export function Options() {
  useEffect(() => void load(), []);
  const s = settings.value;
  if (!s) return <main />;
  const forLang = rankVoices(voices.value, lang.value, s.allowOnlineVoices, navigator.language);
  const inUse = pickVoice(voices.value, lang.value, s, navigator.language);
  const help = (platform.value && BETTER_VOICES[platform.value]) ?? Object.values(BETTER_VOICES).join(' ');
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
            value={forLang.some((v) => v.voiceName === s.voices[lang.value]) ? s.voices[lang.value] : ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              const next = { ...s.voices };
              if (v) next[lang.value] = v;
              else delete next[lang.value];
              void update({ voices: next });
            }}
          >
            <option value="">Automatic (best available voice)</option>
            {forLang.map((v) => (
              <option key={v.voiceName} value={v.voiceName}>
                {v.voiceName}
                {v.remote ? ' (online)' : ''}
              </option>
            ))}
          </select>
        </label>
        {forLang.length === 0 && <p class="muted">No on-device voice for this language: guides stay silent; their text still shows.</p>}
        {useHd(hdStatus.value, lang.value) ? (
          <p data-testid="voice-in-use">
            In use: <strong>HD voice</strong> (on this device)
          </p>
        ) : available.value && inUse && (
          <p data-testid="voice-in-use">
            In use: <strong>{inUse.voiceName}</strong>
            {inUse.remote ? ' (online)' : ' (on this device)'}
            {!isHighQuality(inUse) && <span class="muted"> · a basic voice; see “Get better voices” below.</span>}
          </p>
        )}
        <details data-testid="better-voices">
          <summary>Get better voices</summary>
          <p class="muted">
            Waymark picks the best voice on this device by itself: names with Natural, Neural, Premium or Enhanced first. To get one, install it in your system settings.
          </p>
          <p class="muted">{help}</p>
        </details>
        <label class="grow">
          <span class="muted">Speed: {s.rate.toFixed(1)}×</span>
          <input type="range" min="0.5" max="2" step="0.1" value={s.rate} onChange={(e) => void update({ rate: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="row">
          <input type="checkbox" data-testid="online" checked={s.allowOnlineVoices} onChange={(e) => void update({ allowOnlineVoices: (e.target as HTMLInputElement).checked })} />
          Allow online voices
        </label>
        <p class="muted">
          Online voices (such as Chrome's “Google …” voices and Edge's “Online (Natural)” voices) send the step text to the voice provider. They are off by default. When you turn them on,
          natural online voices are used first.
        </p>
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
      <HdVoice />
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
