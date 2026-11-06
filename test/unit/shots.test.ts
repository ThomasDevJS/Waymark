/** Step screenshots for the printable how-to (D180–D188): crop math, caps, rate limit, lifecycle. */
import { describe, expect, it } from 'vitest';
import { CONTEXT_PX, fitUnderCap, MAX_BYTES, MAX_TRIES, MAX_W, planCrop } from '../../src/core/shots/crop';
import { createCallSpacer, createCaptureQueue, DROPPED } from '../../src/core/shots/rate';
import { asIdList, MAX_SHOT_GUIDES, shotFits, staleFlags, staleShots, stepHashes, targetHash } from '../../src/core/shots/lifecycle';
import { parseShotKey, shotKey } from '../../src/core/shots/store';
import { highlightRect } from '../../src/core/shots/render';
import { asPageView, isActiveTabRefusal, isQuotaRefusal, maskBoxes, pageOf, shotStep, toViewport } from '../../src/background/shots';
import { howtoHtml, howtoImageKey, howtoMarkdown } from '../../src/core/sharing/howto';
import { exportJson, keptShots, shotRowKey } from '../../src/entrypoints/sidepanel/ExportReview';
import { parseMessage } from '../../src/core/messaging/protocol';
import type { Guide, Step } from '../../src/core/model/schema';
import type { ShotRecord } from '../../src/core/shots/store';

const rect = (x: number, y: number, w: number, h: number, vw = 1280, vh = 900) => ({ x, y, w, h, vw, vh });

describe('planCrop (D182)', () => {
  it('keeps the element plus 200 px of context, clamped to the image', () => {
    const p = planCrop(rect(500, 400, 100, 40), 1280, 900)!;
    expect(p).toMatchObject({ sx: 300, sy: 200, sw: 500, sh: 440, dw: 500, dh: 440 });
    expect(p.box).toEqual({ x: 200, y: 200, w: 100, h: 40 });
  });

  it('clamps at the image edges and keeps the box where the element is', () => {
    const p = planCrop(rect(10, 20, 50, 30), 1280, 900)!;
    expect(p).toMatchObject({ sx: 0, sy: 0, sw: 10 + 50 + CONTEXT_PX, sh: 20 + 30 + CONTEXT_PX });
    expect(p.box).toEqual({ x: 10, y: 20, w: 50, h: 30 });
  });

  it('works in image pixels on a 2x screen, then fits 800 px wide', () => {
    const p = planCrop(rect(500, 400, 100, 40), 2560, 1800)!;
    // 500 CSS px of crop is 1000 image px; scaled by 0.8 to 800.
    expect(p.sw).toBe(1000);
    expect(p.dw).toBe(MAX_W);
    expect(p.box).toEqual({ x: 320, y: 320, w: 160, h: 64 });
  });

  it('never stores more than 800 px in either direction', () => {
    const p = planCrop(rect(0, 0, 1280, 900), 1280, 900)!;
    expect(p.dw).toBeLessThanOrEqual(800);
    expect(p.dh).toBeLessThanOrEqual(800);
  });

  it('keeps only the visible part of an element partly off screen', () => {
    const p = planCrop(rect(-50, 880, 200, 100), 1280, 900)!;
    expect(p.box.x).toBe(0);
    expect(p.box.y).toBe(880 - p.sy);
    expect(p.box.h).toBe(20);
  });

  it('is null for an element off screen, a bad viewport or junk numbers', () => {
    expect(planCrop(rect(100, 2000, 50, 50), 1280, 900)).toBeNull();
    expect(planCrop(rect(100, 100, 0, 50), 1280, 900)).toBeNull();
    expect(planCrop(rect(100, 100, 50, 50, 0, 900), 1280, 900)).toBeNull();
    expect(planCrop(rect(Number.NaN, 100, 50, 50), 1280, 900)).toBeNull();
    expect(planCrop(rect(100, 100, 50, 50), 0, 0)).toBeNull();
  });

  it('uses the pixel ratio when given: the visible area can be narrower than the layout viewport', () => {
    // A 1200 px layout viewport, of which 814 px show (a side panel): the image is 814 wide at 1x.
    const p = planCrop(rect(30, 200, 20, 20, 1200, 265), 814, 265, 1, 1)!;
    expect(p.box).toEqual({ x: 30, y: 200 - p.sy, w: 20, h: 20 });
    expect(p.sx).toBe(0);
    // Zoom or a 2x screen: device pixels per CSS pixel.
    expect(planCrop(rect(100, 100, 10, 10), 2560, 1800, 1, 2)!.sx).toBe(0);
    expect(planCrop(rect(300, 300, 10, 10), 2560, 1800, 1, 2)!.sx).toBe(200);
    // An element in the part that doesn't show is not captured.
    expect(planCrop(rect(1000, 200, 50, 20, 1200, 265), 814, 265, 1, 1)).toBeNull();
    // A junk ratio falls back to the image width.
    expect(planCrop(rect(300, 300, 10, 10), 1280, 900, 1, Number.NaN)!.sx).toBe(100);
  });

  it('scales down further when asked (the size cap)', () => {
    const full = planCrop(rect(500, 400, 100, 40), 1280, 900)!;
    const half = planCrop(rect(500, 400, 100, 40), 1280, 900, 0.5)!;
    expect(half.dw).toBe(Math.round(full.dw / 2));
    expect(half.box.w).toBe(Math.round(full.box.w / 2));
  });
});

