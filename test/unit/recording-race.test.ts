/**
 * D67: a click's rec.step and the route report it causes may reach the service worker in either
 * order (rec.step checks site access before it queues). The result must be the same: the
 * navigation belongs to the click, so there is no "Go to …" step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRecording, type RecordingState } from '../../src/core/recorder/session';
import type { Step } from '../../src/core/model/schema';

const ORIGIN = 'https://app.test';
const target = { instance: 'unique' as const, matchCount: 1, tag: 'a', role: 'link', text: 'Orders', cssPath: 'a', xpath: '/html[1]/body[1]/a[1]', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } };
const click = (id: string): Step => ({ id, kind: 'click', title: 'Click **Orders**', url: { kind: 'pattern', value: '/' }, target, advance: 'action' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubChrome(state: RecordingState, permissionDelayMs: number, debugOn = false) {
  const session: Record<string, unknown> = { recording: state };
  const local: Record<string, unknown> = debugOn ? { debugSetting: { on: true } } : {};
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async (k: string) => (k in session ? { [k]: structuredClone(session[k]) } : {}),
        set: async (o: Record<string, unknown>) => Object.assign(session, structuredClone(o)),
        remove: async (k: string) => void delete session[k],
      },
      local: {
        get: async (k?: string | string[] | null) => {
          if (k == null) return structuredClone(local);
          const keys = Array.isArray(k) ? k : [k];
          return Object.fromEntries(keys.filter((x) => x in local).map((x) => [x, structuredClone(local[x])]));
        },
        set: async (o: Record<string, unknown>) => Object.assign(local, structuredClone(o)),
        remove: async (k: string | string[]) => (Array.isArray(k) ? k : [k]).forEach((x) => delete local[x]),
      },
    },
    permissions: {
      // The injected delay: site access is checked before rec.step reaches the write queue.
      contains: async () => {
        await sleep(permissionDelayMs);
        return true;
      },
    },
    tabs: { get: async () => ({ url: `${ORIGIN}/` }), sendMessage: async () => undefined, query: async () => [] },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
  });
  const current = () => session.recording as RecordingState;
  current.session = session;
  return current;
}

const ctx = { kind: 'content' as const, sender: { tab: { id: 7, url: `${ORIGIN}/` }, origin: ORIGIN } as chrome.runtime.MessageSender, tabId: 7, frameId: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('rec.step and route.report in either order (D67)', () => {
  it('a delayed click step still owns the in-app navigation it caused', async () => {
    const t = Date.now();
    const current = stubChrome(startRecording('Orders', 7, `${ORIGIN}/`), 60);
    const { recordingHandlers, onRouteReport } = await import('../../src/background/recording');
    const step = recordingHandlers['rec.step']!({ op: 'add', step: click('c1'), at: t }, ctx);
    const route = onRouteReport({ url: `${ORIGIN}/orders`, via: 'navigation-api', navigationType: 'push', at: t + 20 }, ctx);
    await Promise.all([step, route]);
    expect(current().steps.map((s) => s.kind)).toEqual(['click']);
  });

  it('the same with the debug log on: logging inside the queue keeps the order (D110)', async () => {
    const t = Date.now();
    const current = stubChrome(startRecording('Orders', 7, `${ORIGIN}/`), 60, true);
    const debug = await import('../../src/background/debug');
    await debug.debugReady();
    const { recordingHandlers, onRouteReport } = await import('../../src/background/recording');
    const step = recordingHandlers['rec.step']!({ op: 'add', step: click('c1'), at: t }, ctx);
    const route = onRouteReport({ url: `${ORIGIN}/orders`, via: 'navigation-api', navigationType: 'push', at: t + 20 }, ctx);
    await Promise.all([step, route]);
    expect(current().steps.map((s) => s.kind)).toEqual(['click']);
    await debug.flushDebug();
    const log = current.session.debugLog as { entries: { ev: string; d?: [string, unknown][] }[] };
    expect(log.entries.map((e) => e.ev)).toEqual(['step.added', 'nav.no-step']);
    expect(Object.fromEntries(log.entries[0]!.d ?? [])).toMatchObject({ kind: 'click', title: 'Click Orders', n: 1 });
  });

  it('the same without a delay', async () => {
    const t = Date.now();
    const current = stubChrome(startRecording('Orders', 7, `${ORIGIN}/`), 0);
    const { recordingHandlers, onRouteReport } = await import('../../src/background/recording');
    await recordingHandlers['rec.step']!({ op: 'add', step: click('c1'), at: t }, ctx);
    await onRouteReport({ url: `${ORIGIN}/orders`, via: 'navigation-api', navigationType: 'push', at: t + 20 }, ctx);
    expect(current().steps.map((s) => s.kind)).toEqual(['click']);
  });

  it('a step sent just before Stop is in the guide', async () => {
    const t = Date.now();
    stubChrome(startRecording('Orders', 7, `${ORIGIN}/`), 60);
    const { recordingHandlers } = await import('../../src/background/recording');
    const step = recordingHandlers['rec.step']!({ op: 'add', step: click('c1'), at: t }, ctx);
    const stop = recordingHandlers['rec.stop']!({}, { ...ctx, kind: 'extension' as never, tabId: undefined });
    const [, res] = await Promise.all([step, stop]);
    expect((res as { steps: Step[] } | null)?.steps.map((s) => s.id)).toEqual(['c1']);
  });

  it('route reports handled first (a redirect chain) are all taken back by the click that caused them', async () => {
    const t = Date.now();
    const current = stubChrome(startRecording('Orders', 7, `${ORIGIN}/`), 0);
    const { recordingHandlers, onRouteReport } = await import('../../src/background/recording');
    await onRouteReport({ url: `${ORIGIN}/a`, via: 'navigation-api', navigationType: 'push', at: t + 20 }, ctx);
    await onRouteReport({ url: `${ORIGIN}/b`, via: 'navigation-api', navigationType: 'push', at: t + 40 }, ctx);
    expect(current().steps.map((s) => s.kind)).toEqual(['navigate', 'navigate']);
    await recordingHandlers['rec.step']!({ op: 'add', step: click('c1'), at: t }, ctx);
    expect(current().steps.map((s) => s.kind)).toEqual(['click']);
  });

  it("a click in another tab never takes back this tab's navigation", async () => {
    const t = Date.now();
    const st = startRecording('Orders', 7, `${ORIGIN}/`);
    st.tabIds.push(8);
    st.lastUrl['8'] = `${ORIGIN}/`;
    const current = stubChrome(st, 0);
    const { recordingHandlers, onRouteReport } = await import('../../src/background/recording');
    await onRouteReport({ url: `${ORIGIN}/a`, via: 'navigation-api', navigationType: 'push', at: t + 20 }, { ...ctx, tabId: 8 });
    await recordingHandlers['rec.step']!({ op: 'add', step: click('c1'), at: t }, ctx);
    expect(current().steps.map((s) => s.kind)).toEqual(['navigate', 'click']);
  });

  it("the leaving page's own time marks the start of a full page load", async () => {
    const t = Date.now();
    const current = stubChrome(startRecording('Orders', 7, `${ORIGIN}/`), 0);
    const { onRouteReport } = await import('../../src/background/recording');
    await onRouteReport({ url: `${ORIGIN}/`, via: 'leaving', at: t - 500 }, ctx);
    expect(current().leavingAt?.['7']).toBe(t - 500);
  });

  it('a navigation long after the click is still its own step, in either order', async () => {
    const t = Date.now();
    const current = stubChrome(startRecording('Orders', 7, `${ORIGIN}/`), 60);
    const { recordingHandlers, onRouteReport } = await import('../../src/background/recording');
    // The page navigated on its own (a redirect) 3 s after the click: both are steps.
    const step = recordingHandlers['rec.step']!({ op: 'add', step: click('c1'), at: t - 3000 }, ctx);
    const route = onRouteReport({ url: `${ORIGIN}/orders`, via: 'navigation-api', navigationType: 'push', at: t }, ctx);
    await Promise.all([step, route]);
    expect(current().steps.map((s) => s.kind).sort()).toEqual(['click', 'navigate']);
  });
});

describe('event times from pages (D67)', () => {
  it('are used when plausible, and replaced by now when missing, absurd or far off', async () => {
    const { eventTime } = await import('../../src/core/recorder/session');
    const now = 1_000_000_000_000;
    expect(eventTime(now - 300, now)).toBe(now - 300);
    expect(eventTime(undefined, now)).toBe(now);
    expect(eventTime(Number.NaN, now)).toBe(now);
    expect(eventTime(now - 60_000, now)).toBe(now); // a page cannot move its click a minute back
    expect(eventTime(now + 60_000, now)).toBe(now);
    expect(eventTime(now + 5_000, now)).toBe(now); // never in the future: it would hide later navigations
  });

  it('a navigate step is taken back by an action done just before it, reported after it', async () => {
    const { applyOp, startRecording: start } = await import('../../src/core/recorder/session');
    const st = start('T', 7, `${ORIGIN}/`, 0);
    st.steps.push({ id: 'n1', kind: 'navigate', title: 'Go to Orders', url: { kind: 'pattern', value: '/orders' }, advance: 'action' });
    st.pendingNav = [{ stepId: 'n1', at: 10_000 }];
    applyOp(st, { op: 'add', step: click('c2') }, 9_900);
    expect(st.steps.map((s) => s.id)).toEqual(['c2']);
    expect(st.pendingNav).toBeUndefined();
  });

  it('a click on the page a navigation led to never takes it back, however close in time', async () => {
    const { applyOp, startRecording: start } = await import('../../src/core/recorder/session');
    const st = start('T', 7, `${ORIGIN}/`, 0);
    st.steps.push({ id: 'n1', kind: 'navigate', title: 'Go to Orders', url: { kind: 'pattern', value: '/orders' }, advance: 'action' });
    st.pendingNav = [{ stepId: 'n1', at: 10_000 }];
    applyOp(st, { op: 'add', step: { ...click('c3'), url: { kind: 'pattern', value: '/orders' } } }, 10_100);
    expect(st.steps.map((s) => s.id)).toEqual(['n1', 'c3']);
  });

  it('a navigate step is not taken back by an action done after the navigation', async () => {
    const { applyOp, startRecording: start } = await import('../../src/core/recorder/session');
    const st = start('T', 7, `${ORIGIN}/`, 0);
    st.steps.push({ id: 'n1', kind: 'navigate', title: 'Go to Orders', url: { kind: 'pattern', value: '/orders' }, advance: 'action' });
    st.pendingNav = [{ stepId: 'n1', at: 10_000 }];
    applyOp(st, { op: 'add', step: click('c2') }, 12_000); // clicked on the new page, 2 s later
    expect(st.steps.map((s) => s.id)).toEqual(['n1', 'c2']);
  });
});
