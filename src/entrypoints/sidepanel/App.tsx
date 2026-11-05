import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { TabInfo } from '../../core/messaging/protocol';
import { originToMatchPattern } from '../../core/url/url';
import { Recorder } from './Recorder';
import { Library } from './Library';
import { Icon } from '../../ui/Icon';

const tab = signal<TabInfo | null>(null);
const error = signal<string | null>(null);

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
    await chrome.permissions.request({ origins: [originToMatchPattern(origin)] });
  } finally {
    await refresh();
  }
}

async function revoke(origin: string) {
  await chrome.permissions.remove({ origins: [originToMatchPattern(origin)] });
  await refresh();
}

const initialEdit = new URLSearchParams(location.search).get('edit');
const launcherOn = signal<boolean | null>(null);

/** The on-page "?" launcher is off by default and turned on per site (SPEC: Discovery). */
function LauncherToggle({ origin }: { origin: string }) {
  useEffect(() => {
    void send('site.settings.get', { origin }).then((r) => (launcherOn.value = r.launcher));
  }, [origin]);
  return (
    <label class="check small">
      <input
        type="checkbox"
        role="switch"
        class="switch"
        data-testid="launcher-toggle"
        checked={!!launcherOn.value}
        onChange={(e) => void send('site.settings.set', { origin, launcher: (e.target as HTMLInputElement).checked }).then((r) => (launcherOn.value = r.launcher))}
      />
      <span>
        Show the <strong>?</strong> guide button on this site’s pages
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
          <strong>No web app in this tab</strong>
          <span class="small">Open the web app you want to guide, then click the Waymark icon in the toolbar.</span>
        </div>
      </section>
    );
  }
  return (
    <section class="card site-card" aria-label="Site access">
      <div class="card-head">
        <div class="site-id">
          <Icon name="globe" />
          <span class="origin" data-testid="site-origin">
            {t.origin}
          </span>
        </div>
        {t.granted ? <span class="badge success">Allowed</span> : <span class="badge">Not allowed</span>}
      </div>
      {t.granted ? (
        <>
          <div class="row nowrap site-options">
            <LauncherToggle origin={t.origin} />
            <button type="button" class="ghost sm push" data-testid="revoke-site" onClick={() => void revoke(t.origin!)}>
              Remove access
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="small muted">Allow Waymark on this site to record and play guides here. It sees only the sites you allow.</p>
          <div>
            <button type="button" class="primary" data-testid="allow-site" onClick={() => void allow(t.origin!)}>
              <Icon name="shield" />
              Allow on this site
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function App() {
  useEffect(() => {
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
          <Icon name="pin" size={18} />
          Waymark
        </h1>
        <button type="button" class="ghost icon" data-testid="open-settings" aria-label="Settings" title="Settings" onClick={() => void chrome.runtime.openOptionsPage()}>
          <Icon name="settings" />
        </button>
      </header>
      <main>
        {error.value && (
          <p class="alert" role="alert">
            <Icon name="error" />
            {error.value}
          </p>
        )}
        <SiteCard t={t} />
        {(t?.granted || initialEdit) && <Recorder tabId={t?.tabId ?? null} tabUrl={t?.url ?? null} initialEdit={initialEdit} />}
        {t && !t.granted && <LibraryOnly />}
      </main>
    </>
  );
}
