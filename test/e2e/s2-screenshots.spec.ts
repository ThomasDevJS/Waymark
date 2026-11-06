/**
 * Step screenshots for the printable how-to (D180–D188), end to end:
 * - with screenshots on (and Waymark invoked on the tab with Alt+W, which grants activeTab),
 *   each recorded step gets a cropped WebP under 60 KB with no Waymark UI in it; the printable
 *   how-to shows one marked image per step; the guide file has none;
 * - off by default: nothing is captured, even where Chrome would allow it (Alt+R grants it too);
 * - without activeTab, Chrome refuses: recording goes on and the one-click hint shows; after
 *   Alt+W, Capture in the editor (Test step) fills the missing screenshot.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { canGrant, expect, KEYS_SCRIPT, launch, marker, test as base, type ExtensionHelper } from './fixtures';

/** The real window, not an emulated viewport: the page's measurements must match the capture. */
const test = base.extend({
  context: async ({ userDataDir }, use) => {
    const context = await launch(userDataDir, null);
    await use(context);
    await context.close();
  },
});

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) for the permission dialog and real shortcut keys');

interface StoredShot {
  stepId: string;
  w: number;
  h: number;
  box: { x: number; y: number; w: number; h: number };
  size: number;
  type: string;
  /** Pixels of the REC pill's red (#d93025) anywhere in the image. */
  red: number;
}

/** The stored screenshots, read in the service worker (the extension's own IndexedDB). */
function storedShots(sw: Worker): Promise<StoredShot[]> {
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('waymark-shots');
      r.onupgradeneeded = () => r.result.createObjectStore('shots', { keyPath: 'key' }).createIndex('guideId', 'guideId');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const recs = await new Promise<{ stepId: string; w: number; h: number; box: StoredShot['box']; blob: Blob }[]>((resolve, reject) => {
      const r = db.transaction('shots').objectStore('shots').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return Promise.all(
      recs.map(async (x) => {
        const bmp = await createImageBitmap(x.blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let red = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 170 && d[i + 1]! < 100 && d[i + 2]! < 100) red++;
        return { stepId: x.stepId, w: x.w, h: x.h, box: x.box, size: x.blob.size, type: x.blob.type, red };
      }),
    );
  });
}

async function tabIdFor(ext: ExtensionHelper, page: Page): Promise<number> {
  const url = page.url();
  return (await ext.sw()).evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
}

async function openApp(context: BrowserContext, url: string) {
  const app = await context.newPage();
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  return app;
}

/** A real key chord to the focused window: chrome.commands ignores CDP key events (D105). */
async function press(app: Page, chord: string) {
  await app.bringToFront();
  await app.waitForTimeout(300);
  execFileSync('python3', [KEYS_SCRIPT, chord]);
}

/** Can the service worker capture this tab now (activeTab granted)? */
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

