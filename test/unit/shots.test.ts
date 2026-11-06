/**
 * Step screenshots for the printable how-to (D180–D188, reworked in D190–D199): frame geometry,
 * the stored image's plan and caps, zoom, rate limit, lifecycle, migration, the preview's address.
 */
import { describe, expect, it } from 'vitest';
import { fitUnderCap, intersect, layoutFrames, MAX_BYTES, MAX_TRIES, MAX_W, placeElement, planImage, resolveChildren, zoomRect, type ChildFrame, type FrameReport } from '../../src/core/shots/place';
import { asFrameReport } from '../../src/core/shots/report';
import { createCallSpacer, createCaptureQueue, DROPPED } from '../../src/core/shots/rate';
import { asIdList, MAX_SHOT_GUIDES, shotFits, staleFlags, staleShots, stepHashes, targetHash } from '../../src/core/shots/lifecycle';
import { isOldShot, parseShotKey, shotKey, SHOT_VERSION } from '../../src/core/shots/store';
import { blurPx, highlightRect, renderPlan } from '../../src/core/shots/render';
import { hideFrames, isActiveTabRefusal, isQuotaRefusal, pageOf, placeShot, shotStep } from '../../src/background/shots';
import { howtoHtml, howtoImageKey, howtoMarkdown, PRINT_CSS } from '../../src/core/sharing/howto';
import { exportJson } from '../../src/entrypoints/sidepanel/ExportReview';
import { fittingShots, parsePreviewQuery, previewPath } from '../../src/entrypoints/howto/data';
import { parseMessage, type ContentPush } from '../../src/core/messaging/protocol';
import type { Guide, Step } from '../../src/core/model/schema';
import type { ShotRecord } from '../../src/core/shots/store';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const child = (frameId: number, b: ReturnType<typeof box>, inset = 0, k = 1): ChildFrame => ({
  frameId,
  box: b,
  content: { x: b.x + inset * k, y: b.y + inset * k, w: b.w - 2 * inset * k, h: b.h - 2 * inset * k },
  k,
});
const report = (frames: ChildFrame[] = [], rect: ReturnType<typeof box> | null = null, vw = 1000, vh = 700): FrameReport => ({ vw, vh, dpr: 1, rect, frames });

