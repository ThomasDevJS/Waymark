/**
 * Issue #95 (D210): fix a broken step during playback. Pure run helpers, then the service worker
 * handlers against an in-memory chrome: who may start a pick, what a pick saves, refusals, Undo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementFingerprint, Guide } from '../../src/core/model/schema';
import { applyRunStep, fixedStep, fixPending, FIX_TTL_MS, runView, startRun, type Run } from '../../src/core/player/run';
import { CONTENT_ALLOWED, EXTENSION_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';

const fp = (text: string, extra: Partial<ElementFingerprint> = {}): ElementFingerprint => ({
  instance: 'unique',
  matchCount: 1,
  tag: 'button',
  role: 'button',
  accessibleName: text,
  text,
  cssPath: 'div > button',
  xpath: '/html/body/div/button',
  ancestors: [],
  shadowPath: [],
  framePath: [],
  rect: { x: 0, y: 0, w: 10, h: 10, vw: 100, vh: 100 },
  ...extra,
});

const nameless = (): ElementFingerprint => {
  const { accessibleName: _a, text: _t, role: _r, ...rest } = fp('x');
  return { ...rest, tag: 'p', cssPath: '' };
};

const makeGuide = (over: Partial<Guide> = {}): Guide => ({
  id: 'g1',
  schemaVersion: 1,
  revisionId: 'r1',
  title: 'Export',
  lang: 'en',
  tags: [],
  appOrigins: ['https://app.test'],
  startUrl: 'https://app.test/',
  matchUrls: [],
  steps: [
    { id: 's1', kind: 'click', title: 'Click **Import**', url: { kind: 'prefix', value: '/' }, target: fp('Import'), advance: 'action' },
    { id: 's2', kind: 'click', title: 'Click **Export**', url: { kind: 'prefix', value: '/' }, target: fp('Export'), advance: 'action', flags: ['low-confidence'] },
  ],
  version: 1,
  source: 'local',
  updatedAt: '',
  ...over,
});

describe('run helpers (D210)', () => {
  it('fixedStep replaces only the element and drops the recorder warnings', () => {
    const s = fixedStep(makeGuide(), 's2', fp('Download'));
    expect(s?.target?.text).toBe('Download');
    expect(s?.title).toBe('Click **Export**');
    expect(s && 'flags' in s).toBe(false);
    expect(fixedStep(makeGuide(), 'gone', fp('Download'))).toBeNull();
  });

  it('applyRunStep restarts the current step with a new token, keeps it read, and leaves other steps alone', () => {
    const run = startRun(makeGuide(), Date.now(), 1);
    run.spokenToken = run.stepToken;
    run.fix = { stepToken: run.stepToken, at: Date.now() };
    const before = { token: run.stepToken, rev: run.rev, first: run.guideSnapshot.steps[0] };
    expect(applyRunStep(run, fixedStep(run.guideSnapshot, 's2', fp('Download'))!)).toBe(true);
    expect(run.stepToken).not.toBe(before.token);
    expect(run.spokenToken).toBe(run.stepToken);
    expect(run.rev).toBe(before.rev + 1);
    expect(run.fix).toBeUndefined();
    expect(run.stepIndex).toBe(1);
    expect(run.guideSnapshot.steps[0]).toEqual(before.first);
    expect(run.guideSnapshot.steps[1]!.target!.text).toBe('Download');
  });

  it('applyRunStep on another step keeps the current step token', () => {
    const run = startRun(makeGuide(), Date.now(), 1);
    const token = run.stepToken;
    applyRunStep(run, fixedStep(run.guideSnapshot, 's1', fp('Import 2'))!);
    expect(run.stepToken).toBe(token);
  });

  it('fixPending is for the current step token only and times out', () => {
    const run = startRun(makeGuide());
    const now = Date.now();
    expect(fixPending(run, now)).toBe(false);
    run.fix = { stepToken: run.stepToken, at: now };
    expect(fixPending(run, now)).toBe(true);
    expect(fixPending(run, now + FIX_TTL_MS + 1)).toBe(false);
    run.fix = { stepToken: 'older', at: now };
    expect(fixPending(run, now)).toBe(false);
  });

  it('the view says fixable only for the author’s own guide', () => {
    expect(runView(startRun(makeGuide())).fixable).toBe(true);
    expect(runView(startRun(makeGuide({ source: 'library' }))).fixable).toBe(false);
  });
});

describe('messages (D210)', () => {
  it('run.fix.start comes from content only, run.fix.undo from extension pages only', () => {
    expect(CONTENT_ALLOWED.has('run.fix.start')).toBe(true);
    expect(EXTENSION_ALLOWED.has('run.fix.start')).toBe(false);
    expect(EXTENSION_ALLOWED.has('run.fix.undo')).toBe(true);
    expect(CONTENT_ALLOWED.has('run.fix.undo')).toBe(false);
    const content = { id: 'ext', tab: { id: 1 }, url: 'https://app.test/', origin: 'https://app.test' };
    expect(parseMessage({ type: 'run.fix.undo', payload: { tabId: 1 } }, content, 'ext').ok).toBe(false);
    expect(parseMessage({ type: 'run.fix.start', payload: { stepId: 'x'.repeat(65) } }, content, 'ext').ok).toBe(false);
  });
});

// ---------- service worker handlers against an in-memory chrome ----------

let local: Record<string, unknown>;
let session: Record<string, unknown>;
let pushes: { tabId: number; msg: { type: string; payload?: { fixing?: boolean } } }[];
let tabUrl: string;

function area(store: () => Record<string, unknown>) {
  return {
    get: vi.fn(async (k?: string | string[] | null) => {
      const s = store();
      if (k == null) return { ...s };
      const keys = Array.isArray(k) ? k : [k];
      return Object.fromEntries(keys.filter((x) => x in s).map((x) => [x, structuredClone(s[x])]));
    }),
    set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store(), structuredClone(o))),
    remove: vi.fn(async (k: string | string[]) => {
      for (const x of Array.isArray(k) ? k : [k]) delete store()[x];
    }),
  };
}

function fakeChrome() {
  return {
    storage: { local: area(() => local), session: area(() => session), onChanged: { addListener() {} } },
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: tabUrl, active: true, windowId: 1 })),
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async (tabId: number, msg: { type: string }) => void pushes.push({ tabId, msg })),
    },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) },
    tts: { stop: vi.fn(), speak: vi.fn(), getVoices: vi.fn((cb?: (v: unknown[]) => void) => cb?.([])) },
    runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext/${p}` },
    permissions: { getAll: vi.fn(async () => ({ origins: [] })) },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
  };
}

const ctx = (url = 'https://app.test/', frameId = 0) => ({ tabId: 7, frameId, sender: { id: 'ext', tab: { id: 7, url }, url, origin: new URL(url).origin } }) as never;

async function load() {
  const { fixHandlers } = await import('../../src/background/fix');
  const { editorHandlers } = await import('../../src/background/editor');
  type H = (p: unknown, c: unknown) => Promise<{ ok: boolean }>;
  const h = { ...fixHandlers, ...editorHandlers } as unknown as Record<string, H>;
  return { h };
}

function seed(over: Partial<Guide> = {}, stepIndex = 1): Run {
  const g = makeGuide(over);
  local[`guide:${g.id}`] = g;
  local['guides:index'] = [];
  const run = startRun(g, Date.now(), stepIndex);
  session['run:7'] = run;
  return run;
}

const run = () => session['run:7'] as Run;
const stored = () => local['guide:g1'] as Guide;

beforeEach(() => {
  vi.resetModules();
  local = {};
  session = {};
  pushes = [];
  tabUrl = 'https://app.test/';
  vi.stubGlobal('chrome', fakeChrome());
});
afterEach(() => vi.unstubAllGlobals());

describe('run.fix.start (D210)', () => {
  it('starts a pick for the current step of the author’s own guide: the view says fixing and every frame picks', async () => {
    seed();
    const { h } = await load();
    expect(await h['run.fix.start']!({ stepId: 's2' }, ctx())).toEqual({ ok: true });
    expect(run().fix?.stepToken).toBe(run().stepToken);
    expect(pushes.some((p) => p.msg.type === 'run.changed' && p.msg.payload?.fixing === true)).toBe(true);
    expect(pushes.some((p) => p.msg.type === 'pick.start')).toBe(true);
  });

  it('is refused for a library guide, another step, or a tab on another site', async () => {
    seed({ source: 'library' });
    let { h } = await load();
    expect(await h['run.fix.start']!({ stepId: 's2' }, ctx())).toEqual({ ok: false });
    seed();
    ({ h } = await load());
    expect(await h['run.fix.start']!({ stepId: 's1' }, ctx())).toEqual({ ok: false });
    expect(await h['run.fix.start']!({ stepId: 's2' }, ctx('https://evil.test/'))).toEqual({ ok: false });
    expect(run().fix).toBeUndefined();
    expect(pushes.some((p) => p.msg.type === 'pick.start')).toBe(false);
  });

  it('is refused when the stored copy became a library guide during the run', async () => {
    seed();
    (local['guide:g1'] as Guide).source = 'library';
    const { h } = await load();
    expect(await h['run.fix.start']!({ stepId: 's2' }, ctx())).toEqual({ ok: false });
  });
});

describe('pick.result for the player (D210)', () => {
  it('saves the picked element as a new revision and moves the run onto it', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    const token = run().stepToken;
    expect(await h['pick.result']!({ target: fp('Download'), title: 'Click **Download**' }, ctx())).toEqual({ ok: true });
    expect(stored().version).toBe(2);
    expect(stored().revisionId).not.toBe('r1');
    expect(stored().steps[1]!.target!.text).toBe('Download');
    expect(stored().steps[1]!.title).toBe('Click **Export**');
    expect(stored().steps[0]).toEqual(makeGuide().steps[0]);
    expect(run().fix).toBeUndefined();
    expect(run().stepToken).not.toBe(token);
    expect(run().guideSnapshot.steps[1]!.target!.text).toBe('Download');
    expect(pushes.some((p) => p.msg.type === 'pick.stop')).toBe(true);
    const rec = session['runFix:7'] as { stepIndex: number; before: Guide };
    expect(rec.stepIndex).toBe(1);
    expect(rec.before.revisionId).toBe('r1');
  });

  it('keeps an edit saved in the panel during the pick (no lost write)', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    // The editor saved a new title for step 1 meanwhile.
    local['guide:g1'] = { ...stored(), revisionId: 'r-editor', version: 2, steps: [{ ...stored().steps[0]!, title: 'Edited' }, stored().steps[1]!] };
    await h['pick.result']!({ target: fp('Download'), title: '' }, ctx());
    expect(stored().steps[0]!.title).toBe('Edited');
    expect(stored().steps[1]!.target!.text).toBe('Download');
    expect(stored().version).toBe(3);
  });

  it('refuses an element with nothing to find it by and stays in pick mode', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    expect(await h['pick.result']!({ target: nameless(), title: '' }, ctx())).toEqual({ ok: false });
    expect(stored().revisionId).toBe('r1');
    expect(run().fix).toBeDefined();
  });

  it('ends the pick without saving when the step was deleted in the panel meanwhile', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    local['guide:g1'] = { ...stored(), revisionId: 'r-editor', steps: [stored().steps[0]!] };
    expect(await h['pick.result']!({ target: fp('Download'), title: '' }, ctx())).toEqual({ ok: false });
    expect(stored().revisionId).toBe('r-editor');
    expect(run().fix).toBeUndefined();
  });

  it('refuses a pick that timed out', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    session['run:7'] = { ...run(), fix: { stepToken: run().stepToken, at: Date.now() - FIX_TTL_MS - 1 } };
    expect(await h['pick.result']!({ target: fp('Download'), title: '' }, ctx())).toEqual({ ok: false });
    expect(stored().revisionId).toBe('r1');
  });

  it('without a pick from the player or the panel, a page’s pick.result changes nothing', async () => {
    seed();
    const { h } = await load();
    expect(await h['pick.result']!({ target: fp('Download'), title: '' }, ctx())).toEqual({ ok: false });
    expect(stored().revisionId).toBe('r1');
  });

  it('Esc (pick.abort) ends the pick: the view no longer says fixing', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    pushes = [];
    await h['pick.abort']!({}, ctx());
    expect(run().fix).toBeUndefined();
    expect(pushes.some((p) => p.msg.type === 'run.changed' && p.msg.payload?.fixing === false)).toBe(true);
  });
});

describe('run.fix.undo (D210)', () => {
  it('writes back the exact copy from before the fix; the run stays on its step with the old element', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    await h['pick.result']!({ target: fp('Download'), title: '' }, ctx());
    expect(await h['run.fix.undo']!({ tabId: 7 }, {})).toEqual({ ok: true });
    expect(stored()).toEqual(makeGuide());
    expect(run().stepIndex).toBe(1);
    expect(run().guideSnapshot.steps[1]!.target!.text).toBe('Export');
    expect(session['runFix:7']).toBeUndefined();
  });

  it('is refused once the guide changed again after the fix', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    await h['pick.result']!({ target: fp('Download'), title: '' }, ctx());
    local['guide:g1'] = { ...stored(), revisionId: 'later' };
    await expect(h['run.fix.undo']!({ tabId: 7 }, {})).rejects.toThrow(/changed after the fix/);
    expect(stored().revisionId).toBe('later');
  });
});

describe('the pick ends with its page or its step (D210)', () => {
  it('a new page load clears the pick, so the next view shows the step again', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    const { onTopFrameLoad, viewFor } = await import('../../src/background/runs');
    await onTopFrameLoad(7, 'https://app.test/');
    expect(run().fix).toBeUndefined();
    expect((await viewFor(7, 'https://app.test/')).fixing).toBe(false);
  });

  it('a step change (a shortcut) ends the pick in every frame', async () => {
    seed();
    const { h } = await load();
    await h['run.fix.start']!({ stepId: 's2' }, ctx());
    pushes = [];
    const { runOp } = await import('../../src/background/runs');
    expect(await runOp(7, 'back', 's2')).toBe(true);
    expect(run().fix).toBeUndefined();
    expect(pushes.some((p) => p.msg.type === 'pick.stop')).toBe(true);
  });
});
