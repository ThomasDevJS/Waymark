/**
 * Reports this frame's direct child frames' sites to the service worker (D155), so the side panel
 * can offer Allow for embedded apps. Origins only, of visible frames. Sent at start, when frames
 * are added, removed or change address (debounced), and after an in-app route change; never when
 * nothing changed. Empty when the page goes away, so a frame that is gone leaves nothing behind.
 */
import { send } from '../core/messaging/client';
import { childFrameOrigins } from '../core/frames/embeds';

const DEBOUNCE_MS = 500;

export function startEmbedReports(): { refresh(force?: boolean): void; dispose(): void } {
  let last: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report = (force = false) => {
    const origins = childFrameOrigins(document);
    const key = origins.join('\n');
    if (!force && key === last) return;
    last = key;
    send('frame.embeds', { origins }).catch(() => undefined);
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => report(), DEBOUNCE_MS);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some((n) => n instanceof Element && (n.matches('iframe, frame') || !!n.querySelector('iframe, frame')))) {
        later();
        return;
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class', 'hidden'] });
  // Leaving (or into the back/forward cache): this frame's entry goes; coming back reports again.
  const onHide = () => {
    clearTimeout(timer);
    last = '';
    send('frame.embeds', { origins: [] }).catch(() => undefined);
  };
  const onShow = (e: PageTransitionEvent) => {
    if (e.persisted) report(true);
  };
  addEventListener('pagehide', onHide);
  addEventListener('pageshow', onShow);
  later();
  return {
    refresh: (force = false) => (force ? report(true) : later()),
    dispose() {
      clearTimeout(timer);
      observer.disconnect();
      removeEventListener('pagehide', onHide);
      removeEventListener('pageshow', onShow);
    },
  };
}
