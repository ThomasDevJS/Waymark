/**
 * Issue #96 (D211): step results from real plays. Thresholds and reasons, one result per step
 * token, start over on another element, pruning on save, the service worker's recording and its
 * messages, and removal with the guide (kept while Undo is possible).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementFingerprint, Guide } from '../../src/core/model/schema';
import { FAST_PATH_STRONG, flaggedSteps, isFragile, matchStrength, LOW_MARGIN, MAX_RESULTS, pruneStats, readStats, reasonText, recordResult, stepReasons, strongCount, type GuideStats, type PlayResult } from '../../src/core/stats/plays';
import { CONTENT_ALLOWED, EXTENSION_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';
import { startRun } from '../../src/core/player/run';

const fp = (text: string, extra: Partial<ElementFingerprint> = {}): ElementFingerprint => ({
  instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: text, text, cssPath: 'div > button', xpath: '/html/body/div/button',
  ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 10, h: 10, vw: 100, vh: 100 }, ...extra,
});

const makeGuide = (over: Partial<Guide> = {}): Guide => ({
  id: 'g1', schemaVersion: 1, revisionId: 'r1', title: 'G', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/', matchUrls: [],
  steps: [
    { id: 's1', kind: 'click', title: 'Click **A**', url: { kind: 'prefix', value: '/' }, target: fp('A'), advance: 'action' },
    { id: 's2', kind: 'click', title: 'Click **B**', url: { kind: 'prefix', value: '/' }, target: fp('B'), advance: 'action' },
    { id: 'n', kind: 'note', title: 'Note', url: { kind: 'prefix', value: '/' }, advance: 'next' },
  ],
  version: 1, source: 'local', updatedAt: '', ...over,
});

const found = (strong = 3, margin = 60): PlayResult => [1, 1, 90, margin, strong];
const missed: PlayResult = [1, 0, 30, 0, 0];

let runSeq = 1_700_000_000_000;
function play(stats: GuideStats, step: Guide['steps'][number], results: PlayResult[]): GuideStats {
  let out = stats;
  // Each result its own run (its start time).
  results.forEach((r) => (out = recordResult(out, step, [++runSeq, r[1], r[2], r[3], r[4]])));
  return out;
}

describe('thresholds and reasons (D211)', () => {
  const g = makeGuide();
  const s2 = g.steps[1]!;

  it('Test step and plays share the fragile rule: one strong signal or none', () => {
    expect(strongCount(['testId', 'css', 'ancestors'])).toBe(1);
    expect(strongCount(['roleName', 'text', 'css'])).toBe(2);
    expect(isFragile(1)).toBe(true);
    expect(isFragile(0)).toBe(true);
    expect(isFragile(2)).toBe(false);
    // A unique data-guide-id or test id (the matcher's fast path) is the sturdiest find, not a fragile one.
    expect(matchStrength({ matched: ['testId'], via: 'fast-path' })).toBe(FAST_PATH_STRONG);
    expect(isFragile(matchStrength({ matched: ['testId'], via: 'fast-path' }))).toBe(false);
    expect(isFragile(matchStrength({ matched: ['testId', 'css'], via: 'score' }))).toBe(true);
  });

  it('a step found by one strong signal is flagged', () => {
    expect(stepReasons(play({}, s2, [found(1)])[s2.id]).map(reasonText)).toEqual(['Found by one signal only']);
    expect(stepReasons(play({}, s2, [found(3)])[s2.id])).toEqual([]);
  });

  it('two misses among the last 5 plays flag it; older misses do not', () => {
    expect(stepReasons(play({}, s2, [missed, found()])[s2.id])).toEqual([]);
    expect(stepReasons(play({}, s2, [missed, missed])[s2.id]).map(reasonText)).toEqual(['Not found in 2 of the last 2 plays']);
    expect(stepReasons(play({}, s2, [found(), missed, found(), missed, found(), found()])[s2.id]).map(reasonText)).toEqual(['Not found in 2 of the last 5 plays']);
    expect(stepReasons(play({}, s2, [missed, missed, found(), found(), found(), found(), found()])[s2.id])).toEqual([]);
  });

  it('a low margin is "barely ahead", except for repeated elements', () => {
    expect(stepReasons(play({}, s2, [found(3, LOW_MARGIN - 1)])[s2.id]).map(reasonText)).toEqual(['Barely ahead of a look-alike']);
    expect(stepReasons(play({}, s2, [found(3, LOW_MARGIN)])[s2.id])).toEqual([]);
    const any = { ...s2, target: fp('B', { instance: 'any' }) };
    expect(stepReasons(play({}, any, [found(3, 0)])[s2.id])).toEqual([]);
  });

  it('keeps the last 20 results', () => {
    const many = play({}, s2, Array.from({ length: 30 }, () => found()));
    expect(many[s2.id]!.r).toHaveLength(MAX_RESULTS);
  });

  it('one result per run: repeated reports, Retry, Back and on again count once, the last outcome wins; another run adds one', () => {
    const runA = (r: PlayResult): PlayResult => [111, r[1], r[2], r[3], r[4]];
    let st = recordResult({}, s2, runA(missed));
    st = recordResult(st, s2, runA(missed));
    st = recordResult(st, s2, runA(found()));
    expect(st[s2.id]!.r).toEqual([runA(found())]);
    st = recordResult(st, s2, [222, 0, 30, 0, 0]);
    expect(st[s2.id]!.r).toHaveLength(2);
    // Two tabs playing the same guide alternate: still one result per run.
    st = recordResult(st, s2, runA(missed));
    st = recordResult(st, s2, [222, 1, 90, 60, 3]);
    expect(st[s2.id]!.r).toHaveLength(2);
  });

  it('another element (Re-pick, a fix, a library refresh) starts over; pruning drops gone and changed steps', () => {
    let st = play({}, s2, [missed, missed]);
    const repicked = { ...s2, target: fp('B2') };
    st = recordResult(st, repicked, [999, 1, 90, 60, 3]);
    expect(st[s2.id]!.r).toEqual([[999, 1, 90, 60, 3]]);
    const stats = play(play({}, g.steps[0]!, [missed]), s2, [missed]);
    const pruned = pruneStats(stats, { steps: [g.steps[0]!, repicked] });
    expect(Object.keys(pruned)).toEqual(['s1']);
  });

  it('counts flagged steps; malformed stored values are dropped', () => {
    const st = play(play({}, g.steps[0]!, [found(1)]), s2, [found(3)]);
    expect(flaggedSteps(st)).toBe(1);
    expect(readStats({ s1: { t: 'x', r: [[1, 1, 'bad', 0, 0], [1, 1, 90, 60, 3]] }, s2: 'nope' })).toEqual({ s1: { t: 'x', r: [[1, 1, 90, 60, 3]] } });
  });
});

describe('messages (D211)', () => {
  it('run.match carries a bounded strong count; the stats messages are for extension pages only', () => {
    const content = { id: 'ext', tab: { id: 1 }, url: 'https://app.test/', origin: 'https://app.test' };
    const base = { stepToken: 't', frameToken: 'f', found: true, score: 80, margin: 20, instance: 'unique', pathMatches: true };
    expect(parseMessage({ type: 'run.match', payload: { ...base, strong: 2 } }, content, 'ext').ok).toBe(true);
    expect(parseMessage({ type: 'run.match', payload: { ...base, strong: 11 } }, content, 'ext').ok).toBe(false);
    expect(parseMessage({ type: 'run.match', payload: { ...base, strong: 'Save' } }, content, 'ext').ok).toBe(false);
    for (const t of ['stats.summary', 'stats.guide'] as const) {
      expect(EXTENSION_ALLOWED.has(t)).toBe(true);
      expect(CONTENT_ALLOWED.has(t)).toBe(false);
    }
  });
});

// ---------- service worker, against an in-memory chrome ----------

let local: Record<string, unknown>;
let session: Record<string, unknown>;

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
  local = {};
  session = {};
  vi.stubGlobal('chrome', {
    storage: { local: area(() => local), session: area(() => session), onChanged: { addListener() {} } },
    tabs: { get: vi.fn(async (id: number) => ({ id, url: 'https://app.test/', active: true, windowId: 1 })), query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) },
    tts: { stop: vi.fn(), speak: vi.fn(), getVoices: vi.fn((cb?: (v: unknown[]) => void) => cb?.([])) },
    runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext/${p}` },
    permissions: { getAll: vi.fn(async () => ({ origins: [] })), contains: vi.fn(async () => true) },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
    alarms: { create: vi.fn(async () => undefined) },
  });
});
afterEach(() => vi.unstubAllGlobals());

const ctx = (frameId: number, url = 'https://app.test/') => ({ tabId: 7, frameId, sender: { id: 'ext', tab: { id: 7, url }, url, origin: new URL(url).origin } }) as never;
type H = (p: unknown, c: unknown) => Promise<unknown>;

async function setup(stepIndex = 1) {
  const g = makeGuide();
  local['guide:g1'] = g;
  local['guides:index'] = [];
  const run = startRun(g, Date.now(), stepIndex);
  session['run:7'] = run;
  const { runHandlers } = await import('../../src/background/runs');
  const { statsHandlers } = await import('../../src/background/stats');
  return { run, h: { ...runHandlers, ...statsHandlers } as unknown as Record<string, H> };
}

const report = (token: string, found: boolean, extra: Record<string, unknown> = {}) => ({ stepToken: token, frameToken: 'f', found, score: found ? 88 : 20, margin: found ? 40 : 0, instance: 'unique', pathMatches: true, ...extra });
const stored = () => readStats(local['stats:g1']);

describe('recording plays (D211)', () => {
  it('the winning frame’s result is recorded once, with its strong count; repeats add nothing', async () => {
    const { run, h } = await setup();
    await h['run.match']!(report(run.stepToken, true, { strong: 1 }), ctx(0));
    await h['run.match']!(report(run.stepToken, true, { strong: 1 }), ctx(0));
    expect(stored()['s2']!.r).toHaveLength(1);
    expect(stored()['s2']!.r[0]!.slice(1)).toEqual([1, 88, 40, 1]);
    expect(await h['stats.summary']!({ ids: ['g1', 'other'] }, {})).toEqual({ counts: { g1: 1 } });
    expect(((await h['stats.guide']!({ guideId: 'g1' }, {})) as { steps: Record<string, { reasons: unknown[] }> }).steps['s2']!.reasons).toEqual([{ kind: 'one-signal' }]);
  });

  it('only the frame winner counts: a frame that did not win adds nothing', async () => {
    const { run, h } = await setup();
    await h['run.match']!(report(run.stepToken, false, { frameToken: 'f3' }), ctx(3)); // an iframe without it
    expect(local['stats:g1']).toBeUndefined();
    await h['run.match']!(report(run.stepToken, true, { strong: 3, frameToken: 'f5' }), ctx(5));
    expect(stored()['s2']!.r).toHaveLength(1);
    expect(stored()['s2']!.r[0]![4]).toBe(3);
  });

  it('not found counts only when the top frame gave up on the step’s page (the card), not on another page', async () => {
    let { run, h } = await setup();
    await h['run.match']!(report(run.stepToken, false), ctx(0, 'https://elsewhere.test/'));
    expect(local['stats:g1']).toBeUndefined();
    ({ run, h } = await setup());
    await h['run.match']!(report(run.stepToken, false), ctx(0));
    expect(stored()['s2']!.r[0]![1]).toBe(0);
    // Found after all (Retry): the same play becomes found.
    await h['run.match']!(report(run.stepToken, true, { strong: 3 }), ctx(0));
    expect(stored()['s2']!.r).toHaveLength(1);
    expect(stored()['s2']!.r[0]![1]).toBe(1);
  });

  it('a run on an old copy of the guide records nothing for a step that has another element now', async () => {
    const { run, h } = await setup();
    const g = local['guide:g1'] as Guide;
    local['guide:g1'] = { ...g, steps: [g.steps[0]!, { ...g.steps[1]!, target: fp('New') }, g.steps[2]!] };
    await h['run.match']!(report(run.stepToken, true, { strong: 1 }), ctx(0));
    expect(local['stats:g1']).toBeUndefined();
  });
});

describe('the results follow the guide (D211)', () => {
  it('saving the guide drops results of re-picked and deleted steps', async () => {
    const g = makeGuide();
    local['guide:g1'] = g;
    local['guides:index'] = [];
    local['stats:g1'] = play(play({}, g.steps[0]!, [missed, missed]), g.steps[1]!, [found(1)]);
    local['statsIndex'] = { g1: 2 };
    const { writeGuide } = await import('../../src/core/storage/guides');
    await writeGuide({ ...g, steps: [{ ...g.steps[0]!, target: fp('A2') }, g.steps[1]!] });
    expect(Object.keys(stored())).toEqual(['s2']);
    expect(local['statsIndex']).toEqual({ g1: 1 });
    await writeGuide({ ...g, steps: [g.steps[0]!] });
    expect(local['stats:g1']).toBeUndefined();
    expect(local['statsIndex']).toEqual({});
  });

  it('a deleted guide keeps its results while Undo is possible, and they go when the trash is purged', async () => {
    const g = makeGuide();
    local['guide:g1'] = g;
    local['guides:index'] = [];
    local['stats:g1'] = play({}, g.steps[1]!, [found(1)]);
    local['statsIndex'] = { g1: 1 };
    const { discoveryHandlers, purgeTrash } = await import('../../src/background/discovery');
    await (discoveryHandlers as unknown as Record<string, H>)['guide.delete']!({ id: 'g1' }, {});
    expect(local['stats:g1']).toBeDefined();
    await (discoveryHandlers as unknown as Record<string, H>)['guide.restore']!({ id: 'g1' }, {});
    expect(local['stats:g1']).toBeDefined();
    await (discoveryHandlers as unknown as Record<string, H>)['guide.delete']!({ id: 'g1' }, {});
    await purgeTrash(Date.now() + 60_000);
    expect(local['stats:g1']).toBeUndefined();
    expect(local['statsIndex']).toEqual({});
  });

  it('a guide removed without the trash (replaced by an import or the team library) loses its results at once', async () => {
    const g = makeGuide();
    local['guide:g1'] = g;
    local['guides:index'] = [];
    local['stats:g1'] = play({}, g.steps[1]!, [found(1)]);
    local['statsIndex'] = { g1: 1 };
    const { writeGuides } = await import('../../src/core/storage/guides');
    await writeGuides([], ['g1']);
    expect(local['stats:g1']).toBeUndefined();
    expect(local['statsIndex']).toEqual({});
  });
});

describe('a fix from the player (D210) resets that step’s results (D211)', () => {
  it('the fixed step starts over; the other steps keep theirs', async () => {
    await setup();
    const g = local['guide:g1'] as Guide;
    local['stats:g1'] = play(play({}, g.steps[0]!, [found(1)]), g.steps[1]!, [missed, missed]);
    local['statsIndex'] = { g1: 2 };
    const { fixHandlers } = await import('../../src/background/fix');
    const { editorHandlers } = await import('../../src/background/editor');
    const fh = { ...fixHandlers, ...editorHandlers } as unknown as Record<string, H>;
    expect(await fh['run.fix.start']!({ stepId: 's2' }, ctx(0))).toEqual({ ok: true });
    expect(await fh['pick.result']!({ target: fp('Download'), title: '' }, ctx(0))).toEqual({ ok: true });
    expect(Object.keys(stored())).toEqual(['s1']);
    expect(local['statsIndex']).toEqual({ g1: 1 });
  });
});

// Fixes from the independent review (D211). Each test fails on the first version.
describe('review fixes (D211)', () => {
  it('a guide whose trash entry was dropped by a later delete loses its results at the next purge', async () => {
    const a = makeGuide({ id: 'A' });
    const b = makeGuide({ id: 'B' });
    local['guide:A'] = a;
    local['guide:B'] = b;
    local['guides:index'] = [];
    const { writeGuides } = await import('../../src/core/storage/guides');
    const { enqueue } = await import('../../src/core/storage/queue');
    await enqueue(() => writeGuides([a, b], []));
    local['stats:A'] = play({}, a.steps[1]!, [found(1)]);
    local['statsIndex'] = { A: 1 };
    const { discoveryHandlers, purgeTrash } = await import('../../src/background/discovery');
    const dh = discoveryHandlers as unknown as Record<string, H>;
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      await dh['guide.delete']!({ id: 'A' }, {});
      vi.setSystemTime(now + 60_000);
      await dh['guide.delete']!({ id: 'B' }, {}); // drops A's expired entry from the trash
      await purgeTrash();
    } finally {
      vi.useRealTimers();
    }
    expect(local['stats:A']).toBeUndefined();
    expect(local['statsIndex']).toEqual({});
  });

  it('Back and on again in one run records the step once (the last outcome)', async () => {
    const { run, h } = await setup();
    await h['run.match']!(report(run.stepToken, false), ctx(0));
    const { runOp, getRun } = await import('../../src/background/runs');
    await runOp(7, 'back', 's2');
    await runOp(7, 'next', 's1');
    const again = (await getRun(7))!;
    expect(again.stepToken).not.toBe(run.stepToken);
    await h['run.match']!(report(again.stepToken, false), ctx(0));
    expect(stored()['s2']!.r).toHaveLength(1);
    expect(await h['stats.summary']!({ ids: ['g1'] }, {})).toEqual({ counts: {} });
  });

  it('the spotlight is broadcast before the result is written, and a failing write never fails the report', async () => {
    const { run, h } = await setup();
    const order: string[] = [];
    const send = chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>;
    send.mockImplementation(async (_t: number, m: { type: string }) => void order.push(m.type));
    const set = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    set.mockImplementation(async (o: Record<string, unknown>) => {
      if ('stats:g1' in o) {
        order.push('stats');
        throw new Error('quota');
      }
      Object.assign(local, o);
    });
    expect(await h['run.match']!(report(run.stepToken, true, { strong: 3 }), ctx(0))).toMatchObject({ ok: true });
    expect(order.indexOf('run.changed')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('run.changed')).toBeLessThan(order.indexOf('stats'));
  });

  it('a library refresh of unchanged guides does not rewrite their results', async () => {
    const g = makeGuide();
    local['guide:g1'] = g;
    local['guides:index'] = [];
    local['stats:g1'] = play({}, g.steps[1]!, [found(1)]);
    local['statsIndex'] = { g1: 1 };
    const set = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    const { writeGuides } = await import('../../src/core/storage/guides');
    set.mockClear();
    await writeGuides([{ ...g, title: 'Renamed' }], []);
    const keys = set.mock.calls.flatMap(([o]) => Object.keys(o as object));
    expect(keys).not.toContain('stats:g1');
    expect(keys).not.toContain('statsIndex');
  });

  it('the frame that had the element leaves after the top frame gave up: the card shows, and the play is not found', async () => {
    const { run, h } = await setup();
    await h['run.match']!(report(run.stepToken, false), ctx(0));
    // An iframe has it: found replaces the play.
    const iframe = { tabId: 7, frameId: 4, sender: { id: 'ext', tab: { id: 7, url: 'https://app.test/' }, url: 'https://app.test/f', origin: 'https://app.test', documentId: 'doc4' } } as never;
    await h['run.match']!(report(run.stepToken, true, { strong: 3, frameToken: 'f4' }), iframe);
    expect(stored()['s2']!.r[0]![1]).toBe(1);
    await h['run.leave']!({}, iframe);
    expect(stored()['s2']!.r).toHaveLength(1);
    expect(stored()['s2']!.r[0]![1]).toBe(0);
  });

  it('a found report without the strong count records nothing (not "one signal")', async () => {
    const { run, h } = await setup();
    await h['run.match']!(report(run.stepToken, true), ctx(0));
    expect(local['stats:g1']).toBeUndefined();
  });

  it('the top frame’s own document URL decides "on the step’s page", not a lagging tab URL', async () => {
    const { run, h } = await setup();
    const top = { tabId: 7, frameId: 0, sender: { id: 'ext', tab: { id: 7, url: 'https://elsewhere.test/' }, url: 'https://app.test/', origin: 'https://app.test' } } as never;
    await h['run.match']!(report(run.stepToken, false), top);
    expect(stored()['s2']!.r[0]![1]).toBe(0);
  });
});
