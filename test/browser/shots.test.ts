/** Step screenshots (D183–D188) in a real browser: the IndexedDB store, hiding in the page, the export render. */
import { afterEach, describe, expect, it } from 'vitest';
import { allShotRefs, clearShots, deleteGuideShots, deleteShots, putShot, shotKey, shotRefsOf, shotsOf, type ShotRecord } from '../../src/core/shots/store';
import { rememberShotTarget, shotTargetRect } from '../../src/content/shots';
import { enqueue } from '../../src/core/storage/queue';
import { stepHashes } from '../../src/core/shots/lifecycle';
import type { Guide } from '../../src/core/model/schema';
import { answerShot, checkShot, settled, hideForShot, onTokenMessage, showAfterShot, TOKEN_MSG, unhideable } from '../../src/content/shots';
import { overlayHost, overlayLayer, destroyOverlay } from '../../src/content/overlay/host';
import { badgeSpot, highlightRect, renderShot, unitOf } from '../../src/core/shots/render';

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
    // Records from 0.5.0 have no version: old close-ups (D196).
    expect(await allShotRefs()).toEqual([{ guideId: 'g2', stepId: 'a', t: 'h', old: true }]);
    await putShot({ ...rec('g2', 'a'), v: 2 });
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
    const { frames } = hideForShot();
    expect(fill(field)).toBe('rgba(0, 0, 0, 0)');
    expect(fill(area)).toBe('rgba(0, 0, 0, 0)');
    expect(frames.map((f) => f.box)).toContainEqual({ x: 10, y: 20, w: 200, h: 100 });
    showAfterShot();
    expect(fill(field)).not.toBe('rgba(0, 0, 0, 0)');
    expect(root.adoptedStyleSheets).toHaveLength(0);
  });

  it('reports each iframe with its border box and content box (border and padding inside it, D191)', () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:30px;top:40px;width:200px;height:100px;border:3px solid #000;padding:5px 7px';
    document.body.append(frame);
    const embed = document.createElement('object');
    embed.style.cssText = 'position:fixed;left:300px;top:40px;width:50px;height:50px;display:block';
    document.body.append(embed);
    const off = document.createElement('iframe');
    off.style.cssText = 'position:fixed;left:-500px;top:0;width:100px;height:100px';
    document.body.append(off);
    const { frames, more } = hideForShot();
    expect(more).toBe(false);
    expect(frames).toHaveLength(2);
    const f = frames.find((x) => x.box.x === 30)!;
    expect(f.box).toEqual({ x: 30, y: 40, w: 220, h: 116 });
    expect(f.content).toEqual({ x: 40, y: 48, w: 200, h: 100 });
    expect(f.k).toBe(1);
    expect(f.frameId).toBe(-1);
    expect(f.token).toBeUndefined();
  });

  it('review fix: a child is named by the token its own window posted, not by a selector; transformed iframes carry none', async () => {
    const mk = (left: number, css = '') => {
      const f = document.createElement('iframe');
      f.style.cssText = `position:fixed;left:${left}px;top:10px;width:100px;height:80px;border:0;${css}`;
      document.body.append(f);
      return f;
    };
    const a = mk(0);
    const b = mk(150);
    const rotated = mk(300, 'transform:rotate(10deg)');
    const post = (f: HTMLIFrameElement, token: string) => onTokenMessage(new MessageEvent('message', { data: { __waymark: TOKEN_MSG, token }, source: f.contentWindow }));
    post(b, 'tb');
    post(rotated, 'tr');
    // A message from a window that is no iframe here, or junk, names nothing.
    onTokenMessage(new MessageEvent('message', { data: { __waymark: TOKEN_MSG, token: 'tx' }, source: window }));
    onTokenMessage(new MessageEvent('message', { data: { __waymark: TOKEN_MSG, token: 7 }, source: a.contentWindow }));
    const { frames } = hideForShot();
    const at = (x: number) => frames.find((f) => Math.round(f.box.x) === x || (x === 300 && f.box.x > 280));
    expect(at(0)!.token).toBeUndefined();
    expect(at(150)!.token).toBe('tb');
    expect(at(300)!.token).toBeUndefined();
  });

  it('review fix: after hiding, a new shadow root, a new iframe or a restore fails the check', () => {
    const ok = () => {
      showAfterShot();
      hideForShot();
      answerShot('t', undefined);
      return checkShot('t');
    };
    expect(ok()).toBe(true);
    expect(checkShot('other')).toBe(false);
    // A web component mounted after the answer: its fields never got the sheet.
    const host = document.createElement('div');
    document.body.append(host);
    expect(ok()).toBe(true);
    host.attachShadow({ mode: 'open' }).append(document.createElement('input'));
    expect(checkShot('t')).toBe(false);
    // A new iframe in view after the answer: it was neither reported nor masked.
    expect(ok()).toBe(true);
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:50px;height:50px';
    document.body.append(f);
    expect(checkShot('t')).toBe(false);
    // Restored (shot.show, or the 2.5 s self-restore): not hidden any more.
    expect(ok()).toBe(true);
    showAfterShot();
    expect(checkShot('t')).toBe(false);
  });

  it('CI fix: a scroll, or the step element moving, after the answer fails the check', () => {
    const tall = document.createElement('div');
    tall.style.height = '3000px';
    document.body.append(tall);
    const b = document.createElement('button');
    b.textContent = 'Go';
    b.style.cssText = 'position:absolute;left:20px;top:100px;width:60px;height:20px';
    document.body.append(b);
    rememberShotTarget('s9', b);
    window.scrollTo(0, 0);
    hideForShot();
    answerShot('t', 's9');
    expect(checkShot('t')).toBe(true);
    // The page scrolled after it answered (the old check compared iframes only and said yes).
    window.scrollTo(0, 47);
    expect(checkShot('t')).toBe(false);
    window.scrollTo(0, 0);
    expect(checkShot('t')).toBe(true);
    // The element itself moved.
    b.style.top = '140px';
    expect(checkShot('t')).toBe(false);
    window.scrollTo(0, 0);
  });

  it('CI fix: the answer waits until the layout is the same across rendered frames; a page that keeps moving is refused', async () => {
    const b = document.createElement('button');
    b.textContent = 'Go';
    b.style.cssText = 'position:fixed;left:20px;top:100px;width:60px;height:20px';
    document.body.append(b);
    rememberShotTarget('s8', b);
    expect(await settled('s8')).toBe(true);
    let on = true;
    // Moves 7 px on every rendered frame, always the same way, so two measurements a couple of
    // frames apart never agree (random positions could land within the 1 px tolerance).
    let n = 0;
    const move = () => {
      if (!on) return;
      b.style.top = `${100 + 7 * (++n % 60)}px`;
      requestAnimationFrame(move);
    };
    move();
    try {
      expect(await settled('s8', 3)).toBe(false);
    } finally {
      on = false;
    }
  });

  it('review fix: a designMode document cannot hide its text, so it does not answer', () => {
    expect(unhideable()).toBe(false);
    document.designMode = 'on';
    try {
      expect(unhideable()).toBe(true);
    } finally {
      document.designMode = 'off';
    }
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

describe('export render (D193)', () => {
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

  it('draws the ring, dim and number from the stored box; blur smears the context but not the element', async () => {
    const blob = await webp(200, 100, paint);
    const shot = { blob, w: 200, h: 100, box: { x: 140, y: 30, w: 40, h: 40 }, v: 2 };
    const sharp = await pixels(await renderShot(shot, { blur: false }));
    const blurred = await pixels(await renderShot(shot, { blur: true }));
    // Ring (orange) just outside the padded box, with a white edge inside it.
    const [r, g, b] = sharp(135, 50);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(70);
    expect(b).toBeLessThan(80);
    expect(sharp(139, 50).slice(0, 3).every((v) => v > 220)).toBe(true);
    // A soft dim around the element: white goes grey, but stays light.
    const dim = sharp(110, 10)[0]!;
    expect(dim).toBeLessThan(220);
    expect(dim).toBeGreaterThan(150);
    // Unblurred stripes alternate black and white; blurred they are grey.
    expect(Math.abs(sharp(0, 50)[0]! - sharp(2, 50)[0]!)).toBeGreaterThan(100);
    expect(Math.abs(blurred(40, 50)[0]! - blurred(42, 50)[0]!)).toBeLessThan(40);
    // The element itself stays sharp, blue and undimmed.
    for (const px of [sharp(160, 50), blurred(160, 50)]) {
      expect(px[2]).toBeGreaterThan(200);
      expect(px[0]).toBeLessThan(40);
    }
  });

  it('draws the step number at the highlight; zoom crops around the element; the stored blob is untouched', async () => {
    const big = await webp(1600, 900, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1600, 900);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(800, 450, 60, 30);
    });
    const shot = { blob: big, w: 1600, h: 900, box: { x: 800, y: 450, w: 60, h: 30 }, v: 2 };
    const numbered = await pixels(await renderShot(shot, { n: 3 }));
    // The badge's orange disc sits beside the highlight's top-left corner, outside it (D158).
    const u = unitOf(1600);
    const hl = highlightRect(shot.box, 1600, 900, 4 * u);
    const spot = badgeSpot(hl, 1600, 900, u);
    expect(spot.cx).toBeLessThan(hl.x);
    expect(spot.cy).toBeLessThan(hl.y);
    const [r, g, b] = numbered(Math.round(spot.cx - spot.r * 0.6), Math.round(spot.cy));
    expect([r! > 180, g! > 70 && g! < 160, b! < 80]).toEqual([true, true, true]);
    // The element itself is not covered: its blue is still there, at its centre and its top-left.
    for (const [x, y] of [[830, 465], [806, 456]] as const) {
      const [er, eg, eb] = numbered(x, y);
      expect([er! < 80, eg! < 80, eb! > 150], `${x},${y}: ${er},${eg},${eb}`).toEqual([true, true, true]);
    }
    const zoomed = await renderShot(shot, { zoom: true });
    const bmp = await createImageBitmap(zoomed);
    expect(bmp.width).toBeLessThan(1600);
    expect(bmp.width / bmp.height).toBeCloseTo(16 / 9, 1);
    bmp.close();
    expect(shot.blob).toBe(big);
    expect(big.size).toBeGreaterThan(0);
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
