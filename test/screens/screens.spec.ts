/**
 * Screenshots of every screen and state, in light and dark (D90). Not part of `pnpm check` or
 * CI: run `pnpm screens` (headed under Xvfb, like e2e) and look at the PNGs it writes to
 * `artifacts/screens/<SHOTS>/` (default `current`, git-ignored); pick a few for
 * `docs/screenshots/` with `scripts/shots.py`.
 *
 * Panels are shot at a side-panel size (400 px wide). On-page UI is shot on the demo app with a
 * light host page and with a dark one (a dark style injected into the demo), plus a 640×450
 * viewport, which is what 200% zoom of a 1280×900 window looks like to CSS.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from '../e2e/fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const OUT = join(process.cwd(), 'artifacts', 'screens', process.env.SHOTS ?? 'current');
const PORT = Number(process.env.SHOTS_PORT ?? 8093);
const DEMO = `http://127.0.0.1:${PORT}`;
const PANEL = { width: 400, height: 860 };
const DARK_HOST = `body{background:#111318!important;color:#e5e7ec!important}.card{background:#1b1e25!important;border-color:#2c313c!important}
button,.button{background:#252a33!important;color:#e5e7ec!important;border-color:#3a414d!important}.primary{background:#3b6fe0!important}
input,select,textarea{background:#1b1e25;color:#e5e7ec;border-color:#3a414d}`;

let server: ChildProcess | undefined;
test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  server = spawn(process.execPath, ['demo/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await expect.poll(() => fetch(`${DEMO}/index.html`).then((r) => r.ok, () => false), { timeout: 10_000 }).toBe(true);
});
test.afterAll(() => server?.kill());

async function msg<T>(ext: ExtensionHelper, type: string, payload: object): Promise<T> {
  const page = await ext.extensionPage();
  const r = await page.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload] as const);
  await page.close();
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

/** The demo tab: brought to the front, then the active tab (no "tabs" permission to query by URL). */
async function tabIdOf(ext: ExtensionHelper, app: Page): Promise<number> {
  await app.bringToFront();
  return (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);
}

const done: string[] = [];

/** Light and dark shots of an extension page. */
async function panelShot(page: Page, name: string, fullPage = true) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(80);
    await page.screenshot({ path: join(OUT, `${name}-${scheme}.png`), fullPage });
    done.push(`${name}-${scheme}`);
  }
}

/**
 * An app page with Waymark's UI on it: light browser on a light page, dark browser on a dark
 * page, and a dark browser on a light page ("mixed"; the overlay follows the browser, D90).
 */
