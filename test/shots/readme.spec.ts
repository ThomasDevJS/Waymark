/**
 * Raw screenshots for the README (issue #109, D230). Not part of `pnpm check` or CI: run
 * `pnpm shots:readme`, which runs this, then `scripts/readme-art.mjs` (frames and posters) and
 * `scripts/readme-pack.py` (palette PNGs in docs/assets/).
 *
 * Everything happens on the made-up "Demo Books" pages in the fixture site
 * (test/fixtures/site/showcase/, D231). Chromium runs headed under Xvfb at a device scale factor
 * of 2, with real windows (no emulated viewport), so the pages and the how-to's step pictures
 * are both sharp. The side panel is an extension page in its own popup window, sized like
 * Chrome's side panel; scripts/readme-art.mjs puts it next to the page in a drawn window.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { canGrant, EXT_PATH, expect, KEYS_SCRIPT, marker, test as base } from '../e2e/fixtures';
import { chromium } from '@playwright/test';
// @ts-expect-error plain JS module without types
import { startFixtureServer } from '../fixtures/server.mjs';

const OUT = join(process.cwd(), 'artifacts', 'readme', 'raw');
/** CSS sizes: the page beside a 400 px side panel in a 1440 × 760 window. */
const PAGE = { width: 1040, height: 720 };
const PANEL = { width: 400, height: 720 };
/** The how-to preview is shot taller, so its first step's picture is whole. */
const HOWTO_HEIGHT = 1400;

const test = base.extend<object, { site: { port: number; main: string; other: string } }>({
  // A fixed port, so the panel shows the same address in every shot.
  site: [
    async ({}, use) => {
      const server = await startFixtureServer(Number(process.env.SHOTS_PORT ?? 4173));
      await use({ port: 4173, main: `http://127.0.0.1:${server.address().port}`, other: `http://localhost:${server.address().port}` });
      server.close();
    },
    { scope: 'worker' },
  ],
  context: async ({ userDataDir }, use) => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: process.env.WAYMARK_CHROMIUM ?? '/opt/pw-browsers/chromium',
      headless: false,
      viewport: null,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=2', '--hide-scrollbars', '--window-size=1100,800'],
    });
    await use(context);
    await context.close();
  },
});

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

/** Sizes a page's window so its viewport is exactly `w` × `h` CSS px. */
async function fit(context: BrowserContext, page: Page, w: number, h: number) {
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  for (let i = 0; i < 6; i++) {
    const [iw, ih, ow, oh] = await page.evaluate(() => [innerWidth, innerHeight, outerWidth, outerHeight]);
    if (iw === w && ih === h) return;
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: ow! + w - iw!, height: oh! + h - ih! } });
    await page.waitForTimeout(250);
  }
  const got = await page.evaluate(() => [innerWidth, innerHeight]);
  throw new Error(`window did not fit ${w}×${h}: ${got.join('×')}`);
}

const tabIdFor = (sw: Worker, url: string) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
}

/** A real key chord: chrome.commands ignores CDP key events (D105). */
async function press(page: Page, chord: string) {
  await page.bringToFront();
  await page.waitForTimeout(300);
  execFileSync('python3', [KEYS_SCRIPT, chord]);
}