describe('fitUnderCap (D182)', () => {
  it('keeps the first encoding under 60 KB', async () => {
    const out = await fitUnderCap(async (scale) => ({ size: 40_000, scale }));
    expect(out?.scale).toBe(1);
  });
  it('scales down until the image fits', async () => {
    const tried: number[] = [];
    const out = await fitUnderCap(async (scale) => (tried.push(scale), { size: Math.round(100_000 * scale * scale) }));
    expect(out!.image.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(tried).toEqual([1, 0.75]);
  });
  it('gives up after the last try, and when nothing can be drawn', async () => {
    let n = 0;
    expect(await fitUnderCap(async () => (n++, { size: 10 * MAX_BYTES }))).toBeNull();
    expect(n).toBe(MAX_TRIES);
    expect(await fitUnderCap(async () => null)).toBeNull();
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

describe('placing the element at capture time (D183)', () => {
  const view = { vw: 1000, vh: 700, dpr: 2, rect: { x: 10, y: 20, w: 30, h: 40 }, frames: [{ x: 0, y: 500, w: 300, h: 100 }] };
  it("takes the element, viewport, pixel ratio and frames from the page's answer, and refuses junk", () => {
    expect(asPageView(view)).toEqual(view);
    expect(asPageView({ ...view, rect: null })).toEqual({ ...view, rect: null });
    expect(asPageView(true)).toBeNull();
    expect(asPageView(undefined)).toBeNull();
    expect(asPageView({ ...view, vw: '1' })).toBeNull();
    expect(asPageView({ ...view, vw: 0 })).toBeNull();
    expect(asPageView({ ...view, dpr: 0 })).toBeNull();
    expect(asPageView({ ...view, dpr: Infinity })).toBeNull();
    expect(asPageView({ ...view, rect: { x: 1, y: 1, w: 0, h: 5 } })).toBeNull();
    expect(asPageView({ ...view, frames: [{ x: 'a' }] })).toBeNull();
    expect(asPageView({ ...view, frames: undefined })).toBeNull();
    expect(asPageView({ ...view, frames: Array.from({ length: 51 }, () => ({ x: 0, y: 0, w: 1, h: 1 })) })).toBeNull();
  });
  it('the rect is used with the viewport size of the moment', () => {
    expect(toViewport({ x: 90, y: 300, w: 50, h: 20 }, { vw: 800, vh: 600 })).toEqual(rect(90, 300, 50, 20, 800, 600));
  });
  it('review fix: iframes are painted over in the stored image (their fields cannot be hidden)', () => {
    const plan = planCrop(rect(100, 100, 50, 20, 1000, 700), 2000, 1400, 1, 2)!;
    const [m] = maskBoxes([{ x: 0, y: 200, w: 300, h: 100 }], plan, 2);
    const k = plan.dw / plan.sw;
    expect(m!.x).toBe(Math.floor((0 - plan.sx) * k));
    expect(m!.y).toBe(Math.floor((400 - plan.sy) * k));
    expect(m!.w).toBeGreaterThanOrEqual(Math.floor(600 * k));
  });
  it('review fix: a hash route is another page', () => {
    expect(pageOf('https://a.example/app#/customers')).not.toBe(pageOf('https://a.example/app#/orders'));
    expect(pageOf('https://a.example/app?q=1')).toBe(pageOf('https://a.example/app?q=2'));
  });
  it('only top-frame elements are captured', () => {
    expect(shotStep(step('a'), 0)).toBe(true);
    expect(shotStep(step('a'), 3)).toBe(false);
    const framed = step('a');
    framed.target!.framePath = ['iframe#x'];
    expect(shotStep(framed, 0)).toBe(false);
    expect(shotStep({ target: undefined }, 0)).toBe(false);
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

describe('printable how-to with screenshots (D188)', () => {
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
  it('the review drops screenshots the author left out, and those of steps no longer in the guide', () => {
    const g = guide([step('a'), step('b')]);
    const rec = (stepId: string, t = targetHash(step(stepId).target)): ShotRecord => ({ key: `g1/${stepId}`, guideId: 'g1', stepId, blob: new Blob(), w: 1, h: 1, box: { x: 0, y: 0, w: 1, h: 1 }, t, at: 0 });
    const kept = keptShots([g], [rec('a'), rec('b'), rec('old')], new Set([shotRowKey('g1', 'b')]));
    expect(kept.map((x) => x.stepId)).toEqual(['a']);
    // An image of another element than the saved step's (a discarded Re-pick) is not offered.
    expect(keptShots([g], [rec('a', 'stale')], new Set())).toEqual([]);
  });
  it('the outline stays inside the image', () => {
    expect(highlightRect({ x: 0, y: 0, w: 10, h: 10 }, 100, 100)).toEqual({ x: 0, y: 0, w: 14, h: 14 });
    expect(highlightRect({ x: 90, y: 95, w: 20, h: 20 }, 100, 100)).toEqual({ x: 86, y: 91, w: 14, h: 9 });
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