const pillRect = (app: Page) =>
  app.evaluate(() => {
    const r = document.querySelector('waymark-overlay')!.shadowRoot!.querySelector('.pill .dot')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

test('screenshots on: one clean crop per step, a marked image per step in the printable how-to, none in the guide file', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const sw = await ext.sw();
  const tabId = await tabIdFor(ext, app);
  // Alt+W is the toolbar button's command: it opens the side panel and grants activeTab (D181).
  expect(await canCapture(sw, tabId)).toBe(false);
  await press(app, 'Alt_L+w');
  await expect.poll(() => canCapture(sw, tabId), { timeout: 8000 }).toBe(true);
  // A real, short window (Playwright's emulated viewport is not what the tab shows): each crop,
  // the element and 200 px around it, then reaches the REC pill at the bottom.
  const cdp = await context.newCDPSession(app);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1200, height: 360 } });
  await expect.poll(() => app.evaluate(() => innerHeight), { timeout: 5000 }).toBeLessThan(300);

  await ext.message('rec.start', { tabId, title: 'Shots', shots: true });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.waitForTimeout(700); // the start probe counts against Chrome's 2 captures a second
  const dot = await pillRect(app);
  const crops: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const name of ['Import', 'Export']) {
    const b = (await app.getByRole('button', { name, exact: true }).boundingBox())!;
    crops.push({ x0: b.x - 200, y0: b.y - 200, x1: b.x + b.width + 200, y1: b.y + b.height + 200 });
    await app.getByRole('button', { name, exact: true }).click();
    await app.waitForTimeout(700);
  }
  // The pill's dot is inside both crops: if it were not hidden, it would be in the images.
  for (const c of crops) expect(dot.x > c.x0 && dot.x < c.x1 && dot.y > c.y0 && dot.y < c.y1).toBe(true);
  await expect.poll(async () => (await storedShots(sw)).length, { timeout: 10_000 }).toBe(2);
  // Waymark's UI was put back after each capture.
  expect(await marker(app, 'shot-hidden')).toBe('0');

  // Control: the same capture without hiding shows the pill's red at the dot.
  const visibleRed = await sw.evaluate(
    async ({ id, x, y, dpr }) => {
      const tab = await chrome.tabs.get(id);
      const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const s = dpr;
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(Math.round(x * s) - 3, Math.round(y * s) - 3, 6, 6).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 170 && d[i + 1]! < 100 && d[i + 2]! < 100) red++;
      return red;
    },
    { id: tabId, dpr: await app.evaluate(() => devicePixelRatio), ...dot },
  );
  expect(visibleRed).toBeGreaterThan(0);

  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  const shots = await storedShots(sw);
  const guide = await ext.message<{ steps: { id: string }[] }>('guide.get', { id: guideId });
  expect(shots.map((s) => s.stepId).sort()).toEqual(guide.steps.map((s) => s.id).sort());
  for (const s of shots) {
    expect(s.type).toBe('image/webp');
    expect(s.size).toBeLessThanOrEqual(60_000);
    expect(s.w).toBeLessThanOrEqual(800);
    expect(s.red).toBe(0); // no Waymark UI in the image
    expect(s.box.w).toBeGreaterThan(10);
  }
  // The guide itself carries no image, and the editor knows which steps have one.
  expect(JSON.stringify(guide)).not.toMatch(/data:image|webp/);
  expect(await ext.message('shots.get', { guideId })).toEqual({ on: true, stepIds: expect.arrayContaining(guide.steps.map((s) => s.id)) });

  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1280, height: 900 } });
  // Printable how-to: the review lists each image; the file has one marked image per step.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('export').click();
  await panel.getByLabel('Select Shots for export').check();
  await panel.getByTestId('export-selected').click();
  await panel.getByTestId('format-html').check();
  await expect(panel.getByTestId('shot-1').locator('img')).toBeVisible();
  await expect(panel.getByTestId('shot-2').locator('img')).toBeVisible();
  await expect(panel.getByTestId('export-blur')).toBeChecked();
  const [html] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download-howto').click()]);
  const page = readFileSync((await html.path())!, 'utf8');
  expect(page.match(/<img src="data:image\/webp;base64,/g)).toHaveLength(2);
  expect(page).toContain("img-src data:");
  const view = await context.newPage();
  await view.setContent(page);
  await expect(view.locator('ol > li figure img')).toHaveCount(2);
  // Each image has the orange outline drawn at export time.
  const outlined = await view.evaluate(async () =>
    Promise.all(
      Array.from(document.images).map(async (img) => {
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let orange = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 80 && d[i + 1]! < 160 && d[i + 2]! < 70) orange++;
        return orange;
      }),
    ),
  );
  for (const n of outlined) expect(n).toBeGreaterThan(50);

  // The author can leave an image out.
  await panel.getByTestId(`more-${guideId}`).click();
  await panel.getByTestId(`share-${guideId}`).click();
  await panel.getByTestId('format-html').check();
  await panel.getByTestId('remove-shot-2').click();
  const [one] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download-howto').click()]);
  expect(readFileSync((await one.path())!, 'utf8').match(/<img /g)).toHaveLength(1);

  // A guide file never carries images.
  await panel.getByTestId(`more-${guideId}`).click();
  await panel.getByTestId(`share-${guideId}`).click();
  await panel.getByTestId('format-pack').check();
  await expect(panel.getByTestId(`export-shots-${guideId}`)).toHaveCount(0);
  const [pack] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download-pack').click()]);
  expect(readFileSync((await pack.path())!, 'utf8')).not.toMatch(/data:image|webp|screenshot/i);

  // Turning screenshots off deletes them.
  await ext.message('shots.set', { guideId, on: false });
  expect(await storedShots(sw)).toEqual([]);
});