/** Picks a native select's option with real keys (typed letters on the closed select), as a person would. */
async function choose(page: Page, label: string, typed: string) {
  await page.getByLabel(label).focus();
  await page.keyboard.type(typed, { delay: 30 });
  // A closed select changes on typed letters; leave it without moving focus into the next field.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const TITLES = ['Record a payment', 'Add a customer', 'Set up payment reminders', 'Export the monthly report', 'Close the month', 'Invite your accountant'];

test('README screenshots', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(240_000);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const base = `chrome-extension://${extensionId}`;
  const home = `${site.main}/showcase/index.html`;
  await ext.grant('http://127.0.0.1/*');
  const sw = await ext.sw();

  const app = await context.newPage();
  await app.goto(home);
  await expect.poll(() => marker(app, 'loaded'), { timeout: 10_000 }).toBe('yes');
  for (const p of context.pages()) if (p !== app) await p.close();
  const tabId = await tabIdFor(sw, app.url());
  // Alt+W is the toolbar button's command: it opens Chrome's side panel and grants activeTab,
  // which the how-to's step pictures need (D181). The page is then fitted beside it.
  await press(app, 'Alt_L+w');
  await expect
    .poll(() => sw.evaluate(async (id) => chrome.tabs.captureVisibleTab((await chrome.tabs.get(id)).windowId, { format: 'png' }).then(() => true, () => false), tabId), { timeout: 8000 })
    .toBe(true);
  await fit(context, app, PAGE.width, PAGE.height);

  // The panel: an extension page in its own popup window, so it keeps its own size.
  const [panel] = await Promise.all([
    context.waitForEvent('page'),
    sw.evaluate(({ u, w, h }) => chrome.windows.create({ url: u, type: 'popup', focused: false, width: w, height: h }), { u: `${base}/sidepanel.html?tab=${tabId}`, w: PANEL.width, h: PANEL.height + 60 }),
  ]);
  await panel.waitForLoadState();
  await fit(context, panel, PANEL.width, PANEL.height);
  const welcome = panel.getByTestId('welcome-done');
  if (await welcome.isVisible().catch(() => false)) await welcome.click();

  // 1. Recording: the outline on the button about to be clicked, the REC pill, the recording card.
  await ext.message('rec.start', { tabId, title: 'Send an invoice', shots: true });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.bringToFront();
  await app.waitForTimeout(700); // Chrome allows 2 captures a second
  await app.getByRole('link', { name: 'New invoice' }).click();
  await app.waitForLoadState();
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.waitForTimeout(700);
  await choose(app, 'Customer', 'Tansy');
  await app.waitForTimeout(700);
  await app.getByLabel('Item').click();
  await app.keyboard.type('Sourdough workshop');
  await app.waitForTimeout(700);
  await app.getByLabel('Amount').click();
  await app.keyboard.type('480');
  await app.waitForTimeout(700);
  await choose(app, 'Payment terms', 'Net 3');
  await app.waitForTimeout(700);
  // No caret or selected text in the picture.
  await app.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), getSelection()?.removeAllRanges()));
  await app.getByRole('button', { name: 'Create invoice' }).hover();
  await app.waitForTimeout(500);
  await shot(app, 'record-page');
  await panel.reload();
  await expect(panel.getByTestId('stop')).toBeVisible();
  await shot(panel, 'record-panel');
  await app.getByRole('button', { name: 'Create invoice' }).click();
  await app.waitForLoadState();
  await app.waitForTimeout(900);
  const stopped = await ext.message<{ guideId: string }>('rec.stop', {});
  const guideId = stopped.guideId;

  // Titles a person would write, and a note on the amount step.
  const g = await ext.message<{ revisionId: string; steps: { title: string; note?: string; kind: string }[] } & Record<string, unknown>>('guide.get', { id: guideId });
  const titles = ['Click **New invoice**', 'Choose the **customer**', 'Describe what you are billing for', 'Enter the **amount**', 'Pick the **payment terms**', 'Click **Create invoice**'];
  const steps = g.steps.map((s, i) => ({ ...s, title: titles[i] ?? s.title, ...(i === 3 ? { note: 'Before tax. Demo Books adds it on the next page.' } : {}) }));
  await ext.message('guide.save', { guide: { ...g, steps, tags: ['billing', 'getting started'] }, baseRevisionId: g.revisionId });

  // 2. Editor: the guide's steps, the amount step open.
  await app.goto(`${site.main}/showcase/new-invoice.html`);
  await expect.poll(() => marker(app, 'loaded'), { timeout: 10_000 }).toBe('yes');
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}&edit=${guideId}`);
  await expect(panel.getByTestId('save-guide')).toBeVisible();
  for (let i = 0; i < steps.length; i++) {
    const open = panel.getByTestId(`step-${i}-title`);
    if ((await open.count()) && i !== 3) await panel.getByTestId(`step-${i}-toggle`).click();
  }
  if (!(await panel.getByTestId('step-3-title').count())) await panel.getByTestId('step-3-toggle').click();
  await panel.getByTestId('step-3-test').click();
  await expect(panel.getByTestId('step-3-test-result')).not.toContainText('Looking', { timeout: 12_000 });
  await panel.getByTestId('step-0').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await panel.evaluate(() => scrollBy(0, -12));
  await shot(panel, 'editor-panel');
  await app.bringToFront();
  await shot(app, 'editor-page');
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}`);

  // 3. Playing: the spotlight, the tooltip and its step count, on the form's second step.
  await app.goto(home);
  await expect.poll(() => marker(app, 'loaded'), { timeout: 10_000 }).toBe('yes');
  await ext.message('run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^drawn:0/);
  await app.bringToFront();
  await shot(app, 'clip-0');
  await app.getByRole('link', { name: 'New invoice' }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^drawn:1/);
  await shot(app, 'play-page');
  await shot(app, 'clip-1');
  // The panel at the same step, without the HD voice offer (answered "Not now").
  await panel.reload();
  await expect(panel.getByTestId('run-status')).toBeVisible();
  const later = panel.getByTestId('hd-offer-later');
  if (await later.isVisible().catch(() => false)) await later.click();
  await expect(panel.getByTestId('run-step')).toContainText('Choose the customer');
  await shot(panel, 'play-panel');
  await app.bringToFront();
  await choose(app, 'Customer', 'Tansy');
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^drawn:2/);
  await shot(app, 'clip-2');
  await app.getByLabel('Item').fill('Sourdough workshop');
  await app.getByLabel('Item').press('Tab');
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^drawn:3/);
  await shot(app, 'clip-3');
  await ext.message('run.stop', { tabId });

  // 4. The "?" launcher with its search: six guides or more for the page (D170).
  for (const title of TITLES) {
    const copy = await ext.message<{ id: string }>('guide.duplicate', { id: guideId });
    const c = await ext.message<{ revisionId: string } & Record<string, unknown>>('guide.get', { id: copy.id });
    await ext.message('guide.save', { guide: { ...c, title }, baseRevisionId: c.revisionId });
  }
  await app.goto(home);
  await expect.poll(() => marker(app, 'launcher'), { timeout: 10_000 }).not.toBe(null);
  await app.bringToFront();
  await app.locator('waymark-overlay .wm-launch').click();
  await app.locator('waymark-overlay #wm-launcher-q').fill('pay');
  await shot(app, 'launcher-page');

  // 5. The printable how-to: the export review opens its preview.
  await app.keyboard.press('Escape');
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('export').click();
  await panel.getByLabel('Select Send an invoice for export').check();
  await panel.getByTestId('export-selected').click();
  await panel.getByTestId('format-html').check();
  const [preview] = await Promise.all([context.waitForEvent('page'), panel.getByTestId('open-preview').click()]);
  await preview.waitForURL(/howto\.html/);
  await expect(preview.getByTestId('howto-preview')).toHaveAttribute('data-ready', 'yes', { timeout: 15_000 });
  // Tall enough to end just under the first step picture, so the shot doesn't stop mid-image.
  const imgBottom = await preview.locator('img[data-testid^="howto-img-"]').first().evaluate((e) => Math.ceil(e.getBoundingClientRect().bottom));
  await fit(context, preview, PAGE.width, Math.min(imgBottom + 28, HOWTO_HEIGHT));
  await shot(preview, 'howto-page');

  writeFileSync(join(OUT, 'done.txt'), new Date().toISOString() + '\n');
});
