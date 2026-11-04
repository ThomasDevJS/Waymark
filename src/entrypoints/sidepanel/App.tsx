import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { TabInfo } from '../../core/messaging/protocol';
import { originToMatchPattern } from '../../core/url/url';
import { Recorder } from './Recorder';

const tab = signal<TabInfo | null>(null);
const error = signal<string | null>(null);

async function refresh() {
  try {
    // Test builds only: e2e tests open the panel as a tab and point it at the fixture tab.
    const testTab = __WAYMARK_TEST__ ? new URLSearchParams(location.search).get('tab') : null;
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
    <main>
      <div class="row">
        <h1 class="grow">Waymark</h1>
        <button type="button" data-testid="open-settings" onClick={() => void chrome.runtime.openOptionsPage()}>
          Settings
        </button>
      </div>
      {error.value && <p role="alert">{error.value}</p>}
      <section class="site" aria-label="Site access">
        {!t || !t.origin ? (
          <p class="muted">Open a web app and click the Waymark toolbar icon to get started.</p>
        ) : (
          <>
            <div class="origin" data-testid="site-origin">{t.origin}</div>
            {t.granted ? (
              <>
                <p>Waymark is allowed on this site.</p>
                <div>
                  <button type="button" data-testid="revoke-site" onClick={() => void revoke(t.origin!)}>
                    Remove access
                  </button>
                </div>
              </>
            ) : (
              <>
                <p class="muted">Waymark needs access to this site to record and play guides.</p>
                <div>
                  <button type="button" class="primary" data-testid="allow-site" onClick={() => void allow(t.origin!)}>
                    Allow on this site
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
      {t?.granted && <Recorder tabId={t.tabId} />}
    </main>
  );
}
