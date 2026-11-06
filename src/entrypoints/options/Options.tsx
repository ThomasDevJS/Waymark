import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import { isHighQuality, pickVoice, primaryLang, rankVoices } from '../../core/voice/voice';
import type { VoiceSettings } from '../../core/voice/settings';
import { originToMatchPattern } from '../../core/url/url';
import type { LibraryState } from '../../background/discovery';
import type { Problem } from '../../core/storage/problems';
import { libraryUrlAllowed } from '../../core/sharing/library';
import { isDriveAddress, libraryAddress } from '../../core/sharing/drive';
import { useHd } from '../../core/voice/hd';
import { HdVoice, hdStatus } from './HdVoice';
import type { ComponentChildren } from 'preact';
import { grantedSitePatterns } from '../../core/permissions/registration';
import { fetchOnlyPatterns } from '../../background/site-access';
import { Icon } from '../../ui/Icon';
import { languageName } from '../../core/text/names';
import { Mark } from '../../ui/Mark';
import type { IconName } from '../../ui/icons';
import type { DebugStatus } from '../../core/messaging/protocol';
import { ShadeSetting } from './Shade';
import { RecHoverSetting } from './RecHover';

const library = signal<LibraryState | null>(null);
const problems = signal<Problem[]>([]);
const copied = signal(false);
/** Debug log (D110): the switch, how many entries it holds, and the Copy button's state. */
const debug = signal<DebugStatus | null>(null);
const debugCopied = signal<'copied' | 'failed' | null>(null);


/** Settings opened from the panel's Help at a section (options.html#about): scroll to it once it's drawn. */
function useHashSection() {
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!/^[a-z-]{1,40}$/.test(id)) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(`${id}-title`);
      if (el || ++tries > 20) clearInterval(t);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearInterval(t);
  }, []);
}

async function loadDebug() {
  debug.value = await send('debug.get', {}).catch(() => debug.value);
}

async function copyDebug() {
  try {
    const { text } = await send('debug.text', {});
    await navigator.clipboard.writeText(text);
    debugCopied.value = 'copied';
  } catch {
    debugCopied.value = 'failed';
  }
  setTimeout(() => (debugCopied.value = null), 2500);
  await loadDebug();
}

function DebugLog() {
  const d = debug.value;
  useEffect(() => {
    // The count follows what is collected while this page is open.
    const t = setInterval(() => {
      if (debug.value?.on && document.visibilityState === 'visible') void loadDebug();
    }, 2000);
    return () => clearInterval(t);
  }, []);
  if (!d) return null;
  return (
    <div class="debug-log" data-testid="debug-log">
      <h3 class="subhead">Debug log</h3>
      <label class="check">
        <input type="checkbox" role="switch" class="switch" data-testid="debug-switch" checked={d.on} onChange={(e) => void send('debug.set', { on: (e.target as HTMLInputElement).checked }).then((r) => (debug.value = r))} />
        <span>
          Keep a debug log
          <span class="hint block">
            While this is on, Waymark notes what it decides as you record and play: which element a click picked and why, match scores, why a step did or didn’t move on. Turn it on, do what went wrong, then copy the log and paste it into your bug report. It holds step titles, element types and scores, and page addresses without anything after <span class="mono">?</span> or <span class="mono">#</span>. Never what you type. It is cleared when the browser closes.
          </span>
        </span>
      </label>
      <p class="small muted" role="status" data-testid="debug-count">
        {d.count ? `${d.count} ${d.count === 1 ? 'entry' : 'entries'} (the newest 2,000 are kept).` : d.on ? 'Nothing logged yet. Record or play a guide.' : 'Off. Nothing is being logged.'}
      </p>
      <div class="row">
        <button type="button" data-testid="debug-copy" disabled={!d.count} onClick={() => void copyDebug()}>
          {debugCopied.value === 'copied' ? (
            <span class="swap" key="copied">
              <Icon name="check" class="tick" />
              Copied
            </span>
          ) : (
            <>
              <Icon name="copy" />
              Copy debug log
            </>
          )}
        </button>
        <button type="button" class="ghost danger" data-testid="debug-clear" disabled={!d.count} onClick={() => void send('debug.clear', {}).then((r) => (debug.value = r))}>
          <Icon name="trash" />
          Clear
        </button>
        {debugCopied.value === 'failed' && (
          <span class="status-text warn" role="status">
            Couldn’t copy. Click the page first, then try again.
          </span>
        )}
      </div>
    </div>
  );
}

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
    // A Google Drive share link becomes Drive's direct download, so the access asked for below is
    // for that address (D157).
    url = new URL(libraryAddress(libraryUrl.value));
  } catch {
    libraryError.value = 'Enter the full address of the guide file, starting with https://';
    return;
  }
  if (!libraryUrlAllowed(url.href)) {
    libraryError.value = 'The pack address must start with https://';
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
  await loadDebug();
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
/** The site whose Remove is waiting for "Remove access" to be confirmed. */
const confirming = signal<string | null>(null);
const sitesError = signal<string | null>(null);
const shortcuts = signal<Record<string, string>>({});
async function loadSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  // A library site granted only to fetch the pack is not a guide site (D80): leave it out.
  sites.value = grantedSitePatterns(origins, await fetchOnlyPatterns());
}

async function removeSite(pattern: string) {
  sitesError.value = null;
  try {
    await chrome.permissions.remove({ origins: [pattern] });
  } catch (e) {
    sitesError.value = e instanceof Error ? e.message : String(e);
  }
  confirming.value = null;
  await loadSites();
  document.getElementById('sites-title')?.focus();
}

