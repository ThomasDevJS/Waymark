/** Step screenshots (D183–D188) in a real browser: the IndexedDB store, hiding in the page, the export render. */
import { afterEach, describe, expect, it } from 'vitest';
import { allShotRefs, clearShots, deleteGuideShots, deleteShots, putShot, shotKey, shotRefsOf, shotsOf, type ShotRecord } from '../../src/core/shots/store';
import { rememberShotTarget, shotTargetRect } from '../../src/content/shots';
import { enqueue } from '../../src/core/storage/queue';
import { stepHashes } from '../../src/core/shots/lifecycle';
import type { Guide } from '../../src/core/model/schema';
import { hideForShot, showAfterShot } from '../../src/content/shots';
import { overlayHost, overlayLayer, destroyOverlay } from '../../src/content/overlay/host';
import { renderShot } from '../../src/core/shots/render';

async function webp(w: number, h: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  paint(c.getContext('2d')!);
  return c.convertToBlob({ type: 'image/webp', quality: 0.9 });
}

const rec = (guideId: string, stepId: string, blob = new Blob(['x'], { type: 'image/webp' })): ShotRecord => ({
  key: shotKey(guideId, stepId),
  guideId,
  stepId,
  blob,
  w: 10,
  h: 10,
  box: { x: 1, y: 1, w: 2, h: 2 },
  t: 'h',
  at: Date.now(),
});

describe('IndexedDB store (D184, D185)', () => {
  afterEach(() => clearShots());

  it('stores images per guide and step, and deletes by step and by guide', async () => {
    await putShot(rec('g1', 'a'));
    await putShot(rec('g1', 'b'));
    await putShot(rec('g2', 'a'));
    expect((await shotRefsOf('g1')).map((r) => r.stepId).sort()).toEqual(['a', 'b']);
    const got = await shotsOf('g1');
    expect(got).toHaveLength(2);
    expect(got[0]!.blob).toBeInstanceOf(Blob);
    // A newer capture of the same step replaces the old one.
    await putShot({ ...rec('g1', 'a'), w: 20 });
    expect((await shotsOf('g1')).find((x) => x.stepId === 'a')!.w).toBe(20);

    await deleteShots([{ guideId: 'g1', stepId: 'a' }]);
    expect((await shotRefsOf('g1')).map((r) => r.stepId)).toEqual(['b']);
    await deleteGuideShots(['g1']);
    expect(await shotRefsOf('g1')).toEqual([]);
    expect(await allShotRefs()).toEqual([{ guideId: 'g2', stepId: 'a', t: 'h' }]);
  });
});

describe('hiding for a capture (D183)', () => {
  afterEach(() => {
    showAfterShot();
    destroyOverlay();
    document.body.replaceChildren();
  });

  it("hides Waymark's overlay and the text in fields, keeps labels and buttons, and puts it all back", () => {
    overlayLayer().append(Object.assign(document.createElement('div'), { textContent: 'REC' }));
    const html = '<input id="t" value="Jane Doe"><textarea id="ta">secret</textarea><input id="ph" placeholder="Name"><button id="b">Save</button><input id="s" type="submit" value="Send"><div id="ce" contenteditable="true"><b>typed</b></div>';
    document.body.append(...Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes).map((n) => document.importNode(n, true)));
    const color = (id: string) => getComputedStyle(document.getElementById(id)!).color;
    const fill = (id: string) => getComputedStyle(document.getElementById(id)!).getPropertyValue('-webkit-text-fill-color');
    const before = color('t');
    const styles = document.querySelectorAll('style').length;
    hideForShot();
    expect(getComputedStyle(overlayHost()!).visibility).toBe('hidden');
    for (const id of ['t', 'ta']) expect(fill(id)).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(document.querySelector('#ce b')!).getPropertyValue('-webkit-text-fill-color')).toBe('rgba(0, 0, 0, 0)');
    expect(color('b')).not.toBe('rgba(0, 0, 0, 0)');
    expect(fill('s')).not.toBe('rgba(0, 0, 0, 0)');
    // The page's DOM is unchanged: no style element was added.
    expect(document.querySelectorAll('style').length).toBe(styles);
    showAfterShot();
    expect(getComputedStyle(overlayHost()!).visibility).toBe('visible');
    expect(color('t')).toBe(before);
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });

  it('review fix: field text inside shadow roots is hidden too, and iframes in view are reported', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const field = document.createElement('input');
    field.value = 'typed in a web component';
    field.style.color = 'black';
    root.append(field);
    const inner = document.createElement('div');
    root.append(inner);
    const nested = inner.attachShadow({ mode: 'open' });
    const area = document.createElement('textarea');
    nested.append(area);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:10px;top:20px;width:200px;height:100px;border:0';
    document.body.append(frame);
    const fill = (el: Element) => getComputedStyle(el).getPropertyValue('-webkit-text-fill-color');
    const frames = hideForShot();
    expect(fill(field)).toBe('rgba(0, 0, 0, 0)');
    expect(fill(area)).toBe('rgba(0, 0, 0, 0)');
    expect(frames).toContainEqual({ x: 10, y: 20, w: 200, h: 100 });
    showAfterShot();
    expect(fill(field)).not.toBe('rgba(0, 0, 0, 0)');
    expect(root.adoptedStyleSheets).toHaveLength(0);
  });

  it("review fix: the step's own element is measured at capture time; gone or hidden means no picture", () => {
    const b = document.createElement('button');
    b.textContent = 'Save';
    b.style.cssText = 'position:fixed;left:50px;top:60px;width:80px;height:30px';
    document.body.append(b);
    rememberShotTarget('s1', b);
    expect(shotTargetRect('s1')).toEqual({ x: 50, y: 60, w: 80, h: 30 });
    b.style.top = '300px'; // moved after the click (scroll, layout shift)
    expect(shotTargetRect('s1')!.y).toBe(300);
    b.style.display = 'none';
    expect(shotTargetRect('s1')).toBeNull();
    b.remove();
    expect(shotTargetRect('s1')).toBeNull();
    expect(shotTargetRect('unknown')).toBeNull();
    expect(shotTargetRect(undefined)).toBeNull();
  });

  it('an overlay made while hidden is hidden too', () => {
    hideForShot();
    overlayLayer();
    expect(getComputedStyle(overlayHost()!).visibility).toBe('hidden');
  });
});

