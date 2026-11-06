/**
 * Issue #78 (D190–D199), end to end: full-page screenshots, steps inside nested frames, the
 * preview page, Save as PDF and Download HTML.
 * - 3 steps: the top page, a same-origin frame, and a cross-origin frame inside it (both
 *   granted). One whole-page image per step, with the element's box where the element is.
 * - Text typed in a frame's field is not in the image (and is in a control capture).
 * - A frame Waymark is not allowed on is painted over; frames it runs in are not.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { BrowserContext, Frame, Page, Worker } from '@playwright/test';
import { canGrant, expect, KEYS_SCRIPT, launch, marker, test as base, type ExtensionHelper } from './fixtures';
import { largestBlob } from './helpers/pixels';

/** The real window, not an emulated viewport: the page's measurements must match the capture. */
const test = base.extend({
  context: async ({ userDataDir }, use) => {
    const context = await launch(userDataDir, null);
    await use(context);
    await context.close();
  },
});

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) for the permission dialog and real shortcut keys');

type Box = { x: number; y: number; w: number; h: number };

interface Stored {
  stepId: string;
  v?: number;
  w: number;
  h: number;
  px: number;
  box: Box;
  size: number;
  type: string;
}

/** Records in the extension's own IndexedDB, read in the service worker. */
function stored(sw: Worker): Promise<Stored[]> {
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('waymark-shots');
      r.onupgradeneeded = () => r.result.createObjectStore('shots', { keyPath: 'key' }).createIndex('guideId', 'guideId');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const recs = await new Promise<(Omit<Stored, 'size' | 'type'> & { blob: Blob })[]>((resolve, reject) => {
      const r = db.transaction('shots').objectStore('shots').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return recs.map(({ blob, ...x }) => ({ ...x, size: blob.size, type: blob.type }));
  });
}

interface Stats {
  /** Pixels darker than 90 (text). */
  dark: number;
  /** Pixels of the mask colour (#d5d9e0). */
  mask: number;
  n: number;
}

/** Pixel stats of areas (image pixels) of a stored image. */
function regionStats(sw: Worker, stepId: string, areas: Box[]): Promise<Stats[]> {
  return sw.evaluate(
    async ({ stepId, areas }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('waymark-shots');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const recs = await new Promise<{ stepId: string; blob: Blob }[]>((resolve) => {
        const r = db.transaction('shots').objectStore('shots').getAll();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      const rec = recs.find((x) => x.stepId === stepId)!;
      const bmp = await createImageBitmap(rec.blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return areas.map((a) => {
        const d = ctx.getImageData(Math.round(a.x), Math.round(a.y), Math.max(1, Math.round(a.w)), Math.max(1, Math.round(a.h))).data;
        let dark = 0;
        let mask = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i]! < 90 && d[i + 1]! < 90 && d[i + 2]! < 90) dark++;
          if (Math.abs(d[i]! - 0xd5) < 6 && Math.abs(d[i + 1]! - 0xd9) < 6 && Math.abs(d[i + 2]! - 0xe0) < 6) mask++;
        }
        return { dark, mask, n: d.length / 4 };
      });
    },
    { stepId, areas },
  );
}

/** Dark pixels in an area (CSS pixels of the top viewport) of a capture taken now, without hiding anything. */
function controlDark(sw: Worker, tabId: number, areas: Box[], dpr: number): Promise<number[]> {
  return sw.evaluate(
    async ({ id, areas, dpr }) => {
      const tab = await chrome.tabs.get(id);
      const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return areas.map((area) => {
        const d = ctx.getImageData(Math.round(area.x * dpr), Math.round(area.y * dpr), Math.round(area.w * dpr), Math.round(area.h * dpr)).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! < 90 && d[i + 1]! < 90 && d[i + 2]! < 90) dark++;
        return dark;
      });
    },
    { id: tabId, areas, dpr },
  );
}

