/** Content script bootstrap: one instance per frame, cleaned up when the extension context dies. */
import { send } from '../core/messaging/client';
import { contextAlive, watchContext } from './context';
import { startFrameMapping } from './frames';
import { startRecordingClient } from './recording';
import { startPlayerClient } from './player/controller';
import { startEditorClient } from './editor';
import { startLauncher, takeDeepLink } from './launcher';
import { destroyOverlay } from './overlay/host';
import { watchRoutes } from './route-watch';
import { testMark } from './test-hooks';

interface Instance {
  dispose(): void;
}

const GLOBAL_KEY = '__waymarkContent';

export function startContent(): void {
  const g = globalThis as unknown as Record<string, Instance | undefined>;
  const previous = g[GLOBAL_KEY];
  // A previous instance in this world is either a leftover from an old version or a duplicate
  // injection (registered script + executeScript). Liveness cannot be told apart reliably from
  // here, so the newest instance always takes over.
  previous?.dispose();

  const disposers: (() => void)[] = [];
  const instanceId = Math.random().toString(36).slice(2, 8);
  const instance: Instance = {
    dispose: () => {
      disposers.splice(0).forEach((d) => d());
      testMark('disposed', instanceId);
      if (g[GLOBAL_KEY] === instance) g[GLOBAL_KEY] = undefined;
    },
  };
  g[GLOBAL_KEY] = instance;

  // Deep link: read at document_start and removed at once, so hash routers never see it.
  const deepLink = window === window.top ? takeDeepLink() : null;
  const frames = startFrameMapping();
  disposers.push(frames.dispose);
  const recording = startRecordingClient(frames.framePath);
  const player = startPlayerClient({ frameToken: instanceId, framePath: frames.framePath });
  const editor = startEditorClient(frames.framePath);
  const launcher = startLauncher();
  disposers.push(recording.dispose, player.dispose, editor.dispose, launcher.dispose, destroyOverlay);
  let firstReport = true;
  disposers.push(
    watchRoutes((change) => {
      if (!contextAlive()) return;
      player.onRoute(change.url);
      send('route.report', {
        ...change,
        at: Date.now(),
        title: document.title.slice(0, 500),
        ...(change.via === 'load' ? { timeOrigin: Math.round(performance.timeOrigin) } : {}),
      })
        .then((r) => {
          recording.apply(r.recording);
          player.apply(r.run);
          if (window === window.top) {
            launcher.refresh(); // guides for this page change with in-app routes too
            if (firstReport && deepLink) launcher.offerDeepLink(deepLink);
            firstReport = false;
          }
        })
        .catch(() => undefined);
    }, (url) => {
      if (!contextAlive() || window !== window.top) return;
      send('route.report', { url, via: 'leaving', at: Date.now() }).catch(() => undefined);
    }),
  );
  disposers.push(watchContext(() => instance.dispose()));
  testMark('loaded', 'yes');
  testMark('instance', instanceId);
  if (__WAYMARK_TEST__) void probeStorage();
}

/** Test builds only: proves storage is TRUSTED_CONTEXTS (content scripts get data via the service worker). */
async function probeStorage(): Promise<void> {
  for (const area of ['local', 'session'] as const) {
    try {
      await chrome.storage[area].get(null);
      testMark(`storage-${area}`, 'allowed');
    } catch {
      testMark(`storage-${area}`, 'denied');
    }
  }
}
