/** Content script bootstrap: one instance per frame, cleaned up when the extension context dies. */
import { send } from '../core/messaging/client';
import { contextAlive, watchContext } from './context';
import { startFrameMapping } from './frames';
import { watchRoutes } from './route-watch';
import { testMark } from './test-hooks';

interface Instance {
  alive(): boolean;
  dispose(): void;
}

const GLOBAL_KEY = '__waymarkContent';

export function startContent(): void {
  const g = globalThis as unknown as Record<string, Instance | undefined>;
  const previous = g[GLOBAL_KEY];
  if (previous) {
    if (previous.alive()) return; // already running (registered script + executeScript)
    previous.dispose(); // leftover from an old version
  }

  const disposers: (() => void)[] = [];
  const instance: Instance = {
    alive: contextAlive,
    dispose: () => {
      disposers.splice(0).forEach((d) => d());
      testMark('loaded', 'disposed');
      if (g[GLOBAL_KEY] === instance) g[GLOBAL_KEY] = undefined;
    },
  };
  g[GLOBAL_KEY] = instance;

  disposers.push(
    watchRoutes((change) => {
      if (!contextAlive()) return;
      send('route.report', change).catch(() => undefined);
    }),
  );
  disposers.push(startFrameMapping());
  disposers.push(watchContext(() => instance.dispose()));
  testMark('loaded', 'yes');
}