describe('placing an element through its frames (D191)', () => {
  it('adds up iframe offsets, borders and padding along the path (same- and cross-origin alike)', () => {
    // Top: an iframe at (100, 50) with a 2 px border and 8 px padding (content at 110, 60).
    // Inside it: an iframe at (20, 30) with a 1 px border (content at 21, 31) holding the element.
    const reports = new Map<number, FrameReport>([
      [0, report([child(4, box(100, 50, 600, 500), 10)])],
      [4, report([child(9, box(20, 30, 300, 200), 1)], null, 580, 480)],
      [9, report([], box(5, 6, 40, 20), 298, 198)],
    ]);
    const layout = layoutFrames(reports)!;
    expect(layout.placed.get(4)).toMatchObject({ ox: 110, oy: 60, k: 1 });
    expect(layout.placed.get(9)).toMatchObject({ ox: 131, oy: 91, k: 1 });
    expect(placeElement(layout, 9, box(5, 6, 40, 20))).toEqual(box(136, 97, 40, 20));
    expect(layout.masks).toEqual([]);
    expect(placeShot(reports, 9)?.el).toEqual(box(136, 97, 40, 20));
  });
  it('takes a scaled iframe (CSS transform) into account', () => {
    const reports = new Map<number, FrameReport>([
      [0, report([child(2, box(100, 100, 200, 100), 0, 0.5)])],
      [2, report([], box(40, 20, 100, 40), 400, 200)],
    ]);
    expect(placeShot(reports, 2)?.el).toEqual(box(120, 110, 50, 20));
  });
  it('clips the element to every frame it is in, and to the viewport; hidden means no picture', () => {
    const reports = new Map<number, FrameReport>([
      [0, report([child(2, box(0, 600, 400, 300))])],
      [2, report([], box(10, 50, 100, 200))],
    ]);
    // The frame is cut off at the viewport's bottom (700): only 50 px of the element show.
    expect(placeShot(reports, 2)?.el).toEqual(box(10, 650, 100, 50));
    // Scrolled out of its frame's view: nothing to point at.
    const out = new Map<number, FrameReport>([
      [0, report([child(2, box(0, 0, 400, 300))])],
      [2, report([], box(10, 400, 100, 20))],
    ]);
    expect(placeShot(out, 2)).toBeNull();
  });
  it('a frame that did not answer is painted over, with everything in it; a frame that did is not', () => {
    const reports = new Map<number, FrameReport>([
      [0, report([child(2, box(0, 0, 400, 300)), child(3, box(500, 0, 400, 300)), child(-1, box(0, 400, 200, 100))])],
      [2, report([child(7, box(10, 10, 100, 100))])],
    ]);
    const layout = layoutFrames(reports)!;
    // 3 (no Waymark there), the object/embed (-1), and 7 inside 2 (no answer) are masked.
    expect(layout.masks).toEqual([box(500, 0, 400, 300), box(0, 400, 200, 100), box(10, 10, 100, 100)]);
    expect(layout.placed.has(2)).toBe(true);
    expect(placeElement(layout, 3, box(1, 1, 10, 10))).toBeNull();
  });
  it('fails closed on odd reports: a frame id listed twice, a loop, no top frame', () => {
    const twice = new Map<number, FrameReport>([
      [0, report([child(2, box(0, 0, 100, 100)), child(2, box(200, 0, 100, 100))])],
      [2, report([], box(1, 1, 10, 10))],
    ]);
    expect(layoutFrames(twice)!.masks).toHaveLength(2);
    expect(placeShot(twice, 2)).toBeNull();
    const loop = new Map<number, FrameReport>([
      [0, report([child(2, box(0, 0, 100, 100))])],
      [2, report([child(0, box(0, 0, 10, 10))])],
    ]);
    expect(layoutFrames(loop)!.placed.size).toBe(2);
    expect(layoutFrames(new Map([[2, report()]]))).toBeNull();
  });
  it('intersect is empty for boxes that only touch', () => {
    expect(intersect(box(0, 0, 10, 10), box(10, 0, 5, 5))).toBeNull();
  });
});