/** True when the team library is read from this site (it needed the permission: no CORS). */
export function isLibrarySite(pattern: string, libraryUrl: string | null | undefined): boolean {
  if (!libraryUrl) return false;
  try {
    return originToMatchPattern(new URL(libraryUrl).origin) === pattern;
  } catch {
    return false;
  }
}

/** "https://app.example.com/*" → "https://app.example.com" */
export function sitePatternLabel(pattern: string): string {
  return pattern.replace(/\/\*$/, '');
}

const SECTIONS = [
  ['voice', 'Voice'],
  ['hd-voice', 'HD voice'],
  ['highlight', 'Highlight'],
  ['sites', 'Sites'],
  ['team-library', 'Team library'],
  ['problems', 'Problems'],
  ['about', 'About'],
] as const;

function Section({ id, title, icon, children, badge }: { id: string; title: string; icon: IconName; children: ComponentChildren; badge?: ComponentChildren }) {
  return (
    <section class="card settings-section" id={id} aria-labelledby={`${id}-title`}>
      <div class="card-head">
        <h2 id={`${id}-title`} class="section-title" tabIndex={-1}>
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
  useHashSection();
  useEffect(() => {
    void load();
    void loadSites();
    void chrome.commands
      ?.getAll()
      .then((all) => (shortcuts.value = Object.fromEntries(all.filter((c) => c.name).map((c) => [c.name!, c.shortcut ?? '']))))
      .catch(() => undefined);
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
          <Mark />
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
                      {languageName(l)}
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

          <Section id="highlight" title="Highlight" icon="crosshair">
            <ShadeSetting />
            <RecHoverSetting />
          </Section>
          <Section id="sites" title="Sites" icon="globe" badge={<span class="badge">{sites.value.length}</span>}>
            <p class="small muted">Waymark runs only on these sites. Allow a new one from the side panel while you’re on it.</p>
            {sites.value.length ? (
              <ul class="list divided" data-testid="sites">
                {sites.value.map((p) => (
                  <li key={p} class="list-item">
                    <Icon name="globe" />
                    <span class="grow">
                      <span class="mono small">{sitePatternLabel(p)}</span>
                      {isLibrarySite(p, lib?.url) && <span class="hint block">Used to read the team library. Removing it stops library refreshes.</span>}
                    </span>
                    {confirming.value === p ? (
                      <span class="row nowrap" role="group" aria-label={`Turn off Waymark on ${sitePatternLabel(p)}?`}>
                        <button type="button" class="sm danger" ref={(b) => b?.focus()} onClick={() => void removeSite(p)}>
                          Turn off
                        </button>
                        <button type="button" class="ghost sm" onClick={() => (confirming.value = null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button" class="ghost sm danger" aria-label={`Turn off Waymark on ${sitePatternLabel(p)}`} onClick={() => (confirming.value = p)}>
                        Remove
                      </button>
                    )}
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

          {sitesError.value && (
            <p class="alert" role="alert">
              <Icon name="error" />
              {sitesError.value}
            </p>
          )}
          <Section
            id="team-library"
            title="Team library"
            icon="library"
            badge={lib?.url ? <span class={`badge ${lib.lastError ? 'danger' : 'success'}`}>{lib.lastError ? 'Refresh failed' : 'Subscribed'}</span> : undefined}
          >
            <p class="small muted">
              For teams: one person exports a Waymark guide file and puts it at a web address, for example in Google Drive (shared as “Anyone with the link”) or a shared repository. Everyone else pastes that address or Drive link here. Their side panel then shows the team’s guides, read-only, and checks for updates every 6 hours. Anyone with the address can read the file.
            </p>
            <label class="field">
              <span class="label">Address of the team’s guide file</span>
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
            {lib?.url && isDriveAddress(lib.url) && (
              <p class="hint" data-testid="library-drive">
                Google Drive file. To update it, open it in Drive and use <strong>Manage versions → Upload new version</strong>, so the link stays the same.
              </p>
            )}
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
                  <button type="button" data-testid="copy-problems" onClick={() =>
                      void navigator.clipboard.writeText(problemReport(problems.value)).then(() => {
                        copied.value = true;
                        setTimeout(() => (copied.value = false), 2000);
                      })
                    }
                  >
                    {copied.value ? (
                      <span class="swap" key="copied">
                        <Icon name="check" class="tick" />
                        Copied
                      </span>
                    ) : (
                      <>
                        <Icon name="copy" />
                        Copy as text
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    class="ghost danger"
                    onClick={() => {
                      if (confirm(`Clear ${problems.value.length === 1 ? 'this report' : `all ${problems.value.length} reports`}? Copy them first if you need them.`))
                        void send('problems.clear', {}).then(() => (problems.value = []));
                    }}
                  >
                    <Icon name="trash" />
                    Clear
                  </button>
                </div>
              </>
            )}
            <DebugLog />
          </Section>

          <Section id="about" title="About" icon="info">
            <dl class="facts">
              <dt>Version</dt>
              <dd>{chrome.runtime.getManifest().version}</dd>
              <dt>Keyboard</dt>
              <dd>
                <ul class="plain-list">
                  {(
                    [
                      ['next-step', 'Next step'],
                      ['previous-step', 'Previous step'],
                      ['exit-guide', 'Exit the guide'],
                      ['toggle-recording', 'Start or stop recording in this tab'],
                      ['_execute_action', 'Open the side panel'],
                    ] as const
                  ).map(([name, label]) => (
                    <li key={name}>
                      {label}: {shortcuts.value[name] ? <kbd>{shortcuts.value[name]}</kbd> : <span class="muted">no key set</span>}
                    </li>
                  ))}
                  <li>
                    Exit the guide from the tooltip: <kbd>Esc</kbd>
                  </li>
                </ul>
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
