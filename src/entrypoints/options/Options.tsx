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
import type { ComponentChildren } from 'preact';
import { grantedSitePatterns } from '../../core/permissions/registration';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';

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

/** Sites Waymark may run on (the same list the service worker registers the content script for). */
const sites = signal<string[]>([]);
async function loadSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  sites.value = grantedSitePatterns(origins);
}

/** "https://app.example.com/*" → "https://app.example.com" */
export function sitePatternLabel(pattern: string): string {
  return pattern.replace(/\/\*$/, '');
}

const SECTIONS = [
  ['voice', 'Voice'],
  ['hd-voice', 'HD voice'],
  ['sites', 'Sites'],
  ['team-library', 'Team library'],
  ['problems', 'Problems'],
  ['about', 'About'],
] as const;

function Section({ id, title, icon, children, badge }: { id: string; title: string; icon: IconName; children: ComponentChildren; badge?: ComponentChildren }) {
  return (
    <section class="card settings-section" id={id} aria-labelledby={`${id}-title`}>
      <div class="card-head">
        <h2 id={`${id}-title`} class="section-title">
          <Icon name={icon} />
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function Options() {
  useEffect(() => {
    void load();
    void loadSites();
    chrome.permissions.onAdded.addListener(loadSites);
    chrome.permissions.onRemoved.addListener(loadSites);
    return () => {
      chrome.permissions.onAdded.removeListener(loadSites);
      chrome.permissions.onRemoved.removeListener(loadSites);
    };
  }, []);
  const s = settings.value;
  if (!s) return <main class="settings" aria-busy="true" />;
  const forLang = rankVoices(voices.value, lang.value, s.allowOnlineVoices, navigator.language);
  const inUse = pickVoice(voices.value, lang.value, s, navigator.language);
  const help = (platform.value && BETTER_VOICES[platform.value]) ?? Object.values(BETTER_VOICES).join(' ');
  const langs = [...new Set(['en', ...voices.value.map((v) => primaryLang(v.lang))])].sort();
  const lib = library.value;
  return (
    <>
      <header class="app-header">
        <h1 class="brand">
          <Icon name="pin" size={18} />
          Waymark settings
        </h1>
      </header>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Settings sections">
          <ul>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <main class="settings">
          <Section id="voice" title="Voice" icon="volume">
            {!available.value && (
              <p class="banner warn" role="status">
                <Icon name="warn" />
                <span>This browser has no extension voice API. Steps are read with the page’s speech engine where possible.</span>
              </p>
            )}
            <label class="check">
              <input type="checkbox" role="switch" class="switch" data-testid="autoplay" checked={s.autoPlay} onChange={(e) => void update({ autoPlay: (e.target as HTMLInputElement).checked })} />
              <span>
                Read each step aloud
                <span class="hint block">Learners can mute it in the tooltip.</span>
              </span>
            </label>
            <div class="field-grid">
              <label class="field">
                <span class="label">Language</span>
                <select value={lang.value} onChange={(e) => (lang.value = (e.target as HTMLSelectElement).value)}>
                  {langs.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span class="label">Voice for “{lang.value}” guides</span>
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
                  <option value="">Automatic (best voice on this device)</option>
                  {forLang.map((v) => (
                    <option key={v.voiceName} value={v.voiceName}>
                      {v.voiceName}
                      {v.remote ? ' (online)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {forLang.length === 0 && <p class="small muted">No voice on this device for this language. Guides stay silent; their text still shows.</p>}
            {useHd(hdStatus.value, lang.value) ? (
              <p class="in-use" data-testid="voice-in-use">
                <Icon name="mic" />
                <span>
                  In use: <strong>HD voice</strong> (on this device)
                </span>
              </p>
            ) : (
              available.value &&
              inUse && (
                <p class="in-use" data-testid="voice-in-use">
                  <Icon name="mic" />
                  <span>
                    In use: <strong>{inUse.voiceName}</strong>
                    {inUse.remote ? ' (online)' : ' (on this device)'}
                    {!isHighQuality(inUse) && <span class="muted"> · a basic voice; see “Get better voices” below.</span>}
                  </span>
                </p>
              )
            )}
            <label class="field">
              <span class="label">
                Speed <output class="muted">{s.rate.toFixed(1)}×</output>
              </span>
              <input type="range" min="0.5" max="2" step="0.1" value={s.rate} aria-valuetext={`${s.rate.toFixed(1)} times`} onChange={(e) => void update({ rate: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label class="check">
              <input type="checkbox" role="switch" class="switch" data-testid="online" checked={s.allowOnlineVoices} onChange={(e) => void update({ allowOnlineVoices: (e.target as HTMLInputElement).checked })} />
              <span>
                Allow online voices
                <span class="hint block">
                  Online voices (Chrome’s “Google …” and Edge’s “Online (Natural)” voices) send the step text to the voice provider. When on, natural online voices come first.
                </span>
              </span>
            </label>
            <div class="row">
              <button
                type="button"
                data-testid="test-voice"
                onClick={() => void send('voice.test', { lang: lang.value }).then((r) => (status.value = r.ok ? 'Playing a sample…' : 'No usable voice for this language.'))}
              >
                <Icon name="play" />
                Test voice
              </button>
              <span role="status" class="status-text">
                {status.value}
              </span>
            </div>
            <details data-testid="better-voices">
              <summary>Get better voices</summary>
              <p class="small muted">Waymark picks the best voice on this device by itself: names with Natural, Neural, Premium or Enhanced come first. To get one, install it in your system settings.</p>
              <p class="small muted">{help}</p>
            </details>
          </Section>

          <HdVoice />

          <Section id="sites" title="Sites" icon="globe" badge={<span class="badge">{sites.value.length}</span>}>
            <p class="small muted">Waymark runs only on these sites. Allow a new one from the side panel while you’re on it.</p>
            {sites.value.length ? (
              <ul class="list divided" data-testid="sites">
                {sites.value.map((p) => (
                  <li key={p} class="list-item">
                    <Icon name="globe" />
                    <span class="grow mono small">{sitePatternLabel(p)}</span>
                    <button type="button" class="ghost sm danger" aria-label={`Remove access to ${sitePatternLabel(p)}`} onClick={() => void chrome.permissions.remove({ origins: [p] }).then(loadSites)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div class="empty">
                <Icon name="shield" />
                <strong>No sites yet</strong>
                <span class="small">Open a web app, click the Waymark icon, then Allow on this site.</span>
              </div>
            )}
          </Section>

          <Section
            id="team-library"
            title="Team library"
            icon="library"
            badge={lib?.url ? <span class={`badge ${lib.lastError ? 'danger' : 'success'}`}>{lib.lastError ? 'Refresh failed' : 'Subscribed'}</span> : undefined}
          >
            <p class="small muted">
              Subscribe to a pack file your team publishes at a fixed HTTPS address. Waymark reads it now and every 6 hours and shows its guides as read-only team guides. Anyone with the address can read the pack.
            </p>
            <label class="field">
              <span class="label">Library URL</span>
              <input data-testid="library-url" type="url" placeholder="https://example.com/guides.waymark.json" value={libraryUrl.value} onInput={(e) => (libraryUrl.value = (e.target as HTMLInputElement).value)} />
            </label>
            <div class="row">
              <button type="button" class="primary" data-testid="library-subscribe" disabled={libraryBusy.value || !libraryUrl.value.trim()} onClick={() => void subscribe()}>
                {libraryBusy.value ? 'Reading…' : lib?.url ? 'Save and refresh' : 'Subscribe'}
              </button>
              {lib?.url && (
                <>
                  <button type="button" data-testid="library-refresh" onClick={() => void send('library.refresh', {}).then((r) => (library.value = r))}>
                    <Icon name="refresh" />
                    Refresh now
                  </button>
                  <button
                    type="button"
                    class="ghost danger"
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
            {lib?.url && (
              <p class={`status-text${lib.lastError ? ' warn' : ''}`} role="status" data-testid="library-status">
                {lib.lastError
                  ? `Last refresh failed: ${lib.lastError}`
                  : lib.lastFetchAt
                    ? `${lib.count} team ${lib.count === 1 ? 'guide' : 'guides'}, refreshed ${new Date(lib.lastFetchAt).toLocaleString()}.`
                    : 'Not refreshed yet.'}
              </p>
            )}
            {libraryError.value && (
              <p class="alert" role="alert">
                <Icon name="error" />
                {libraryError.value}
              </p>
            )}
          </Section>

          <Section id="problems" title="Problems" icon="flag" badge={problems.value.length ? <span class="badge warn">{problems.value.length}</span> : undefined}>
            {problems.value.length === 0 ? (
              <div class="empty">
                <Icon name="check" />
                <strong>No broken steps reported</strong>
                <span class="small">When a guide can’t find a step, the learner can press “Report broken step”. Reports are listed here.</span>
              </div>
            ) : (
              <>
                <ul class="list divided" data-testid="problems">
                  {problems.value.map((p) => (
                    <li key={`${p.stepId}-${p.at}`} class="list-item problem">
                      <Icon name="warn" />
                      <div class="grow">
                        <div>
                          <strong>{p.guideTitle}</strong> · step {p.stepIndex + 1}: {p.stepTitle.replace(/\*\*/g, '')}
                        </div>
                        <div class="xsmall muted">
                          <span class="mono">{p.url}</span> · {new Date(p.at).toLocaleString()}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div class="row">
                  <button type="button" data-testid="copy-problems" onClick={() => void navigator.clipboard.writeText(problemReport(problems.value)).then(() => (copied.value = true))}>
                    <Icon name="copy" />
                    {copied.value ? 'Copied' : 'Copy as text'}
                  </button>
                  <button type="button" class="ghost danger" onClick={() => void send('problems.clear', {}).then(() => (problems.value = []))}>
                    <Icon name="trash" />
                    Clear
                  </button>
                </div>
              </>
            )}
          </Section>

          <Section id="about" title="About" icon="info">
            <dl class="facts">
              <dt>Version</dt>
              <dd>{chrome.runtime.getManifest().version}</dd>
              <dt>Keyboard</dt>
              <dd>
                <kbd>Alt</kbd>+<kbd>.</kbd> next step · <kbd>Alt</kbd>+<kbd>,</kbd> previous step · <kbd>Esc</kbd> in the tooltip exits the guide
              </dd>
            </dl>
            <div class="row">
              <button type="button" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
                Change shortcuts
              </button>
            </div>
          </Section>
        </main>
      </div>
    </>
  );
}
