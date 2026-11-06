import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { TabInfo } from '../../core/messaging/protocol';
import { originToMatchPattern } from '../../core/url/url';
import { siteLabel } from '../../core/text/names';
import { Recorder, recorderBusy, showStopped } from './Recorder';
import { loadTutorialsHidden, openPractice, setTutorialsHidden, Tutorials, tutorialsHidden } from './Tutorials';
import { Library } from './Library';
import { Icon } from '../../ui/Icon';
import { Mark } from '../../ui/Mark';
import { Welcome, welcomeShown } from './Welcome';
import { HelpCard, HelpTip, toggleHelp, helpOpen } from './Help';
import { useShortcutOutcome } from './shortcut';

const tab = signal<TabInfo | null>(null);
const error = signal<string | null>(null);
const shortcutError = signal<string | null>(null);

async function refresh() {
  try {
    // ?tab=<id>: the panel opened as a page targets that tab (the full-page editor of the popup
    // fallback, and e2e tests). Only extension pages can open this URL.
    const testTab = new URLSearchParams(location.search).get('tab');
    if (testTab) {
      tab.value = await send('tab.current', { tabId: Number(testTab) });
      error.value = null;
      return;
    }
    const win = await chrome.windows.getCurrent();
    tab.value = await send('tab.current', { windowId: win.id });
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** chrome.permissions.request needs the user's click, so the panel calls it itself (SPEC A4). */
async function allow(origin: string) {
  try {
    // Already granted (a library site held only for fetching) still counts as the user's Allow (D80).
    if (await chrome.permissions.request({ origins: [originToMatchPattern(origin)] })) await send('site.allowed', { origins: [origin] });
  } finally {
    await refresh();
  }
}

async function revoke(origin: string) {
  await chrome.permissions.remove({ origins: [originToMatchPattern(origin)] });
  await refresh();
}

/** Embedded sites in this tab that Waymark can't run in yet (D155). */
const embeds = signal<{ tabId: number; origins: string[] } | null>(null);
/** Sites the user unticked in the offer: asked for only when ticked (review of D155). */
const embedsUnticked = signal<Set<string>>(new Set());
let embedsTab: number | null = null;
let embedsAsk = 0;
async function refreshEmbeds(tabId: number) {
  const ask = ++embedsAsk;
  let origins: string[] = [];
  try {
    origins = (await send('embeds.pending', { tabId })).origins;
  } catch {
    // nothing to offer
  }
  // A slower answer for a tab the panel has left, or an older ask, never overwrites (review of D155).
  if (ask === embedsAsk && tabId === embedsTab) embeds.value = { tabId, origins };
}

/** One Allow for exactly the listed sites; only the user's click asks (D155). */
async function allowEmbeds(tabId: number, origins: string[]) {
  if (!origins.length) return;
  try {
    const ok = await chrome.permissions.request({ origins: origins.map(originToMatchPattern) }).catch(() => false);
    // A site held only for fetching the library becomes a guide site now (D80).
    if (ok) await send('site.allowed', { origins });
  } finally {
    await refreshEmbeds(tabId);
  }
}

function EmbedsOffer({ tabId }: { tabId: number }) {
  useEffect(() => {
    embeds.value = null;
    embedsUnticked.value = new Set();
    embedsTab = tabId;
    void refreshEmbeds(tabId);
    const key = `embeds:${tabId}`;
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && key in changes) void refreshEmbeds(tabId);
    };
    const onPerms = () => void refreshEmbeds(tabId);
    chrome.storage.onChanged.addListener(onStorage);
    chrome.permissions.onAdded.addListener(onPerms);
    chrome.permissions.onRemoved.addListener(onPerms);
    return () => {
      if (embedsTab === tabId) embedsTab = null;
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.permissions.onAdded.removeListener(onPerms);
      chrome.permissions.onRemoved.removeListener(onPerms);
    };
  }, [tabId]);
  const e = embeds.value;
  if (!e || e.tabId !== tabId || !e.origins.length) return null;
  const chosen = e.origins.filter((o) => !embedsUnticked.value.has(o));
  return (
    <div class="banner" role="status" data-testid="embeds-offer">
      <Icon name="globe" />
      <div class="stack-sm grow">
        <span>
          This page shows content from {e.origins.length === 1 ? 'another site' : 'other sites'}. Allow Waymark there too, so you can record and play guides inside it.
        </span>
        <ul class="sites" data-testid="embeds-sites">
          {e.origins.map((o) => (
            <li key={o}>
              <label class="check small">
                <input
                  type="checkbox"
                  checked={!embedsUnticked.value.has(o)}
                  data-testid={`embed-${o}`}
                  onChange={(ev) => {
                    const next = new Set(embedsUnticked.value);
                    if ((ev.target as HTMLInputElement).checked) next.delete(o);
                    else next.add(o);
                    embedsUnticked.value = next;
                  }}
                />
                <span class="mono" title={o}>
                  {siteLabel(o)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p class="hint">Allow only sites you recognise as part of this page.</p>
        <div>
          <button type="button" class="primary sm" data-testid="allow-embeds" disabled={!chosen.length} onClick={() => void allowEmbeds(tabId, chosen)}>
            <Icon name="shield" />
            Allow {chosen.length === 1 ? 'this site' : `these ${chosen.length} sites`}
          </button>
        </div>
      </div>
    </div>
  );
}

const initialEdit = new URLSearchParams(location.search).get('edit');
const launcherOn = signal<boolean | null>(null);
/** The allowed site's options (the ? button switch and Remove access) are folded away (D120). */
const siteOptionsOpen = signal<string | null>(null); // the origin whose options are open


/** The on-page "?" launcher is on by default where a page has guides, and can be turned off per site (D150). */
function LauncherToggle({ origin }: { origin: string }) {
  useEffect(() => {
    launcherOn.value = null; // another site's value must not show, or be pressed, meanwhile
    let live = true;
    void send('site.settings.get', { origin }).then((r) => {
      if (live) launcherOn.value = r.launcher;
    });
    return () => {
      live = false;
    };
  }, [origin]);
  return (
    <label class="check small">
      <input
        type="checkbox"
        role="switch"
        class="switch"
        data-testid="launcher-toggle"
        checked={!!launcherOn.value}
        // Until this site's value is read, a press could be undone by the late reply (D150).
        disabled={launcherOn.value === null}
        onChange={(e) => void send('site.settings.set', { origin, launcher: (e.target as HTMLInputElement).checked }).then((r) => (launcherOn.value = r.launcher))}
      />
      <span>
        Show a <strong>?</strong> button on this site’s pages
        <span class="hint block">Your learners click it to find and start the guides for the page they are on.</span>
      </span>
    </label>
  );
}

/** Guides stay visible (search, import, Allow) on sites Waymark is not allowed on yet. */
function LibraryOnly() {
  return (
    <section class="card" aria-label="Guides">
      <Library tabId={null} tabUrl={null} onEdit={() => undefined} onStart={() => undefined} />
    </section>
  );
}

function SiteCard({ t }: { t: TabInfo | null }) {
  if (!t || !t.origin) {
    return (
      <section class="card site-card" aria-label="Site access">
        <div class="empty">
          <Icon name="globe" />
          <strong>Open the web app you want to guide</strong>
          <span class="small">In this tab, open the web app you want to record or play guides on. The panel follows the tab you are on.</span>
          <button type="button" class="sm" data-testid="try-practice" onClick={() => void openPractice('tour')}>
            <Icon name="tutorial" />
            Or try a tutorial
          </button>
        </div>
      </section>
    );
  }
  const host = siteLabel(t.origin);
  if (!t.granted)
    return (
      <section class="card site-card" aria-labelledby="site-title">
        <div class="card-head">
          <h2 class="site-id" id="site-title">
            <Icon name="globe" />
            <span class="origin" data-testid="site-origin" title={t.origin}>
              {host}
            </span>
          </h2>
          <span class="badge">Off here</span>
        </div>
        <p class="small">
          Waymark is off on this site. Allow it to record and play guides here.{' '}
          <HelpTip label="What does Allow do?" testid="help-allow">
            Waymark asks your browser for access to this one site. It can then highlight steps and see your clicks while you record, and only here. You can turn it off again at any time.
          </HelpTip>
        </p>
        <div>
          <button type="button" class="primary" data-testid="allow-site" onClick={() => void allow(t.origin!)}>
            <Icon name="shield" />
            Allow on this site
          </button>
        </div>
      </section>
    );
  const open = siteOptionsOpen.value === t.origin;
  return (
    <section class="card site-card compact" aria-labelledby="site-title">
      <div class="card-head">
        <h2 class="site-id" id="site-title">
          <Icon name="globe" />
          <span class="origin" data-testid="site-origin" title={t.origin}>
            {host}
          </span>
          <span class="badge success">Allowed</span>
        </h2>
        <button
          type="button"
          class="ghost sm"
          data-testid="site-options"
          aria-expanded={open}
          aria-controls={open ? 'site-options' : undefined}
          onClick={() => (siteOptionsOpen.value = open ? null : t.origin)}
        >
          Site options
          <Icon name="chevron-down" class="chev" />
        </button>
      </div>
      {t.tabId !== null && <EmbedsOffer tabId={t.tabId} />}
      {open && (
        <div class="site-options stack-sm unfold" id="site-options">
          <LauncherToggle origin={t.origin} />
          <div class="row">
            <button type="button" class="ghost sm danger" data-testid="revoke-site" onClick={() => void revoke(t.origin!)}>
              Turn off Waymark on this site
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function App() {
  // The recording shortcut was refused (for example on a site Waymark is not allowed on, D105).
  // Stopped: the editor opens (even if this tab's site is not allowed, it shows once one is).
  useShortcutOutcome(['error', 'started', 'stopped'], (o) => {
    shortcutError.value = o.kind === 'error' ? o.message : null;
    if (o.kind === 'stopped') showStopped(o, tab.value?.tabId ?? null);
  });
  useEffect(() => {
    loadTutorialsHidden(); // Help's "Show the tutorials again" needs it even while Tutorials isn't shown
    void refresh();
    const onChange = () => void refresh();
    chrome.tabs.onActivated.addListener(onChange);
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.permissions.onAdded.addListener(onChange);
    chrome.permissions.onRemoved.addListener(onChange);
    return () => {
      chrome.tabs.onActivated.removeListener(onChange);
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.permissions.onAdded.removeListener(onChange);
      chrome.permissions.onRemoved.removeListener(onChange);
    };
  }, []);

  const t = tab.value;
  return (
    <>
      <header class="app-header">
        <h1 class="brand">
          <Mark />
          Waymark
        </h1>
        <div class="row nowrap">
          <button type="button" class="ghost icon" data-testid="open-help" aria-label="Help" title="Help" aria-expanded={helpOpen.value} aria-controls={helpOpen.value ? 'help' : undefined} onClick={toggleHelp}>
            <Icon name="help" />
          </button>
          <button type="button" class="ghost icon" data-testid="open-settings" aria-label="Settings" title="Settings" onClick={() => void chrome.runtime.openOptionsPage()}>
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <main>
        {error.value && (
          <p class="alert" role="alert">
            <Icon name="error" />
            {error.value}
          </p>
        )}
        {shortcutError.value && (
          <p class="alert" role="alert" data-testid="shortcut-error">
            <Icon name="error" />
            <span class="grow">Recording didn’t start: {shortcutError.value}</span>
          </p>
        )}
        <HelpCard
          extra={
            <>
            {tutorialsHidden.value && (
              <li>
                <button type="button" class="ghost help-link" data-testid="help-show-tutorials" onClick={() => setTutorialsHidden(false)}>
                  <Icon name="tutorial" />
                  <span class="grow">Show the tutorials again</span>
                </button>
              </li>
            )}
            <li>
              <button
                type="button"
                class="ghost help-link"
                data-testid="help-tutorials"
                onClick={() => {
                    void openPractice('tour');
                }}
              >
                <Icon name="tutorial" />
                <span class="grow">Tutorial: how Waymark works (1 min)</span>
                <span class="visually-hidden"> (opens the tutorial page in a new tab)</span>
              </button>
            </li>
            </>
          }
        />
        <Welcome
          extra={
            <button type="button" class="ghost" data-testid="welcome-try" onClick={() => void openPractice('tour')}>
              <Icon name="tutorial" />
              Try a tutorial
            </button>
          }
        />
        {welcomeShown.value !== null && (
          <>
            <SiteCard t={t} />
            {(t?.granted || initialEdit) && <Recorder tabId={t?.tabId ?? null} tabUrl={t?.url ?? null} initialEdit={initialEdit} />}
            {t && !t.granted && <LibraryOnly />}
            {!recorderBusy.value && <Tutorials tabUrl={t?.granted && t.url ? t.url : null} />}
          </>
        )}
      </main>
    </>
  );
}
