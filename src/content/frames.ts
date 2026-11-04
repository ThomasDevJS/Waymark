/**
 * Content side of frame nonce mapping. Parent frames answer "hello" from their iframes with a
 * service-worker nonce; child frames send the nonce back and then learn their framePath.
 * Page postMessage is never trusted except this nonce, which the service worker verifies.
 */
import { send } from '../core/messaging/client';
import { hostSelector, openShadowRoots } from '../core/fingerprint';
import { testMark } from './test-hooks';

const HELLO = 'waymark:frame-hello';
const NONCE = 'waymark:frame-nonce';

interface FrameMsg {
  __waymark?: string;
  nonce?: unknown;
}

function findIframeFor(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source) return null;
  const roots: (Document | ShadowRoot)[] = [document, ...openShadowRoots(document)];
  for (const root of roots) {
    for (const f of Array.from(root.querySelectorAll('iframe, frame'))) {
      if ((f as HTMLIFrameElement).contentWindow === source) return f as HTMLIFrameElement;
    }
  }
  return null;
}

export function startFrameMapping(): () => void {
  let framePath: string[] | null = window === window.top ? [] : null;
  let claimed = false;
  // A frame answers its children only once its own path is known, so a nested frame never
  // claims before its parent and ends up with a broken chain.
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  if (framePath) markReady();

  const onMessage = async (e: MessageEvent) => {
    const data = e.data as FrameMsg | null;
    if (!data || typeof data !== 'object' || typeof data.__waymark !== 'string') return;
    if (data.__waymark === HELLO) {
      // A child frame wants its path: only answer for our own iframes.
      const iframe = findIframeFor(e.source);
      if (!iframe || !e.source) return;
      await ready;
      try {
        const { nonce } = await send('frame.nonce', { selector: hostSelector(iframe) });
        (e.source as Window).postMessage({ __waymark: NONCE, nonce }, '*');
      } catch {
        // extension context gone or rate limited
      }
    } else if (data.__waymark === NONCE && e.source === window.parent && window !== window.top && !claimed) {
      if (typeof data.nonce !== 'string' || data.nonce.length > 100) return;
      try {
        const { ok } = await send('frame.claim', { nonce: data.nonce });
        if (!ok) return;
        claimed = true;
        framePath = (await send('frame.path', {})).framePath;
        testMark('frame-path', JSON.stringify(framePath));
        if (framePath) markReady();
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener('message', onMessage);

  // Retry hello with backoff: the parent's script may be injected after ours.
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (window !== window.top) {
    for (const delay of [0, 500, 1500, 4000]) {
      timers.push(
        setTimeout(() => {
          if (!claimed) window.parent.postMessage({ __waymark: HELLO }, '*');
        }, delay),
      );
    }
  } else {
    testMark('frame-path', '[]');
  }

  return () => {
    window.removeEventListener('message', onMessage);
    timers.forEach(clearTimeout);
    void framePath;
  };
}
