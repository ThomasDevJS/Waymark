/**
 * Wait loop (SPEC: Element targeting, "At playback" step 6): re-run on DOM changes and route
 * changes, at most once per 100 ms, for up to 8 seconds. Observes the document and each open
 * shadow root on the step's shadowPath, because a document observer does not see inside them.
 */
import type { ElementFingerprint } from '../model/schema';
import { shadowPathLevels } from '../fingerprint/selectors';
import { matchOnce, type MatchOptions, type MatchResult } from './match';

export const WAIT_TIMEOUT_MS = 8000;
export const MIN_INTERVAL_MS = 100;
/** Safety poll for changes that produce no mutation (CSS transitions, layout). */
export const SAFETY_POLL_MS = 500;

export interface WaitOptions extends MatchOptions {
  timeoutMs?: number;
  minIntervalMs?: number;
  signal?: AbortSignal;
}

const ROUTE_EVENTS = ['popstate', 'hashchange'] as const;

export function waitForMatch(doc: Document, fp: ElementFingerprint, opts: WaitOptions = {}): Promise<MatchResult> {
  const timeoutMs = opts.timeoutMs ?? WAIT_TIMEOUT_MS;
  const minInterval = opts.minIntervalMs ?? MIN_INTERVAL_MS;
  const win = doc.defaultView;

  return new Promise<MatchResult>((resolve) => {
    let last: MatchResult = matchOnce(doc, fp, opts);
    if (last.status === 'found') return resolve(last);
    if (opts.signal?.aborted) return resolve(last);

    let done = false;
    let lastRun = Date.now();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const observed = new Set<Node>();
    const observer = new MutationObserver(() => schedule());
    const observeOpts: MutationObserverInit = { subtree: true, childList: true, attributes: true, characterData: true };

    // Every shadow root the path reaches, at every level: all twins of a host are searched.
    const observeShadowPath = () => {
      for (const level of shadowPathLevels(doc, fp.shadowPath)) {
        for (const sr of level) {
          if (observed.has(sr)) continue;
          observed.add(sr);
          observer.observe(sr, observeOpts);
        }
      }
    };

    const finish = (r: MatchResult) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(pending);
      clearTimeout(timer);
      clearInterval(poll);
      for (const ev of ROUTE_EVENTS) win?.removeEventListener(ev, schedule);
      nav?.removeEventListener('currententrychange', schedule);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };

    const run = () => {
      pending = undefined;
      if (done) return;
      lastRun = Date.now();
      observeShadowPath();
      last = matchOnce(doc, fp, opts);
      if (last.status === 'found') finish(last);
    };

    function schedule() {
      if (done || pending !== undefined) return;
      const wait = Math.max(0, minInterval - (Date.now() - lastRun));
      pending = setTimeout(run, wait);
    }

    const onAbort = () => finish(last);

    observed.add(doc);
    observer.observe(doc, observeOpts);
    observeShadowPath();
    for (const ev of ROUTE_EVENTS) win?.addEventListener(ev, schedule);
    const nav = (win as (Window & { navigation?: EventTarget }) | null)?.navigation;
    nav?.addEventListener('currententrychange', schedule);
    opts.signal?.addEventListener('abort', onAbort);
    const poll = setInterval(schedule, SAFETY_POLL_MS);
    const timer = setTimeout(() => {
      if (done) return;
      run();
      finish(last);
    }, timeoutMs);
  });
}
