/**
 * Issue #98 (D212): broken-step report links. Parsing and stripping `waymark-step`, the link in
 * the copied report, the offer rules, and the service worker's checks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeDeepLinkWithStep } from '../../src/content/launcher';
import { problemReport, reportLink } from '../../src/entrypoints/options/Options';
import { linkOffer } from '../../src/background/report-link';
import { CONTENT_ALLOWED, EXTENSION_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';
import type { ElementFingerprint, Guide } from '../../src/core/model/schema';

const take = (href: string) => {
  let replaced: string | null = null;
  const hist = { state: null, replaceState: (_s: unknown, _t: string, u: string) => void (replaced = u) } as unknown as History;
  return { link: takeDeepLinkWithStep({ href } as Location, hist), replaced };
};

describe('report links in the address (D212)', () => {
  it('reads and removes waymark-step with waymark, in the query or the hash, keeping the rest exactly', () => {
    expect(take('https://app.test/o?waymark=01ABC&waymark-step=3')).toEqual({ link: { id: '01ABC', step: 3 }, replaced: 'https://app.test/o' });
    expect(take('https://app.test/o?static&waymark=01ABC&waymark-step=2&seed=3')).toEqual({ link: { id: '01ABC', step: 2 }, replaced: 'https://app.test/o?static&seed=3' });
    expect(take('https://app.test/o?waymark-step=2&a=b%20c&waymark=01ABC')).toEqual({ link: { id: '01ABC', step: 2 }, replaced: 'https://app.test/o?a=b%20c' });
    expect(take('https://app.test/#/orders/5?waymark=01ABC&waymark-step=4')).toEqual({ link: { id: '01ABC', step: 4 }, replaced: 'https://app.test/#/orders/5' });
    expect(take('https://app.test/o?waymark=01ABC')).toEqual({ link: { id: '01ABC', step: null }, replaced: 'https://app.test/o' });
  });

  it('a malformed step number is removed and ignored: a plain deep link', () => {
    for (const bad of ['abc', '-1', '0', '1.5', '99999', '1001', '%ZZ', '']) {
      const r = take(`https://app.test/o?waymark=01ABC&waymark-step=${bad}&x=1`);
      expect(r.link, bad).toEqual({ id: '01ABC', step: null });
      expect(r.replaced, bad).toBe('https://app.test/o?x=1');
    }
    expect(take('https://app.test/o?waymark=01ABC&waymark-step=1000').link).toEqual({ id: '01ABC', step: 1000 });
  });

  it('without a valid guide id nothing is taken (the page’s address stays)', () => {
    expect(take('https://app.test/o?waymark-step=2')).toEqual({ link: null, replaced: null });
    expect(take('https://app.test/o?waymark=%3Cx%3E&waymark-step=2')).toEqual({ link: null, replaced: null });
  });
});

describe('the copied report (D212)', () => {
  const p = { guideId: '01G', guideTitle: 'Pay', stepId: 's', stepTitle: 'Click **Pay**', stepIndex: 1, url: 'https://app.test/bills', at: '2026-11-06T10:00:00Z' };
  it('adds a link per problem with only the guide id and the step number; the other lines stay', () => {
    expect(reportLink(p)).toBe('https://app.test/bills?waymark=01G&waymark-step=2');
    const text = problemReport([p]);
    expect(text).toContain('Guide: Pay\nStep 2: Click Pay\nPage: https://app.test/bills\nWhen: ');
    expect(text).toContain('\nFix it: https://app.test/bills?waymark=01G&waymark-step=2');
  });
  it('no link for a page that is not a web page', () => {
    expect(reportLink({ ...p, url: '' })).toBeNull();
    expect(reportLink({ ...p, url: 'javascript:alert(1)' })).toBeNull();
    expect(problemReport([{ ...p, url: '' }])).not.toContain('Fix it');
  });
});

const fp: ElementFingerprint = { instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Pay', text: 'Pay', cssPath: 'b', xpath: '/b', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } };
const makeGuide = (over: Partial<Guide> = {}): Guide => ({
  id: 'g1', schemaVersion: 1, revisionId: 'r1', title: 'Pay', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/', matchUrls: [],
  steps: [
    { id: 's1', kind: 'click', title: 'Click **A**', url: { kind: 'prefix', value: '/' }, target: fp, advance: 'action' },
    { id: 'n', kind: 'note', title: 'Note', url: { kind: 'prefix', value: '/' }, advance: 'next' },
    { id: 's2', kind: 'click', title: 'Click **B**', url: { kind: 'prefix', value: '/' }, target: { ...fp, text: 'B' }, advance: 'action' },
  ],
  version: 1, source: 'local', updatedAt: '', ...over,
});

describe('the offer (D212)', () => {
  it('Fix for the author’s own guide, Start from step N for a team guide or a step without an element, Start from step 1 for a gone step', () => {
    expect(linkOffer(makeGuide(), 3)).toEqual({ offer: 'fix', stepIndex: 2 });
    expect(linkOffer(makeGuide({ source: 'library' }), 3)).toEqual({ offer: 'start', stepIndex: 2 });
    expect(linkOffer(makeGuide(), 2)).toEqual({ offer: 'start', stepIndex: 1 });
    expect(linkOffer(makeGuide(), 4)).toEqual({ offer: 'no-step', stepIndex: 0 });
  });

  it('messages: launcher.fix from content only, linkOffer.fix from extension pages only, bounded', () => {
    expect(CONTENT_ALLOWED.has('launcher.fix')).toBe(true);
    expect(EXTENSION_ALLOWED.has('launcher.fix')).toBe(false);
    expect(EXTENSION_ALLOWED.has('linkOffer.fix')).toBe(true);
    expect(CONTENT_ALLOWED.has('linkOffer.fix')).toBe(false);
    const content = { id: 'ext', tab: { id: 1 }, url: 'https://app.test/', origin: 'https://app.test' };
    expect(parseMessage({ type: 'deeplink.check', payload: { guideId: 'g', step: 0 } }, content, 'ext').ok).toBe(false);
    expect(parseMessage({ type: 'deeplink.check', payload: { guideId: 'g', step: 1001 } }, content, 'ext').ok).toBe(false);
    expect(parseMessage({ type: 'deeplink.check', payload: { guideId: 'g', step: 2 } }, content, 'ext').ok).toBe(true);
    expect(parseMessage({ type: 'launcher.fix', payload: { guideId: 'g', stepIndex: -1 } }, content, 'ext').ok).toBe(false);
  });
});

// ---------- service worker ----------

let local: Record<string, unknown>;
let session: Record<string, unknown>;
let tabUrl: string;
function area(store: () => Record<string, unknown>) {
  return {
    get: vi.fn(async (k?: string | string[] | null) => {
      const s = store();
      if (k == null) return structuredClone(s);
      const keys = Array.isArray(k) ? k : [k];
      return Object.fromEntries(keys.filter((x) => x in s).map((x) => [x, structuredClone(s[x])]));
    }),
    set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store(), structuredClone(o))),
    remove: vi.fn(async (k: string | string[]) => {
      for (const x of Array.isArray(k) ? k : [k]) delete store()[x];
    }),
  };
}
beforeEach(() => {
  vi.resetModules();
  local = { 'guides:index': [] };
  session = {};
  tabUrl = 'https://app.test/';
  vi.stubGlobal('chrome', {
    storage: { local: area(() => local), session: area(() => session), onChanged: { addListener() {} } },
    tabs: { get: vi.fn(async (id: number) => ({ id, url: tabUrl, active: true, windowId: 1 })), query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined), update: vi.fn(async () => undefined) },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) },
    tts: { stop: vi.fn(), speak: vi.fn(), getVoices: vi.fn((cb?: (v: unknown[]) => void) => cb?.([])) },
    runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext/${p}` },
    permissions: { getAll: vi.fn(async () => ({ origins: ['https://app.test/*'] })), contains: vi.fn(async () => true) },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
  });
});
afterEach(() => vi.unstubAllGlobals());

type H = (p: unknown, c: unknown) => Promise<unknown>;
const ctx = (origin = 'https://app.test', frameId = 0) => ({ tabId: 7, frameId, sender: { id: 'ext', tab: { id: 7, url: `${origin}/` }, url: `${origin}/`, origin } }) as never;
async function handlers() {
  const { discoveryHandlers } = await import('../../src/background/discovery');
  const { reportLinkHandlers } = await import('../../src/background/report-link');
  return { ...discoveryHandlers, ...reportLinkHandlers } as unknown as Record<string, H>;
}

describe('the service worker (D212)', () => {
  it('deeplink.check: the offer for the sender’s site, recorded for the panel; a missing guide only with a step; another site says nothing', async () => {
    local['guide:g1'] = makeGuide();
    const h = await handlers();
    expect(await h['deeplink.check']!({ guideId: 'g1', step: 3 }, ctx())).toEqual({ guide: { id: 'g1', title: 'Pay' }, offer: 'fix', stepIndex: 2 });
    expect(session['linkOffer:7']).toMatchObject({ guideId: 'g1', offer: 'fix', stepIndex: 2, step: 3 });
    expect(await h['deeplink.check']!({ guideId: 'g1' }, ctx())).toEqual({ guide: { id: 'g1', title: 'Pay' } });
    expect(await h['deeplink.check']!({ guideId: 'nope', step: 2 }, ctx())).toEqual({ guide: null, notInLibrary: true });
    expect(await h['deeplink.check']!({ guideId: 'nope' }, ctx())).toEqual({ guide: null });
    expect(await h['deeplink.check']!({ guideId: 'g1', step: 2 }, ctx('https://other.test'))).toEqual({ guide: null, notInLibrary: true });
    expect(await h['deeplink.check']!({ guideId: 'g1' }, ctx('https://other.test'))).toEqual({ guide: null });
    expect(await h['deeplink.check']!({ guideId: 'g1', step: 2 }, ctx('https://app.test', 3))).toEqual({ guide: null });
  });

  it('launcher.fix: refused from another site, a frame, a team guide or a step without an element; otherwise the run starts at N with the pick open', async () => {
    local['guide:g1'] = makeGuide();
    const h = await handlers();
    await expect(h['launcher.fix']!({ guideId: 'g1', stepIndex: 2 }, ctx('https://other.test'))).rejects.toThrow();
    await expect(h['launcher.fix']!({ guideId: 'g1', stepIndex: 2 }, ctx('https://app.test', 3))).rejects.toThrow();
    await expect(h['launcher.fix']!({ guideId: 'g1', stepIndex: 1 }, ctx())).rejects.toThrow(/no longer exists/);
    local['guide:g1'] = makeGuide({ source: 'library' });
    await expect(h['launcher.fix']!({ guideId: 'g1', stepIndex: 2 }, ctx())).rejects.toThrow(/read-only/);
    expect(session['run:7']).toBeUndefined();
    local['guide:g1'] = makeGuide();
    session['linkOffer:7'] = { guideId: 'g1' };
    expect(await h['launcher.fix']!({ guideId: 'g1', stepIndex: 2 }, ctx())).toEqual({ status: 'started', fixing: 'when-found' });
    const run = session['run:7'] as { stepIndex: number; stepToken: string; fixWhenFound?: string };
    expect(run.stepIndex).toBe(2);
    expect(run.fixWhenFound).toBe(run.stepToken);
    expect(session['linkOffer:7']).toBeUndefined();
  });

  it('linkOffer.fix (the panel) checks the tab’s site', async () => {
    local['guide:g1'] = makeGuide();
    tabUrl = 'https://other.test/';
    const h = await handlers();
    await expect(h['linkOffer.fix']!({ tabId: 7, guideId: 'g1', stepIndex: 2 }, {})).rejects.toThrow(/isn’t in your library/);
    expect(session['run:7']).toBeUndefined();
  });

  it('launcher.start from a link starts at step N; a step the guide does not have starts at 1', async () => {
    local['guide:g1'] = makeGuide({ source: 'library' });
    const h = await handlers();
    expect(await h['launcher.start']!({ guideId: 'g1', stepIndex: 2 }, ctx())).toEqual({ status: 'started' });
    expect((session['run:7'] as { stepIndex: number }).stepIndex).toBe(2);
    delete session['run:7'];
    expect(await h['launcher.start']!({ guideId: 'g1', stepIndex: 40 }, ctx())).toEqual({ status: 'started' });
    expect((session['run:7'] as { stepIndex: number }).stepIndex).toBe(0);
  });
});

// Fixes from the independent review (D212). Each test fails on the first version.
describe('review fixes (D212)', () => {
  it('a reported page with ids in its path links to the page before the first id (the stored path has :id there)', () => {
    expect(reportLink({ guideId: 'g', stepIndex: 2, url: 'https://app.test/projects/:id/settings' })).toBe('https://app.test/projects?waymark=g&waymark-step=3');
    expect(reportLink({ guideId: 'g', stepIndex: 0, url: 'https://app.test/:id' })).toBe('https://app.test/?waymark=g&waymark-step=1');
  });

  it('a report link for another site’s guide gets the same answer as a missing one (no oracle)', async () => {
    local['guide:g1'] = makeGuide();
    const h = await handlers();
    const other = await h['deeplink.check']!({ guideId: 'g1', step: 2 }, ctx('https://other.test'));
    const missing = await h['deeplink.check']!({ guideId: 'zz', step: 2 }, ctx('https://other.test'));
    expect(other).toEqual(missing);
  });

  it('Fix step N opens the pick only once a frame finds the element; not found, the card shows and no pick opens', async () => {
    local['guide:g1'] = makeGuide();
    const h = await handlers();
    const { runHandlers } = await import('../../src/background/runs');
    const rh = runHandlers as unknown as Record<string, H>;
    await h['launcher.fix']!({ guideId: 'g1', stepIndex: 2 }, ctx());
    let run = session['run:7'] as { stepToken: string; fix?: unknown; fixWhenFound?: string };
    expect(run.fix).toBeUndefined();
    const rep = (found: boolean) => ({ stepToken: run.stepToken, frameToken: 'f', found, score: found ? 90 : 10, margin: found ? 50 : 0, instance: 'unique', pathMatches: true, strong: 3 });
    await rh['run.match']!(rep(true), ctx());
    run = session['run:7'] as typeof run;
    expect(run.fix).toBeDefined();
    expect(run.fixWhenFound).toBeUndefined();

    delete session['run:7'];
    delete session['match:7'];
    await h['launcher.fix']!({ guideId: 'g1', stepIndex: 2 }, ctx());
    run = session['run:7'] as typeof run;
    await rh['run.match']!(rep(false), ctx());
    run = session['run:7'] as typeof run;
    expect(run.fix).toBeUndefined();
    expect(run.fixWhenFound).toBeUndefined();
  });

  it('the tab that left the guide’s site before the element was found gets no pick', async () => {
    local['guide:g1'] = makeGuide();
    const h = await handlers();
    const { runHandlers } = await import('../../src/background/runs');
    await h['launcher.fix']!({ guideId: 'g1', stepIndex: 2 }, ctx());
    const run = session['run:7'] as { stepToken: string; fix?: unknown };
    tabUrl = 'https://other.test/';
    await (runHandlers as unknown as Record<string, H>)['run.match']!({ stepToken: run.stepToken, frameToken: 'f', found: true, score: 90, margin: 50, instance: 'unique', pathMatches: true, strong: 3 }, ctx());
    expect((session['run:7'] as { fix?: unknown }).fix).toBeUndefined();
  });

  it('the offer goes when a run starts in the tab (the panel’s Start too), not when its button is pressed', async () => {
    local['guide:g1'] = makeGuide({ source: 'library' });
    session['linkOffer:7'] = { guideId: 'g1' };
    const { startRunInTab } = await import('../../src/background/runs');
    tabUrl = 'https://app.test/';
    await startRunInTab(7, 'g1', false, 2);
    expect(session['linkOffer:7']).toBeUndefined();
  });

  it('the record keeps the page’s site, so the panel hides it once the tab shows another site', async () => {
    local['guide:g1'] = makeGuide();
    const h = await handlers();
    await h['deeplink.check']!({ guideId: 'g1', step: 3 }, ctx());
    expect(session['linkOffer:7']).toMatchObject({ origin: 'https://app.test' });
  });

  it('a lone waymark-step in the query does not hide a deep link in the hash', () => {
    expect(take('https://app.test/?waymark-step=2#/r?waymark=01ABC').link).toEqual({ id: '01ABC', step: null });
  });
});
