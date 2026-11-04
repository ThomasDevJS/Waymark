/**
 * Route watching (SPEC: Recorder, "Navigation"): Navigation API events in the content script,
 * plus popstate/hashchange and a 500 ms URL check as a fallback. Reports each new URL once.
 */
import { testLog } from './test-hooks';

export type RouteVia = 'load' | 'navigation-api' | 'popstate' | 'hashchange' | 'poll';

export interface RouteChange {
  url: string;
  via: RouteVia;
  navigationType?: string;
}

export const ROUTE_POLL_MS = 500;

interface NavigationLike extends EventTarget {
  currentEntry?: { url?: string | null } | null;
}

export function watchRoutes(onChange: (c: RouteChange) => void): () => void {
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
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onHash);
    clearInterval(poll);
  };
}