/**
 * Where a colour is in a stored image: the largest connected group of its pixels, the ground
 * truth for a solid button. Anti-aliased text nearby can leave scattered pixels of a similar
 * colour (coloured subpixel fringes on CI's Chrome), so a plain bounding box is not enough.
 */
async function colorBox(sw: Worker, stepId: string, rgb: [number, number, number]): Promise<Box | null> {
  const points = await sw.evaluate(
    async ({ stepId, rgb }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('waymark-shots');
        r.onsuccess = () => resolve(r.result);
      });
      const recs = await new Promise<{ stepId: string; blob: Blob }[]>((resolve) => {
        const r = db.transaction('shots').objectStore('shots').getAll();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      const bmp = await createImageBitmap(recs.find((x) => x.stepId === stepId)!.blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const out: [number, number][] = [];
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (Math.abs(d[i]! - rgb[0]) < 24 && Math.abs(d[i + 1]! - rgb[1]) < 24 && Math.abs(d[i + 2]! - rgb[2]) < 24) out.push([x, y]);
          if (out.length > 200_000) return out;
        }
      return out;
    },
    { stepId, rgb },
  );
  return largestBlob(points);
}

/**
 * Each edge of the stored box within 2 px of the button's solid pixels. Edges, not width: a
 * button at a fractional position has an anti-aliased column on each side that is not solid.
 */
function expectEdgesNear(box: Box, seen: Box, what: string) {
  const edges = (b: Box) => ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h });
  const a = edges(box);
  const b = edges(seen);
  for (const k of ['left', 'top', 'right', 'bottom'] as const) expect(Math.abs(a[k] - b[k]), `${what}: ${k} edge`).toBeLessThanOrEqual(2);
}

async function tabIdFor(ext: ExtensionHelper, page: Page): Promise<number> {
  const url = page.url();
  return (await ext.sw()).evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
}

/** A real key chord to the focused window: chrome.commands ignores CDP key events (D105). */
async function press(app: Page, chord: string) {
  await app.bringToFront();
  await app.waitForTimeout(300);
  execFileSync('python3', [KEYS_SCRIPT, chord]);
}

const canCapture = (sw: Worker, tabId: number) =>
  sw.evaluate(async (id) => {
    const tab = await chrome.tabs.get(id);
    try {
      await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return true;
    } catch {
      return false;
    }
  }, tabId);

const inner = (p: Page): Frame => p.frames().find((f) => f.url().includes('/shots/inner.html'))!;
const partner = (p: Page): Frame => p.frames().find((f) => f.url().includes('/shots/partner.html'))!;

/** Top-viewport box of an element, in any frame (Playwright gives main-frame coordinates). */
async function topBox(f: Frame, selector: string): Promise<Box> {
  const b = (await f.locator(selector).boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

const inset = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });
const scale = (b: Box, s: number): Box => ({ x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s });

async function openApp(context: BrowserContext, url: string, framesReady: (p: Page) => Promise<boolean>) {
  const app = await context.newPage();
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await expect.poll(() => framesReady(app), { timeout: 15_000 }).toBe(true);
  return app;
}

/** Window size, as a normal window (the side panel Alt+W opens takes part of it). */
async function sizeWindow(context: BrowserContext, app: Page, width: number, height: number) {
  const cdp = await context.newCDPSession(app);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
}

const SECRET = 'WWWWWWWWWWWW';
/** The fixture's buttons: Start review (top), Open details (same-origin frame), Approve (cross-origin frame). */
const COLORS: [number, number, number][] = [
  [0x2d, 0x6a, 0x4f],
  [0x1d, 0x4e, 0xd8],
  [0xb9, 0x1c, 0x1c],
];

/** How deep a frame is, from its frame-path test marker (null: not known yet). */
const depth = (m: string | null) => (m ? (JSON.parse(m) as string[]).length : null);