async function pageShot(page: Page, name: string) {
  for (const variant of ['light', 'dark', 'mixed'] as const) {
    const scheme = variant === 'light' ? 'light' : 'dark';
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.evaluate(
      ([dark, css]) => {
        let s = document.getElementById('shots-dark');
        if (dark && !s) {
          s = document.createElement('style');
          s.id = 'shots-dark';
          s.textContent = css;
          document.head.append(s);
        }
        if (!dark) s?.remove();
      },
      [variant === 'dark', DARK_HOST] as const,
    );
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, `${name}-${variant}.png`) });
    done.push(`${name}-${variant}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('screenshots', async ({ context, ext, extensionId }) => {
  test.setTimeout(300_000);
  const base = `chrome-extension://${extensionId}`;

  // 1. Panel on a site Waymark is not allowed on, with no guides at all.
  const app = await context.newPage();
  await app.goto(`${DEMO}/index.html`);
  let tabId = await tabIdOf(ext, app);
  // The panel learns the site only through activeTab (a toolbar click), which a test can't do;
  // this page answers "tab.current" with the demo's address, as after that click.
  const first = await context.newPage();
  await first.setViewportSize(PANEL);
  await first.goto(`${base}/sidepanel.html?tab=${tabId}`);
  await expect(first.getByTestId('welcome')).toBeVisible();
  await panelShot(first, 'panel-00-welcome-1');
  await first.getByTestId('welcome-done').click();
  await expect(first.getByTestId('welcome')).toHaveCount(0);
  await panelShot(first, 'panel-00-no-site');
  await first.getByTestId('open-help').click();
  await first.getByTestId('help-warnings').locator('summary').click();
  await panelShot(first, 'panel-00-help');
  await first.getByTestId('help-close').click();
  await first.addInitScript((origin) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime) as (m: unknown) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
    (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = async (m: { type: string }) => {
      const r = await real(m);
      if (m.type === 'tab.current' && r?.ok) r.data = { ...r.data, origin, url: `${origin}/index.html`, granted: false };
      return r;
    };
  }, DEMO);
  await first.reload();
  await expect(first.getByTestId('allow-site')).toBeVisible();
  await first.getByTestId('help-allow').click();
  await panelShot(first, 'panel-01-not-allowed');
  await first.close();
  const panel = await context.newPage();
  await panel.setViewportSize(PANEL);

  await ext.grant('http://127.0.0.1/*');
  await app.reload();
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByTestId('record')).toBeVisible();
  await panelShot(panel, 'panel-02-empty');

  // 2. Record a guide on the demo app, with the warning flags.
  await panel.getByTestId('guide-title').fill('Create an invoice');
  await panel.getByTestId('record').click();
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.bringToFront();
  await app.locator('#chart').click();
  await app.getByText('You have 3 overdue invoices').click();
  await app.waitForTimeout(300);
  await pageShot(app, 'page-01-rec-pill');
  await app.getByRole('link', { name: 'Create invoice' }).click();
  await app.waitForLoadState();
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByLabel('Customer name').click();
  await app.keyboard.type('Ada');
  await app.getByLabel('Email').click();
  await app.keyboard.type('a@example.com');
  await app.getByText('Send me a copy').click();
  await app.waitForTimeout(400);
  await panel.bringToFront();
  await panel.getByTestId('pause').click();
  await panel.getByTestId('add-note').click();
  await panel.getByLabel('Note').fill('Check the amount before you send it');
  await panelShot(panel, 'panel-03-recording');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await panel.getByTestId('resume').click();
  await app.bringToFront();
  await app.getByRole('button', { name: 'Create invoice' }).click();
  await app.waitForLoadState();
  await app.waitForTimeout(400);
  await panel.bringToFront();
  await panel.getByTestId('stop').click();

  // 3. Editor, with a Test step result.
  tabId = await tabIdOf(ext, app);
  await expect(panel.getByTestId('save-guide')).toBeVisible();
  await app.goto(`${DEMO}/new-invoice.html`);
  await expect.poll(() => marker(app, 'loaded'), { timeout: 10_000 }).toBe('yes');
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}`);
  const guides = (await msg<{ guides: { id: string }[] }>(ext, 'guide.list', {})).guides;
  const guideId = guides[0]!.id;
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}&edit=${guideId}`);
  await expect(panel.getByTestId('save-guide')).toBeVisible();
  await panel.getByTestId('step-3-toggle').click(); // step 0 is flagged, so it starts open
  const testBtn = panel.getByTestId('step-3-test');
  if (await testBtn.count()) {
    await testBtn.click();
    await expect(panel.getByTestId('step-3-test-result')).not.toContainText('Looking', { timeout: 12_000 });
  }
  await panel.getByTestId('step-0-title').fill('Look at the **revenue chart**');
  await panelShot(panel, 'panel-04-editor');
  await panel.getByTestId('step-3-more').click();
  await panel.getByTestId('step-3').scrollIntoViewIfNeeded();
  await panelShot(panel, 'panel-04b-editor-more', false);
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toBeVisible();
  await panel.getByTestId('close-editor').click();

  // A second guide and a team-library-like copy, so the library has a few entries.
  await msg(ext, 'guide.duplicate', { id: guideId });

  // 4. Library: "For this page" and all guides, then a search with no result.
  await app.goto(`${DEMO}/index.html`);
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByTestId(`start-${guideId}`)).toBeVisible();
  await panel.getByTestId('site-options').click();
  await panel.getByTestId('launcher-toggle').check();
  await panelShot(panel, 'panel-05b-site-options', false);
  await panel.getByTestId('site-options').click();
  await panelShot(panel, 'panel-05-library');
  await panel.getByTestId('search').fill('payroll');
  await panelShot(panel, 'panel-06-search-empty');
  await panel.getByTestId('search').fill('');

  // 5. Export review and import dialog.
  await panel.getByTestId('export').click();
  await panel.getByRole('checkbox', { name: /Select Create an invoice for export/ }).first().check();
  await panelShot(panel, 'panel-07a-export-select', false);
  await panel.getByTestId('export-selected').click();
  await expect(panel.getByTestId('export-review')).toBeVisible();
  await panelShot(panel, 'panel-07-export-review');
  await panel.getByTestId('format-markdown').check();
  await panelShot(panel, 'panel-15-export-howto');
  await panel.getByTestId('format-pack').check();
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download-pack').click()]);
  const packPath = join(OUT, '..', '.pack.json');
  await download.saveAs(packPath);
  await panel.getByTestId('import-file').setInputFiles(packPath);
  await expect(panel.getByTestId('import-dialog')).toBeVisible();
  await panelShot(panel, 'panel-08-import');
  await panel.getByRole('button', { name: 'Cancel' }).click();

  // 6. Player on the page: tooltip with spotlight, small viewport, done card.
  await app.bringToFront();
  await app.goto(`${DEMO}/index.html`);
  await expect.poll(() => marker(app, 'loaded'), { timeout: 10_000 }).toBe('yes');
  await panel.getByTestId(`start-${guideId}`).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^drawn:0/);
  await app.bringToFront();
  await pageShot(app, 'page-02-tooltip');
  await panelShot(panel, 'panel-09-playing');
  await app.setViewportSize({ width: 640, height: 450 });
  await pageShot(app, 'page-03-tooltip-zoom200');
  await app.setViewportSize({ width: 375, height: 667 });
  await pageShot(app, 'page-04-tooltip-phone');
  await app.setViewportSize({ width: 1280, height: 900 });
  await app.locator('#chart').click(); // step 1 advances when the learner does it
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/:1$/);
  await app.waitForTimeout(400);
  await pageShot(app, 'page-05-tooltip-step2');
  // Off track: an unrelated page.
  await app.goto(`${DEMO}/unrelated.html`);
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^off-track/);
  await pageShot(app, 'page-06-off-track');
  await app.locator('waymark-overlay [data-action="exit"]').click();

  // Not found: the chart is gone.
  await app.goto(`${DEMO}/index.html`);
  await expect.poll(() => marker(app, 'loaded'), { timeout: 10_000 }).toBe('yes');
  await app.evaluate(() => document.getElementById('chart')?.remove());
  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toMatch(/^not-found/);
  await app.locator('waymark-overlay [data-action="report"]').click();
  await app.waitForTimeout(300);
  await pageShot(app, 'page-07-not-found');
  await app.locator('waymark-overlay [data-action="exit"]').click();

  // Done card: a one-note guide.
  const one = await msg<{ id: string }>(ext, 'guide.duplicate', { id: guideId });
  const g = await msg<{ steps: { kind: string; url: unknown }[]; revisionId: string }>(ext, 'guide.get', { id: one.id });
  const note = { ...g.steps.find((s) => s.kind === 'note')!, url: { kind: 'pattern', value: '/index.html' } };
  await msg(ext, 'guide.save', { guide: { ...g, title: 'Quick tour', steps: [note] }, baseRevisionId: g.revisionId });
  await app.reload();
  await expect.poll(() => marker(app, 'loaded'), { timeout: 10_000 }).toBe('yes');
  await msg(ext, 'run.start', { tabId, guideId: one.id });
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^note:0/);
  await pageShot(app, 'page-08-note-step');
  await app.locator('waymark-overlay [data-action="next"]').click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/^done/);
  await pageShot(app, 'page-09-done');
  await app.locator('waymark-overlay [data-action="close"]').click();

  // 7. Launcher, its menu, a deep link offer, the pick banner.
  await app.goto(`${DEMO}/index.html`);
  await expect.poll(() => marker(app, 'launcher'), { timeout: 10_000 }).not.toBe(null);
  await pageShot(app, 'page-10-launcher');
  await app.locator('waymark-overlay .wm-launch').click();
  await pageShot(app, 'page-11-launcher-menu');
  await app.goto(`${DEMO}/index.html?waymark=${guideId}`);
  await expect(app.locator('waymark-overlay .wm-offer')).toBeVisible({ timeout: 10_000 });
  await pageShot(app, 'page-12-deep-link');
  await app.reload();
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}&edit=${guideId}`);
  await panel.getByTestId('step-3-toggle').click();
  await panel.getByTestId('step-3-repick').click();
  await expect.poll(() => marker(app, 'picking'), { timeout: 10_000 }).toBe('on');
  await app.bringToFront();
  await app.getByRole('link', { name: 'View all invoices' }).hover();
  await pageShot(app, 'page-13-picking');
  await panelShot(panel, 'panel-10-picking');
  await app.keyboard.press('Escape');

  // 7b. Library and editor conveniences (D100–D102): tags, a finished guide, More, the Undo toasts.
  const tagged = await msg<{ revisionId: string } & Record<string, unknown>>(ext, 'guide.get', { id: guideId });
  await msg(ext, 'guide.save', { guide: { ...tagged, tags: ['billing', 'onboarding'] }, baseRevisionId: tagged.revisionId });
  await app.bringToFront();
  await app.goto(`${DEMO}/index.html`);
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByTestId(`completed-${one.id}`)).toBeVisible();
  await panelShot(panel, 'panel-11-library-tags');
  await panel.getByTestId('tag-billing').click();
  await panel.getByTestId(`more-${guideId}`).click();
  await panelShot(panel, 'panel-12-library-more');
  await panel.getByTestId('clear-tags').click();
  await panel.getByTestId(`more-${one.id}`).click();
  await panel.getByTestId(`delete-${one.id}`).click();
  await expect(panel.getByTestId('guide-undo-toast')).toBeVisible();
  await panelShot(panel, 'panel-13-undo-toast', false);
  await panel.getByTestId('toast-undo').click();
  await expect(panel.getByTestId(`guide-${one.id}`)).toBeVisible();
  await panel.goto(`${base}/sidepanel.html?tab=${tabId}&edit=${guideId}`);
  await panel.getByTestId('step-1-delete').click();
  await expect(panel.getByTestId('step-undo-toast')).toBeVisible();
  await panelShot(panel, 'panel-14-editor-undo', false);
  await panel.getByTestId('toast-undo').click();

  // 8. Settings.
  const opts = await context.newPage();
  await opts.setViewportSize({ width: 900, height: 900 });
  await opts.goto(`${base}/options.html`);
  await expect(opts.getByTestId('autoplay')).toBeVisible();
  await panelShot(opts, 'settings-01');
  await opts.setViewportSize({ width: 400, height: 860 });
  await panelShot(opts, 'settings-02-narrow');

  // 9. Debug log (D110): on, with entries, then the not-found card's Copy log.
  await opts.setViewportSize({ width: 900, height: 900 });
  await opts.getByTestId('debug-switch').check();
  await app.goto(`${DEMO}/index.html`);
  await expect.poll(() => marker(app, 'debug'), { timeout: 10_000 }).toBe('on');
  await app.evaluate(() => document.getElementById('chart')?.remove());
  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toMatch(/^not-found/);
  await pageShot(app, 'page-14-not-found-debug');
  await app.locator('waymark-overlay [data-action="copy-log"]').click();
  await expect.poll(() => marker(app, 'debug-copy')).toMatch(/^(copied|blocked)$/);
  await pageShot(app, 'page-15-not-found-copied');
  await app.locator('waymark-overlay [data-action="exit"]').click();
  await opts.bringToFront();
  await expect(opts.getByTestId('debug-count')).toContainText('entries', { timeout: 10_000 });
  await opts.locator('#problems').scrollIntoViewIfNeeded();
  await panelShot(opts, 'settings-03-debug-log', false);

  writeFileSync(join(OUT, 'index.txt'), done.join('\n') + '\n');
});