test('screenshots are off by default: nothing is captured, even where Chrome would allow it', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const sw = await ext.sw();
  const tabId = await tabIdFor(ext, app);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByTestId('record-shots')).not.toBeChecked();
  // Turning it on first shows the notice; nothing changes until the author confirms.
  await panel.getByTestId('record-shots').click();
  await expect(panel.getByTestId('record-shots-notice')).toContainText('customer data');
  await expect(panel.getByTestId('record-shots')).not.toBeChecked();
  await panel.close();

  // Alt+R records with screenshots off, and grants activeTab (D181).
  await press(app, 'Alt_L+r');
  await expect.poll(() => marker(app, 'recording'), { timeout: 8000 }).toBe('on');
  expect(await canCapture(sw, tabId)).toBe(true);
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(400);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(1200);
  const state = await ext.message<{ shots?: boolean; steps: unknown[] }>('rec.state', {});
  expect(state.steps).toHaveLength(2);
  expect(state.shots).toBeUndefined();
  await press(app, 'Alt_L+r');
  await expect.poll(() => marker(app, 'recording'), { timeout: 8000 }).not.toBe('on');
  expect(await storedShots(sw)).toEqual([]);
  // The page was never asked to hide anything for a capture.
  expect(await marker(app, 'shot-hidden')).toBeNull();
  const list = await ext.message<{ guides: { id: string }[] }>('guide.list', {});
  expect(await ext.message('shots.get', { guideId: list.guides[0]!.id })).toEqual({ on: false, stepIds: [] });
});

test('without activeTab Chrome refuses: recording goes on with a one-click hint; after Alt+W, Capture fills the step', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const sw = await ext.sw();
  const tabId = await tabIdFor(ext, app);
  await ext.message('rec.start', { tabId, title: 'No grant', shots: true });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  // The start probe was refused: the panel's recording card shows the hint.
  await expect.poll(async () => (await ext.message<{ shotHint?: boolean }>('rec.state', {})).shotHint, { timeout: 8000 }).toBe(true);
  // The page hears it once, in the REC pill.
  await expect
    .poll(() => app.evaluate(() => document.querySelector('waymark-overlay')!.shadowRoot!.querySelector('.pill')?.textContent ?? ''), { timeout: 5000 })
    .toContain('Screenshots need one click on the Waymark icon (or Alt+W) on this tab.');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(800);
  const st = await ext.message<{ steps: { id: string }[] }>('rec.state', {});
  expect(st.steps).toHaveLength(1);
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  expect(await storedShots(sw)).toEqual([]);

  // The editor marks the step and offers Capture.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}&edit=${guideId}`);
  await panel.getByTestId('step-0-toggle').click();
  await expect(panel.getByTestId('step-0-noshot')).toContainText('No screenshot');
  await expect(panel.getByTestId('step-0-capture')).toBeVisible();
  await panel.close();

  // One press of Alt+W on the tab allows screenshots there; Capture (Test step) takes it.
  await press(app, 'Alt_L+w');
  await expect.poll(() => canCapture(sw, tabId), { timeout: 8000 }).toBe(true);
  const g = await ext.message<{ steps: { id: string }[]; appOrigins: string[] }>('guide.get', { id: guideId });
  const r = await ext.message<{ found: boolean; shot?: string }>('step.test', { tabId, step: g.steps[0], origins: g.appOrigins, guideId });
  expect(r).toMatchObject({ found: true, shot: 'saved' });
  const shots = await storedShots(sw);
  expect(shots.map((s) => s.stepId)).toEqual([g.steps[0]!.id]);
  expect(shots[0]!.red).toBe(0); // the Test step spotlight was hidden too

  // Deleting the guide keeps its image while Undo is possible; the sweep after it removes it.
  await ext.message('guide.delete', { id: guideId });
  expect(await storedShots(sw)).toHaveLength(1);
  // Stand in for the alarm firing after the Undo window: move the trash entry back in time.
  await sw.evaluate(async () => {
    const t = (await chrome.storage.local.get('guides:trash'))['guides:trash'] as { deletedAt: number }[];
    await chrome.storage.local.set({ 'guides:trash': t.map((e) => ({ ...e, deletedAt: e.deletedAt - 60_000 })) });
  });
  expect(await sw.evaluate(async () => (await chrome.alarms.get('shots-sweep'))?.name ?? null)).toBe('shots-sweep');
  await ext.message('trash.list', {}); // a purge point, as the alarm is
  await expect.poll(async () => (await storedShots(sw)).length, { timeout: 5000 }).toBe(0);
});