test('3 steps in the top page, a same-origin frame and a cross-origin frame: one full-page image each, highlight in place, field text hidden, then preview, PDF and HTML', async ({ context, ext, site, extensionId }, testInfo) => {
  test.setTimeout(180_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const app = await openApp(context, `${site.main}/shots/index.html`, async (p) => {
    const a = p.frames().find((f) => f.url().includes('/shots/inner.html'));
    const b = p.frames().find((f) => f.url().includes('/shots/partner.html'));
    // Both frames run Waymark and know their path (the frame registry, D45).
    return !!a && !!b && depth(await marker(a, 'frame-path')) === 1 && depth(await marker(b, 'frame-path')) === 2;
  });
  const sw = await ext.sw();
  const tabId = await tabIdFor(ext, app);
  await sizeWindow(context, app, 1500, 1000);
  await press(app, 'Alt_L+w');
  await expect.poll(() => canCapture(sw, tabId), { timeout: 8000 }).toBe(true);

  await ext.message('rec.start', { tabId, title: 'Frames', shots: true });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await expect.poll(() => marker(inner(app), 'recording')).toBe('on');
  await expect.poll(() => marker(partner(app), 'recording')).toBe('on');
  await app.waitForTimeout(700); // the start probe counts against Chrome's 2 captures a second
  // Text in fields of both frames, set without events (so it is not a step): it must not be in any image.
  await inner(app).evaluate((v) => ((document.getElementById('secret') as HTMLInputElement).value = v), SECRET);
  await partner(app).evaluate((v) => ((document.getElementById('note') as HTMLInputElement).value = v), SECRET);

  const targets: [Frame, string][] = [
    [app.mainFrame(), '#start'],
    [inner(app), '#details'],
    [partner(app), '#approve'],
  ];
  const boxes: Box[] = [];
  for (const [f, sel] of targets) {
    boxes.push(await topBox(f, sel));
    await f.locator(sel).click();
    await app.waitForTimeout(900);
  }
  await expect.poll(async () => (await stored(sw)).length, { timeout: 15_000 }).toBe(3);
  const secretBox = await topBox(inner(app), '#secret');
  const noteBox = await topBox(partner(app), '#note');
  const partnerBox = await topBox(inner(app), '#partner');
  const dpr = await app.evaluate(() => devicePixelRatio);
  // Control: without hiding, the typed text is in a capture (dark glyphs in the field).
  await app.waitForTimeout(1100); // Chrome's 2 captures a second
  const control = await controlDark(sw, tabId, [inset(secretBox, 4), inset(noteBox, 4)], dpr);
  for (const n of control) expect(n).toBeGreaterThan(30);

  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  const guide = await ext.message<{ steps: { id: string; target?: { framePath: string[] } }[] }>('guide.get', { id: guideId });
  expect(guide.steps.map((s) => s.target?.framePath.length)).toEqual([0, 1, 2]);
  const shots = await stored(sw);
  // So that a failure on CI explains itself: what was stored and where the buttons are in the images.
  const diag = {
    viewport: await app.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollX, scrollY })),
    playwrightBoxes: boxes,
    rows: await Promise.all(
      guide.steps.map(async (s, i) => {
        const x = shots.find((r) => r.stepId === s.id);
        return { step: i + 1, stored: x ? { w: x.w, h: x.h, px: x.px, box: x.box, size: x.size } : null, seen: x ? await colorBox(sw, s.id, COLORS[i]!) : null };
      }),
    ),
  };
  await testInfo.attach('screenshot-boxes.json', { body: JSON.stringify(diag, null, 2), contentType: 'application/json' });
  for (const [i, s] of guide.steps.entries()) {
    const x = shots.find((r) => r.stepId === s.id)!;
    expect(x, `step ${i + 1} has an image`).toBeTruthy();
    // The whole visible tab, not a crop: as wide as the viewport (at most 1600 px), WebP under 250 KB.
    expect(x.v).toBe(2);
    expect(x.type).toBe('image/webp');
    expect(x.size).toBeLessThanOrEqual(250_000);
    expect(x.w).toBeLessThanOrEqual(1600);
    expect(x.w).toBeGreaterThan(900);
    // The box is where the element is in the top viewport (frame offsets, borders and padding
    // added): where the button's own colour is in the image.
    const seen = (await colorBox(sw, s.id, COLORS[i]!))!;
    expectEdgesNear(x.box, seen, `step ${i + 1} vs the button's pixels`);
    // And where Playwright puts the element. Its boxes inside an out-of-process (cross-origin) frame
    // leave out that iframe's border and padding (2 + 3 px here), so only steps 1 and 2 compare.
    if (i < 2) {
      const want = scale(boxes[i]!, x.px);
      for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(x.box[k] - want[k]), `step ${i + 1} box.${k}`).toBeLessThanOrEqual(2);
    }
    // Field text of both frames is hidden in every image; the frames themselves are not masked.
    const [secret, note, frame] = await regionStats(sw, s.id, [scale(inset(secretBox, 4), x.px), scale(inset(noteBox, 4), x.px), scale(partnerBox, x.px)]);
    expect(secret!.dark, `step ${i + 1}: typed text in the same-origin frame`).toBeLessThan(5);
    expect(note!.dark, `step ${i + 1}: typed text in the cross-origin frame`).toBeLessThan(5);
    expect(frame!.mask / frame!.n).toBeLessThan(0.1);
  }
  // Waymark's UI was put back in every frame.
  for (const f of [app.mainFrame(), inner(app), partner(app)]) expect(await marker(f, 'shot-hidden')).toBe('0');

  // Export → printable how-to → the preview page.
  await sizeWindow(context, app, 1280, 900);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('export').click();
  await panel.getByLabel('Select Frames for export').check();
  await panel.getByTestId('export-selected').click();
  await panel.getByTestId('format-html').check();
  const [preview] = await Promise.all([context.waitForEvent('page'), panel.getByTestId('open-preview').click()]);
  await preview.waitForURL(/howto\.html/);
  await expect(preview.getByTestId('howto-preview')).toHaveAttribute('data-ready', 'yes', { timeout: 15_000 });
  await expect(preview.locator('img[data-testid^="howto-img-"]')).toHaveCount(3);
  // Blur is off by default (D193).
  for (const n of [1, 2, 3]) await expect(preview.getByTestId(`howto-blurstep-${n}`)).not.toBeChecked();
  // The ring is drawn at the element's box in each image (orange just outside the padded box).
  const ring = await preview.evaluate(
    async (rows) =>
      Promise.all(
        rows.map(async ({ n, box, w }) => {
          const img = document.querySelector<HTMLImageElement>(`[data-testid="howto-img-${n}"]`)!;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const u = Math.max(1, w / 1000);
          const at = (x: number, y: number) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
          const orange = ([r, g, b]: number[]) => r! > 190 && g! > 70 && g! < 170 && b! < 90;
          // Left and right edges of the ring at the element's middle height; the element's middle is not orange.
          const y = box.y + box.h / 2;
          const left = [-1, 0, 1].some((d) => orange(at(box.x - 4 * u + d, y)));
          const right = [-1, 0, 1].some((d) => orange(at(box.x + box.w + 4 * u + d, y)));
          return { left, right, w: img.naturalWidth };
        }),
      ),
    guide.steps.map((s, i) => {
      const x = shots.find((r) => r.stepId === s.id)!;
      return { n: i + 1, box: x.box, w: x.w };
    }),
  );
  for (const [i, r] of ring.entries()) expect(r, `ring of step ${i + 1}`).toMatchObject({ left: true, right: true });

  // Save as PDF: the preview prints (checked through Chrome's PDF output of the same page).
  const cdp = await context.newCDPSession(preview);
  const { data } = await cdp.send('Page.printToPDF', { printBackground: true, paperWidth: 8.27, paperHeight: 11.69 });
  const pdf = Buffer.from(data, 'base64').toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  const pages = pdf.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  expect(pages).toBeGreaterThanOrEqual(2);
  expect(pages).toBeLessThanOrEqual(3);
  expect(pdf.match(/\/Subtype\s*\/Image/g)?.length ?? 0).toBeGreaterThanOrEqual(3);

  // Leave one out, blur another, then Download HTML.
  await preview.getByTestId('howto-keep-2').click();
  await preview.getByTestId('howto-blurstep-3').check();
  await expect(preview.getByTestId('howto-preview')).toHaveAttribute('data-ready', 'yes');
  const [dl] = await Promise.all([preview.waitForEvent('download'), preview.getByTestId('howto-download').click()]);
  expect(dl.suggestedFilename()).toBe('guides.html');
  const html = readFileSync((await dl.path())!, 'utf8');
  expect(html.match(/<img src="data:image\/webp;base64,/g)).toHaveLength(2);
  expect(html).toContain("img-src data:");
  expect(html).not.toMatch(/<script|https?:\/\/(?!127\.0\.0\.1)/);
  expect(html).not.toContain(SECRET);
  // The guide file never carries images.
  expect(JSON.stringify(await ext.message('guide.get', { id: guideId }))).not.toMatch(/data:image|webp/);
});