describe('export render (D188)', () => {
  // Left half: black text-like stripes (the context); the element: a solid blue box.
  const paint = (ctx: OffscreenCanvasRenderingContext2D) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = '#000';
    for (let x = 0; x < 100; x += 4) ctx.fillRect(x, 0, 2, 100);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(140, 30, 40, 40);
  };
  async function pixels(blob: Blob) {
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  }

  it('draws the outline from the stored box; blur smears the context but not the element', async () => {
    const blob = await webp(200, 100, paint);
    const shot = { blob, w: 200, h: 100, box: { x: 140, y: 30, w: 40, h: 40 } };
    const sharp = await pixels(await renderShot(shot, { blur: false }));
    const blurred = await pixels(await renderShot(shot, { blur: true }));
    // Outline (orange) at the padded box's edge.
    const [r, g, b] = sharp(137, 50);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(70);
    expect(b).toBeLessThan(80);
    // Unblurred stripes alternate black and white; blurred they are grey.
    expect(Math.abs(sharp(0, 50)[0]! - sharp(2, 50)[0]!)).toBeGreaterThan(150);
    expect(Math.abs(blurred(40, 50)[0]! - blurred(42, 50)[0]!)).toBeLessThan(40);
    // The element itself stays sharp and blue.
    const inside = blurred(160, 50);
    expect(inside[2]).toBeGreaterThan(200);
    expect(inside[0]).toBeLessThan(40);
  });
});

describe('sweep (D185)', () => {
  /** A chrome.storage stand-in whose calls yield, so queued and unqueued work interleave. */
  function fakeChrome() {
    const area = (readMs = 1) => {
      const data: Record<string, unknown> = {};
      const tick = () => new Promise((r) => setTimeout(r, 1));
      return {
        data,
        async get(keys: string | string[] | null) {
          await new Promise((r) => setTimeout(r, readMs));
          if (keys === null) return structuredClone(data);
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) if (k in data) out[k] = structuredClone(data[k]);
          return out;
        },
        async set(items: Record<string, unknown>) {
          await tick();
          Object.assign(data, structuredClone(items));
        },
        async remove(keys: string | string[]) {
          await tick();
          for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        },
      };
    };
    // Session reads are slow, so an unqueued sweep reads the recording only after Stop cleared it.
    return { storage: { local: area(), session: area(40) }, alarms: { create: async () => undefined } };
  }

  afterEach(async () => {
    await clearShots();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('review fix: a sweep during Stop never deletes the new guide\'s images', async () => {
    const chromeFake = fakeChrome();
    (globalThis as { chrome?: unknown }).chrome = chromeFake;
    const { sweepShots, addShotsFlagInQueue } = await import('../../src/background/shots');
    const { writeGuide } = await import('../../src/core/storage/guides');
    const guide: Guide = {
      id: 'G1',
      schemaVersion: 1,
      revisionId: 'r1',
      title: 'Rec',
      lang: 'en',
      tags: [],
      appOrigins: ['https://app.example'],
      startUrl: 'https://app.example/',
      matchUrls: [],
      steps: [{ id: 's1', kind: 'click', title: 'Click', url: { kind: 'pattern', value: '/' }, advance: 'action', target: { instance: 'unique', matchCount: 1, tag: 'button', cssPath: '#b', xpath: '/x', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } } }],
      version: 1,
      source: 'local',
      updatedAt: '2026-11-06T00:00:00Z',
    };
    await putShot({ ...rec('G1', 's1'), t: stepHashes(guide).get('s1')! });
    await chromeFake.storage.session.set({ recording: { guideId: 'G1' } });
    // rec.stop's queued task: write the guide, turn screenshots on, clear the recording.
    const stop = enqueue(async () => {
      await writeGuide(guide);
      await addShotsFlagInQueue('G1');
      await chromeFake.storage.session.remove('recording');
    });
    // A sweep from another trigger (an alarm, the Library opening) starts meanwhile.
    const sweep = sweepShots();
    await Promise.all([stop, sweep]);
    expect((await shotRefsOf('G1')).map((r) => r.stepId)).toEqual(['s1']);
    expect(chromeFake.storage.local.data['shots:guides']).toEqual(['G1']);
    // Once the guide is gone (and out of the trash), the next sweep removes both.
    await enqueue(async () => {
      const { writeGuides } = await import('../../src/core/storage/guides');
      await writeGuides([], ['G1']);
    });
    await sweepShots();
    expect(await shotRefsOf('G1')).toEqual([]);
    expect(chromeFake.storage.local.data['shots:guides']).toBeUndefined();
  });
});
