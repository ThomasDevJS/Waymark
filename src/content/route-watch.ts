/**
 * Route watching (SPEC: Recorder, "Navigation"): Navigation API events in the content script,
 * plus popstate/hashchange and a 500 ms URL check as a fallback. Reports each new URL once.
 */
import { testLog } from './test-hooks';

export type RouteVia = 'load' | 'navigation-api' | 'popstate' | 'hashchange' | 'poll' | 'leaving';

export interface RouteChange {
  url: string;
  via: RouteVia;
  navigationType?: string;
}

export const ROUTE_POLL_MS = 500;

interface NavigationLike extends EventTarget {
  currentEntry?: { url?: string | null } | null;
}

/**
 * `onLeaving` fires when a cross-document navigation starts (Navigation API `navigate`, or
 * `pagehide` as a fallback), so the service worker can tie a slow page load to the click that
 * started it.
 */
export function watchRoutes(onChange: (c: RouteChange) => void, onLeaving?: (url: string) => void): () => void {
  let last = location.href;
  const report = (via: RouteVia, navigationType?: string) => {
    testLog('nav', { via, navigationType: navigationType ?? null, url: location.href });
    if (location.href === last && via !== 'load') return;
    last = location.href;
    onChange({ url: location.href, via, ...(navigationType ? { navigationType } : {}) });
  };

  const nav = (window as Window & { navigation?: NavigationLike }).navigation;
  const onNavSuccess = () => report('navigation-api', 'navigatesuccess');
  const onEntryChange = (e: Event) => report('navigation-api', (e as Event & { navigationType?: string }).navigationType ?? 'currententrychange');
  nav?.addEventListener('currententrychange', onEntryChange);
  nav?.addEventListener('navigatesuccess', onNavSuccess);
  let left = false;
  const leaving = (url: string) => {
    if (left) return;
    left = true;
    onLeaving?.(url);
  };
  const onNavigate = (e: Event) => {
    const ev = e as Event & { destination?: { url?: string; sameDocument?: boolean } };
    if (ev.destination && ev.destination.sameDocument === false) leaving(ev.destination.url ?? location.href);
  };
  nav?.addEventListener('navigate', onNavigate);
  const onBeforeUnload = () => leaving(location.href);
  window.addEventListener('beforeunload', onBeforeUnload);
  const onPop = () => report('popstate');
  const onHash = () => report('hashchange');
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onHash);
  const poll = setInterval(() => {
    if (location.href !== last) report('poll');
  }, ROUTE_POLL_MS);

  report('load');
  return () => {
    nav?.removeEventListener('currententrychange', onEntryChange);
    nav?.removeEventListener('navigatesuccess', onNavSuccess);
    nav?.removeEventListener('navigate', onNavigate);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onHash);
    clearInterval(poll);
  };
}