test('a frame Waymark is not allowed on is painted over; the frame it runs in is not', async ({ context, ext, site }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/shots/index.html`, async (p) => {
    const a = p.frames().find((f) => f.url().includes('/shots/inner.html'));
    const b = p.frames().find((f) => f.url().includes('/shots/partner.html'));
    return !!a && !!b && depth(await marker(a, 'frame-path')) === 1;
  });
  // No Waymark in the cross-origin frame (localhost is not granted).
  expect(await marker(partner(app), 'loaded')).toBeNull();
  const sw = await ext.sw();
  const tabId = await tabIdFor(ext, app);
  await sizeWindow(context, app, 1500, 1000);
  await press(app, 'Alt_L+w');
  await expect.poll(() => canCapture(sw, tabId), { timeout: 8000 }).toBe(true);
  await ext.message('rec.start', { tabId, title: 'Masked', shots: true });
  await expect.poll(() => marker(inner(app), 'recording')).toBe('on');
  await app.waitForTimeout(700);
  await partner(app).evaluate((v) => ((document.getElementById('note') as HTMLInputElement).value = v), SECRET);
  const box = await topBox(inner(app), '#details');
  await inner(app).locator('#details').click();
  await expect.poll(async () => (await stored(sw)).length, { timeout: 10_000 }).toBe(1);
  const partnerBox = await topBox(inner(app), '#partner');
  const secretBox = await topBox(inner(app), '#secret');
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  const [x] = await stored(sw);
  const want = scale(box, x!.px);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(x!.box[k] - want[k])).toBeLessThanOrEqual(2);
  const [frame, field, innerArea] = await regionStats(sw, x!.stepId, [scale(inset(partnerBox, 1), x!.px), scale(inset(noteIn(partnerBox), 0), x!.px), scale(inset(secretBox, -20), x!.px)]);
  // The ungranted frame (border box) is the mask colour, so its typed text is not there.
  expect(frame!.mask / frame!.n).toBeGreaterThan(0.97);
  expect(field!.dark).toBe(0);
  // The granted frame around it is not masked.
  expect(innerArea!.mask / innerArea!.n).toBeLessThan(0.05);

  // Capture from the editor (Test step) works for a step inside a frame too (D191).
  await ext.message('shots.set', { guideId, on: false });
  expect(await stored(sw)).toEqual([]);
  await ext.message('shots.set', { guideId, on: true });
  const g = await ext.message<{ steps: { id: string }[]; appOrigins: string[] }>('guide.get', { id: guideId });
  await app.waitForTimeout(600);
  const r = await ext.message<{ found: boolean; shot?: string }>('step.test', { tabId, step: g.steps[0], origins: g.appOrigins, guideId });
  expect(r).toMatchObject({ found: true, shot: 'saved' });
  const [again] = await stored(sw);
  expect(again!.stepId).toBe(g.steps[0]!.id);
  const now = scale(await topBox(inner(app), '#details'), again!.px);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(again!.box[k] - now[k])).toBeLessThanOrEqual(2);
  expect(await ext.message('shots.get', { guideId })).toEqual({ on: true, stepIds: [g.steps[0]!.id], old: [] });
});

/** The partner frame's field area, roughly: inside the frame's top half. */
function noteIn(frame: Box): Box {
  return { x: frame.x + 10, y: frame.y + 10, w: Math.min(320, frame.w - 20), h: Math.min(90, frame.h - 20) };
}

/**
 * CI found (PR #81): the page can move between the moment frames are measured and the capture
 * (here: Playwright scrolls the top page to click inside the frame while the previous step's
 * capture still waits for Chrome's rate limit). A slow CPU, a short window and quick steps make
 * that race likely. Whatever is stored must match its element; a step may have no image.
 */
test('quick steps on a slow CPU while the page scrolls: every stored box is where its element is in the image', async ({ context, ext, site }, testInfo) => {
  test.setTimeout(150_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const app = await openApp(context, `${site.main}/shots/index.html`, async (p) => {
    const a = p.frames().find((f) => f.url().includes('/shots/inner.html'));
    const b = p.frames().find((f) => f.url().includes('/shots/partner.html'));
    return !!a && !!b && depth(await marker(a, 'frame-path')) === 1 && depth(await marker(b, 'frame-path')) === 2;
  });
  const sw = await ext.sw();
  const tabId = await tabIdFor(ext, app);
  // Short: the frame's lower part is below the fold, so clicking in it scrolls the top page.
  await sizeWindow(context, app, 1500, 360);
  await press(app, 'Alt_L+w');
  await expect.poll(() => canCapture(sw, tabId), { timeout: 8000 }).toBe(true);
  const cdp = await context.newCDPSession(app);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  try {
    await ext.message('rec.start', { tabId, title: 'Fast', shots: true });
    await expect.poll(() => marker(partner(app), 'recording')).toBe('on');
    await app.evaluate(() => scrollTo(0, 0));
    await app.waitForTimeout(700);
    for (const [f, sel] of [
      [app.mainFrame(), '#start'],
      [inner(app), '#details'],
      [partner(app), '#approve'],
    ] as const) {
      await f.locator(sel).click({ noWaitAfter: true });
    }
    // Let the queue drain (3 captures at most 2 a second, plus retries).
    await app.waitForTimeout(6000);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  const guide = await ext.message<{ steps: { id: string }[] }>('guide.get', { id: guideId });
  expect(guide.steps).toHaveLength(3);
  const shots = await stored(sw);
  const rows = [];
  for (const [i, s] of guide.steps.entries()) {
    const x = shots.find((r) => r.stepId === s.id);
    rows.push({ step: i + 1, stored: x ? { w: x.w, h: x.h, px: x.px, box: x.box, size: x.size } : null, seen: x ? await colorBox(sw, s.id, COLORS[i]!) : null });
  }
  const diag = { viewport: await app.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollY })), rows };
  await testInfo.attach('screenshot-boxes.json', { body: JSON.stringify(diag, null, 2), contentType: 'application/json' });
  expect(shots.length, JSON.stringify(diag)).toBeGreaterThanOrEqual(1);
  for (const r of rows) {
    if (!r.stored) continue;
    expect(r.seen, `step ${r.step}: its button is in the image`).not.toBeNull();
    expectEdgesNear(r.stored.box, r.seen!, `step ${r.step} ${JSON.stringify(diag)}`);
  }
});