describe('the stored image: the whole visible tab (D190)', () => {
  it('keeps the viewport, scaled to at most 1600 px wide, with the element box in image pixels', () => {
    const plan = planImage(box(100, 50, 40, 20), [], 2560, 1440, 2)!;
    expect(plan.dw).toBe(MAX_W);
    expect(plan.dh).toBe(900);
    expect(plan.s).toBeCloseTo(1.25);
    expect(plan.box).toEqual(box(125, 63, 50, 25));
  });
  it('a small window is not scaled up', () => {
    const plan = planImage(box(10, 10, 20, 20), [], 1200, 800, 1)!;
    expect([plan.dw, plan.dh, plan.s]).toEqual([1200, 800, 1]);
  });
  it('paints over masks, rounded outward and kept in the image', () => {
    const plan = planImage(box(10, 10, 20, 20), [box(0.4, 100.6, 50.2, 2000)], 1000, 700, 1)!;
    expect(plan.masks).toEqual([box(0, 100, 51, 600)]);
  });
  it('the captured area can be narrower than the viewport: an element outside it has no image', () => {
    expect(planImage(box(1100, 10, 50, 20), [], 1000, 700, 1)).toBeNull();
    expect(planImage(box(990, 10, 50, 20), [], 1000, 700, 1)!.box).toEqual(box(990, 10, 10, 20));
  });
  it('scales down further for the size cap, and refuses junk', () => {
    expect(planImage(box(10, 10, 20, 20), [], 1000, 700, 1, 0.5)!.dw).toBe(500);
    expect(planImage(box(10, 10, 20, 20), [], 0, 700, 1)).toBeNull();
    expect(planImage(box(10, 10, 20, 20), [], 1000, 700, NaN)).toBeNull();
  });
  it('fits under 250 KB: smaller until it fits, then gives up', async () => {
    expect(MAX_BYTES).toBe(250_000);
    const tried: number[] = [];
    const out = await fitUnderCap(async (scale) => (tried.push(scale), { size: Math.round(400_000 * scale * scale) }));
    expect(out!.image.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(tried).toEqual([1, 0.8, 0.6400000000000001]);
    let n = 0;
    expect(await fitUnderCap(async () => (n++, { size: 10 * MAX_BYTES }))).toBeNull();
    expect(n).toBe(MAX_TRIES);
    expect(await fitUnderCap(async () => null)).toBeNull();
  });
});

describe('zoom to the element (D194)', () => {
  it('keeps the image shape, contains the element with room, and stays inside the image', () => {
    const z = zoomRect(box(800, 450, 60, 30), 1600, 900);
    expect(z.w / z.h).toBeCloseTo(1600 / 900, 1);
    expect(z.x).toBeLessThan(800);
    expect(z.x + z.w).toBeGreaterThan(860);
    expect(z.w).toBeGreaterThanOrEqual(640);
    expect(z.w).toBeLessThan(1600);
  });
  it('at an edge it moves inside; a huge element gives the whole image', () => {
    const z = zoomRect(box(0, 0, 20, 20), 1600, 900);
    expect([z.x, z.y]).toEqual([0, 0]);
    expect(zoomRect(box(0, 0, 1500, 800), 1600, 900)).toEqual(box(0, 0, 1600, 900));
  });
  it('old close-ups are drawn whole; new images move the box with the zoom', () => {
    const shot = { w: 1600, h: 900, box: box(800, 450, 60, 30) };
    expect(renderPlan(shot, true).src).toEqual(box(0, 0, 1600, 900));
    const z = renderPlan({ ...shot, v: 2 }, true);
    expect(z.box.x).toBe(800 - z.src.x);
    expect(renderPlan({ ...shot, v: 2 }, false).box).toEqual(shot.box);
  });
});

describe('light blur (D193)', () => {
  it('is about 3.5 CSS pixels, from the stored scale (a third of D188, no pixelation)', () => {
    expect(blurPx({ w: 1600, px: 1.25 })).toBe(4.4);
    expect(blurPx({ w: 1280, px: 1 })).toBe(3.5);
    // Old records have no scale: from the width, never below 2.
    expect(blurPx({ w: 800 })).toBe(2.2);
    expect(blurPx({ w: 100 })).toBe(2);
  });
});

describe('capture queue (D183)', () => {
  function fakeClock() {
    let t = 0;
    const sleeps: number[] = [];
    return {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      sleeps,
      advance: (ms: number) => (t += ms),
    };
  }

  it('runs captures one at a time, at least 550 ms apart', async () => {
    const clock = fakeClock();
    const q = createCaptureQueue({ gapMs: 550, now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    const job = () => async () => (starts.push(clock.now()), 'ok');
    const out = await Promise.all([q.push(job()), q.push(job()), q.push(job())]);
    expect(out).toEqual(['ok', 'ok', 'ok']);
    expect(starts).toEqual([0, 550, 1100]);
  });

  it('drops the oldest waiting capture when steps come too fast, never blocking', async () => {
    const clock = fakeClock();
    const q = createCaptureQueue({ gapMs: 550, maxPending: 2, now: clock.now, sleep: clock.sleep });
    let release!: () => void;
    const first = q.push(() => new Promise<string>((r) => (release = () => r('first'))));
    const a = q.push(async () => 'a');
    const b = q.push(async () => 'b');
    const c = q.push(async () => 'c');
    expect(await a).toBe(DROPPED);
    expect(q.pending()).toBe(2);
    release();
    expect(await Promise.all([first, b, c])).toEqual(['first', 'b', 'c']);
  });

  it('review fix: the capture calls themselves are 550 ms apart, even when hiding takes long', async () => {
    const clock = fakeClock();
    const q = createCaptureQueue({ gapMs: 550, now: clock.now, sleep: clock.sleep });
    const slot = createCallSpacer(550, clock.now, clock.sleep);
    const calls: number[] = [];
    // The first page is slow to hide (700 ms), the next ones fast (30 ms); then 100 ms of work.
    // Spacing only the job starts would put the second call 130 ms after the first.
    const job = (hide: number) => async () => {
      clock.advance(hide);
      await slot();
      calls.push(clock.now());
      clock.advance(100);
    };
    await Promise.all([q.push(job(700)), q.push(job(30)), q.push(job(30))]);
    expect(calls).toHaveLength(3);
    for (let i = 1; i < calls.length; i++) expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(550);
  });

  it('keeps going after a failed capture', async () => {
    const clock = fakeClock();
    const q = createCaptureQueue({ gapMs: 10, now: clock.now, sleep: clock.sleep });
    const bad = q.push(async () => {
      throw new Error('boom');
    });
    const good = q.push(async () => 'ok');
    expect(await bad).toBe(DROPPED);
    expect(await good).toBe('ok');
  });
});

const step = (id: string, cssPath = `#${id}`): Step => ({
  id,
  kind: 'click',
  title: id,
  url: { kind: 'pattern', value: '/' },
  advance: 'action',
  target: { instance: 'unique', matchCount: 1, tag: 'button', cssPath, xpath: '/x', ancestors: [], shadowPath: [], framePath: [], rect: { x: 1, y: 2, w: 3, h: 4, vw: 100, vh: 100 } },
});

describe('lifecycle (D185)', () => {
  const g1 = { steps: [step('s1')] };
  const h = (s: Step) => targetHash(s.target);
  const ref = (guideId: string, stepId: string, t = h(step(stepId))) => ({ guideId, stepId, t });
  const refs = [ref('g1', 's1'), ref('g1', 'gone'), ref('g2', 's1'), ref('trashed', 's1'), ref('rec', 's1'), ref('deleted', 's1'), ref('off', 's1'), ref('g1', 's1', 'other-element')];
  const ctx = {
    guides: new Map([
      ['g1', stepHashes(g1)],
      ['g2', stepHashes(g1)],
      ['off', stepHashes(g1)],
    ]),
    on: new Set(['g1', 'g2', 'trashed', 'deleted']),
    keep: new Set(['trashed', 'rec']),
  };

  it('deletes images of deleted steps, re-picked elements, deleted guides and guides turned off; keeps the Undo trash and the recording', () => {
    expect(staleShots(refs, ctx)).toEqual([ref('g1', 'gone'), ref('deleted', 's1'), ref('off', 's1'), ref('g1', 's1', 'other-element')]);
  });

  it('when Undo expires, the trashed guide is no longer kept and its images go', () => {
    const later = { ...ctx, keep: new Set(['rec']) };
    expect(staleShots(refs, later)).toContainEqual(ref('trashed', 's1'));
    expect(staleFlags(['g1', 'trashed', 'deleted'], new Set(['g1']), new Set(['rec']))).toEqual(['trashed', 'deleted']);
    expect(staleFlags(['g1', 'trashed'], new Set(['g1']), new Set(['trashed']))).toEqual([]);
  });

  it('an image fits its step only while the step points at the same element', () => {
    const saved = { steps: [step('a'), step('b')] };
    expect(shotFits(ref('g', 'a'), stepHashes(saved))).toBe(true);
    // Deleted step, re-picked element, an image without a hash: not that step's image.
    expect(shotFits(ref('g', 'c'), stepHashes(saved))).toBe(false);
    expect(shotFits(ref('g', 'a'), stepHashes({ steps: [step('a', '#other')] }))).toBe(false);
    expect(shotFits({ guideId: 'g', stepId: 'a' }, stepHashes(saved))).toBe(false);
    // Title or note edits keep it.
    expect(shotFits(ref('g', 'a'), stepHashes({ steps: [{ ...step('a'), title: 'new', note: 'n' }] }))).toBe(true);
  });

  it('review fix: Re-pick, then Capture, then Save keeps the new image; discarding the draft drops it', () => {
    const saved = step('a');
    const repicked = step('a', '#new-target');
    // Capture in the editor stores the draft's target hash.
    const captured = { guideId: 'g', stepId: 'a', t: targetHash(repicked.target) };
    // Saved with the re-picked target: the image fits (it used to be deleted by Save).
    expect(staleShots([captured], { guides: new Map([['g', stepHashes({ steps: [repicked] })]]), on: new Set(['g']), keep: new Set() })).toEqual([]);
    // Draft discarded: the saved step still points at the old element, so the image is not offered and goes.
    expect(shotFits(captured, stepHashes({ steps: [saved] }))).toBe(false);
  });

  it('the hash does not depend on key order or undefined keys', () => {
    const t = step('a').target!;
    const reordered = Object.fromEntries(Object.entries(t).reverse());
    expect(targetHash(reordered)).toBe(targetHash(t));
    expect(targetHash({ ...t, id: undefined })).toBe(targetHash(t));
    expect(targetHash({ ...t, cssPath: '#b' })).not.toBe(targetHash(t));
  });

  it('reads the on-list defensively and caps it', () => {
    expect(asIdList(undefined)).toEqual([]);
    expect(asIdList(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(asIdList(Array.from({ length: MAX_SHOT_GUIDES + 5 }, (_, i) => `g${i}`))).toHaveLength(MAX_SHOT_GUIDES);
  });

  it('keys round-trip; junk keys are ignored', () => {
    expect(parseShotKey(shotKey('g1', 's-1'))).toEqual({ guideId: 'g1', stepId: 's-1' });
    expect(parseShotKey('nokey')).toBeNull();
    expect(parseShotKey('/x')).toBeNull();
    expect(parseShotKey(42)).toBeNull();
  });
});

describe('hiding in every frame (D192)', () => {
  const ok = (frames: ChildFrame[] = [], rect: ReturnType<typeof box> | null = null) => ({ vw: 800, vh: 600, dpr: 1, rect, frames });
  const sel = (selector: string, b: ReturnType<typeof box>): ChildFrame => ({ ...child(-1, b), sel: selector });
  it('asks the top frame, the step frame and every registered frame at once; only the step frame is asked for the element', async () => {
    const sent: [number, ContentPush][] = [];
    const answers: Record<number, unknown> = {
      0: ok([sel('#a', box(0, 0, 100, 100)), child(-1, box(0, 200, 10, 10))]),
      5: ok([sel('#b', box(0, 0, 50, 50))], box(1, 1, 10, 10)),
      8: ok(),
    };
    const reports = await hideFrames(async (id, msg) => (sent.push([id, msg]), answers[id]), [8, 5, 99], 5, 'step1', 500);
    expect(sent.map(([id]) => id)).toEqual([0, 5, 8, 99]);
    expect(sent.find(([id]) => id === 5)![1]).toEqual({ type: 'shot.hide', payload: { stepId: 'step1' } });
    expect(sent.find(([id]) => id === 0)![1]).toEqual({ type: 'shot.hide', payload: {} });
    expect([...reports.keys()].sort()).toEqual([0, 5, 8]);
  });
  it('a frame that answers late or with junk is left out (and so painted over)', async () => {
    const reports = await hideFrames(
      async (id) => {
        if (id === 3) return new Promise((r) => setTimeout(() => r(ok()), 300));
        if (id === 4) return { vw: 'x' };
        return ok([sel('#x', box(0, 0, 10, 10))]);
      },
      [3, 4],
      0,
      's',
      100,
    );
    expect([...reports.keys()]).toEqual([0]);
  });
  it('names children through the frame registry: one registered frame that answered, else masked', () => {
    const links = {
      '5': { parentFrameId: 0, selector: '#a' },
      '6': { parentFrameId: 5, selector: '#b' },
      // A rebuilt iframe (D152): an old frame at the same place that no longer answers.
      '3': { parentFrameId: 0, selector: '#a' },
      // Two live frames claim the same place: neither is trusted.
      '10': { parentFrameId: 0, selector: '#c' },
      '11': { parentFrameId: 0, selector: '#c' },
    };
    const reports = new Map<number, FrameReport>([
      [0, report([sel('#a', box(0, 0, 500, 400)), sel('#c', box(600, 0, 100, 100)), sel('#none', box(0, 500, 100, 100)), child(-1, box(800, 0, 50, 50))])],
      [5, report([sel('#b', box(10, 10, 100, 100))])],
      [6, report([], box(1, 1, 20, 10))],
      [10, report()],
      [11, report()],
    ]);
    const named = resolveChildren(reports, links);
    expect(named.get(0)!.frames.map((c) => c.frameId)).toEqual([5, -1, -1, -1]);
    expect(named.get(5)!.frames.map((c) => c.frameId)).toEqual([6]);
    const layout = layoutFrames(named)!;
    expect(layout.masks).toEqual([box(600, 0, 100, 100), box(0, 500, 100, 100), box(800, 0, 50, 50)]);
    expect(placeShot(named, 6)?.el).toEqual(box(11, 11, 20, 10));
    // A frame registered under another parent does not count here.
    expect(resolveChildren(reports, { '5': { parentFrameId: 9, selector: '#a' } }).get(0)!.frames[0]!.frameId).toBe(-1);
  });
  it("the frames' answers are checked", () => {
    const r = ok([{ ...child(-1, box(0, 0, 10, 10)), sel: '#f' }], box(1, 2, 3, 4));
    expect(asFrameReport(r)).toEqual(r);
    // The page never names frame ids (it could point a mask's exemption at any frame).
    expect(asFrameReport(ok([child(2, box(0, 0, 10, 10))]))).toBeNull();
    expect(asFrameReport({ ...r, more: true })).toEqual({ ...r, more: true });
    for (const bad of [null, 1, { ...r, dpr: 0 }, { ...r, dpr: 11 }, { ...r, vw: Infinity }, { ...r, rect: { x: 0, y: 0, w: 0, h: 1 } }, { ...r, frames: [{ frameId: 1.5, box: box(0, 0, 1, 1), content: box(0, 0, 1, 1), k: 1 }] }, { ...r, frames: Array.from({ length: 101 }, () => child(-1, box(0, 0, 1, 1))) }])
      expect(asFrameReport(bad)).toBeNull();
  });
  it('review fix kept: a hash route is another page', () => {
    expect(pageOf('https://a.example/app#/customers')).not.toBe(pageOf('https://a.example/app#/orders'));
    expect(pageOf('https://a.example/app?q=1')).toBe(pageOf('https://a.example/app?q=2'));
  });
  it('steps in frames are captured too (D191)', () => {
    expect(shotStep(step('a'), 0)).toBe(true);
    expect(shotStep(step('a'), 3)).toBe(true);
    const framed = step('a');
    framed.target!.framePath = ['iframe#x'];
    expect(shotStep(framed, 7)).toBe(true);
    expect(shotStep({ target: undefined }, 0)).toBe(false);
    expect(shotStep(step('a'), undefined)).toBe(false);
  });
  it("tells Chrome's activeTab refusal and its rate limit from other failures (D181, D183)", () => {
    expect(isActiveTabRefusal(new Error("Either the '<all_urls>' or 'activeTab' permission is required."))).toBe(true);
    expect(isActiveTabRefusal(new Error('No window with id: 3.'))).toBe(false);
    expect(isQuotaRefusal(new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.'))).toBe(true);
    expect(isQuotaRefusal(new Error('No window with id: 3.'))).toBe(false);
  });
});

const guide = (steps: Step[]): Guide => ({
  id: 'g1',
  schemaVersion: 1,
  revisionId: 'r1',
  title: 'Export orders',
  lang: 'en',
  tags: [],
  appOrigins: ['https://app.example'],
  startUrl: 'https://app.example/orders',
  matchUrls: [],
  steps,
  version: 1,
  source: 'local',
  updatedAt: '2026-11-06T00:00:00Z',
});

const IMG = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of';

describe('printable how-to with screenshots (D188, D195)', () => {
  it('embeds a data image per step that has one, with a data-only CSP', () => {
    const g = guide([step('a'), step('b')]);
    const html = howtoHtml([g], new Map([[howtoImageKey('g1', 'a'), { src: IMG, w: 400, h: 300 }]]));
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain(`src="${IMG}" width="400" height="300"`);
    expect(html).toContain("img-src data:");
    expect(html).not.toMatch(/<script|https?:\/\/(?!app\.example)/);
  });
  it('leaves out anything that is not a data image (no remote image, no attribute injection)', () => {
    const g = guide([step('a'), step('b'), step('c')]);
    const html = howtoHtml(
      [g],
      new Map([
        [howtoImageKey('g1', 'a'), { src: 'https://evil.example/x.png', w: 1, h: 1 }],
        [howtoImageKey('g1', 'b'), { src: `${IMG}" onerror="alert(1)`, w: 1, h: 1 }],
        [howtoImageKey('g1', 'c'), { src: 'data:image/svg+xml;base64,PHN2Zz4=', w: 1, h: 1 }],
      ]),
    );
    expect(html).not.toContain('<img');
  });
  it('without images the page is as before; Markdown and guide files never carry images', () => {
    const g = guide([step('a')]);
    expect(howtoHtml([g])).not.toContain('<img');
    expect(howtoMarkdown([g])).not.toMatch(/!\[|data:image/);
    expect(exportJson([g], new Set())).not.toMatch(/data:image|webp|screenshot/i);
  });
  it('the preview offers only screenshots of steps still in the guide, showing their element', () => {
    const g = guide([step('a'), step('b')]);
    const rec = (stepId: string, t = targetHash(step(stepId).target)): ShotRecord => ({ key: `g1/${stepId}`, guideId: 'g1', stepId, blob: new Blob(), w: 1, h: 1, box: { x: 0, y: 0, w: 1, h: 1 }, t, at: 0 });
    expect(fittingShots([g], [rec('a'), rec('b'), rec('old')]).map((x) => x.stepId)).toEqual(['a', 'b']);
    // An image of another element than the saved step's (a discarded Re-pick) is not offered.
    expect(fittingShots([g], [rec('a', 'stale')])).toEqual([]);
  });
  it('a header with the step count and the date; light only; a step never split across pages', () => {
    const html = howtoHtml([guide([step('a'), step('b')])], new Map(), { date: '6 November 2026' });
    expect(html).toContain('<p class="meta">2 steps · 6 November 2026</p>');
    expect(PRINT_CSS).toContain('color-scheme: light');
    expect(PRINT_CSS).not.toContain('prefers-color-scheme');
    expect(PRINT_CSS).toMatch(/li \{[^}]*break-inside: avoid/);
    expect(PRINT_CSS).toMatch(/max-height: 105mm/);
  });
  it('the header text is escaped', () => {
    expect(howtoHtml([guide([step('a')])], new Map(), { date: '<b>x</b>' })).toContain('1 step · &lt;b&gt;x&lt;/b&gt;');
  });
  it('the outline stays inside the image', () => {
    expect(highlightRect({ x: 0, y: 0, w: 10, h: 10 }, 100, 100)).toEqual({ x: 0, y: 0, w: 14, h: 14 });
    expect(highlightRect({ x: 90, y: 95, w: 20, h: 20 }, 100, 100)).toEqual({ x: 86, y: 91, w: 14, h: 9 });
  });
});

describe('migration: 0.5.0 close-ups (D196)', () => {
  it('records without a version are old close-ups; new ones are whole pages', () => {
    expect(SHOT_VERSION).toBe(2);
    expect(isOldShot({})).toBe(true);
    expect(isOldShot({ v: 2 })).toBe(false);
  });
});

describe('the preview page address (D195)', () => {
  it('carries only ids, removals and the file name, and reads back defensively', () => {
    const path = previewPath({ ids: ['g1', 'g2'], drop: ['g1|s1|note'], name: 'My guide' });
    expect(path.startsWith('howto.html?')).toBe(true);
    expect(parsePreviewQuery(path.slice(path.indexOf('?')))).toEqual({ ids: ['g1', 'g2'], drop: ['g1|s1|note'], name: 'My guide' });
    expect(parsePreviewQuery('?g=a,../x,b&drop=notjson')).toEqual({ ids: ['a', 'b'], drop: [], name: 'guides' });
    expect(parsePreviewQuery('?drop=[1,"k"]').drop).toEqual(['k']);
  });
});

describe('messages (D180)', () => {
  const ext = { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' };
  const page = { id: 'ext', url: 'https://app.example/', tab: { id: 1 } };
  it('the setting is for extension pages only', () => {
    expect(parseMessage({ type: 'shots.set', payload: { guideId: 'g1', on: true } }, ext, 'ext').ok).toBe(true);
    expect(parseMessage({ type: 'shots.set', payload: { guideId: 'g1', on: true } }, page, 'ext').ok).toBe(false);
    expect(parseMessage({ type: 'shots.get', payload: { guideId: 'g1' } }, page, 'ext').ok).toBe(false);
  });
  it('rec.start takes an optional shots flag', () => {
    expect(parseMessage({ type: 'rec.start', payload: { tabId: 1, title: 'x', shots: true } }, ext, 'ext').ok).toBe(true);
    expect(parseMessage({ type: 'rec.start', payload: { tabId: 1, title: 'x', shots: 'yes' } }, ext, 'ext').ok).toBe(false);
  });
});
