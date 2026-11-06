/**
 * Reports this frame's direct child frames' sites to the service worker (D155), so the side panel
 * can offer Allow for embedded apps. Origins only. Sent at start, when frames are added or change
 * address (debounced), and again after an in-app route change; never when nothing changed.
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
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  later();
  return {
    // After a route change the service worker may have cleared the tab's list: send it again.
    refresh: (force = false) => (force ? report(true) : later()),
    dispose() {
      clearTimeout(timer);
      observer.disconnect();
    },
  };
}
