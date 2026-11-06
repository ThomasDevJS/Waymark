/**
 * M5 acceptance: a pack imported into a second browser profile plays the same way; the badge
 * count is correct on matching and non-matching pages, including after in-app route changes.
 * Also: launcher, deep link, export review, library URL, first-run Allow.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, ExtensionHelper, launch, marker, serviceWorker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

/** Messages from an extension page in a popup window (see ExtensionHelper.message). */
function msg<T>(ext: ExtensionHelper, type: string, payload: object): Promise<T> {
  return ext.message<T>(type, payload);
}

async function tabIdFor(ext: ExtensionHelper, page: Page): Promise<number> {
  const url = page.url();
  return (await ext.sw()).evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
}

async function badge(ext: ExtensionHelper, tabId: number): Promise<string> {
  return (await ext.sw()).evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
}

/** Records "Open orders → Import" starting on /app/orders. */
async function recordOrdersGuide(ext: ExtensionHelper, app: Page, title = 'Import orders') {
  const tabId = await tabIdFor(ext, app);
  await msg(ext, 'rec.start', { tabId, title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(150);
  return msg<{ guideId: string }>(ext, 'rec.stop', {});
}

async function openApp(context: BrowserContext, url: string) {
  const app = await context.newPage();
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  return app;
}

test('the badge counts guides for the page, including after in-app route changes; REC takes precedence', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const tabId = await tabIdFor(ext, app);
  expect(await badge(ext, tabId)).toBe('');
  const { guideId } = await recordOrdersGuide(ext, app);
  await expect.poll(() => badge(ext, tabId)).toBe('1'); // matching page
  await recordOrdersGuide(ext, app, 'Second guide');
  await expect.poll(() => badge(ext, tabId)).toBe('2');

  // In-app route change to a page without guides, and back.
  await app.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(app).toHaveURL(/\/app\/settings/);
  await expect.poll(() => badge(ext, tabId)).toBe('');
  await app.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect.poll(() => badge(ext, tabId)).toBe('2');

  // Full page load to a non-matching page.
  await app.goto(`${site.main}/page3.html`);
  await expect.poll(() => badge(ext, tabId)).toBe('');
  await app.goto(`${site.main}/app/orders?static`);
  await expect.poll(() => badge(ext, tabId)).toBe('2');

  // REC takes precedence while recording, then the count comes back.
  await msg(ext, 'rec.start', { tabId, title: 'Third' });
  await expect.poll(() => badge(ext, tabId)).toBe('REC');
  await msg(ext, 'rec.stop', {});
  await expect.poll(() => badge(ext, tabId)).toBe('3');

  // Deleting a guide updates the count.
  await msg(ext, 'guide.delete', { id: guideId });
  await expect.poll(() => badge(ext, tabId)).toBe('2');
});

test('a pack exported after review and imported into a second browser profile plays the same way', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const { guideId } = await recordOrdersGuide(ext, app, 'Shared guide');
  const tabId = await tabIdFor(ext, app);

  // Export through the side panel, with the review screen.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByTestId('for-this-page')).toContainText('Shared guide');
  await panel.getByTestId('export').click(); // checkboxes appear only while choosing (D124)
  await panel.getByLabel('Select Shared guide for export').check();
  await panel.getByTestId('export-selected').click();
  const review = panel.getByTestId('export-review');
  await expect(review).toContainText('Click **Import**');
  await expect(review).toContainText(`${site.main}/app/orders`);
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download-pack').click()]);
  expect(download.suggestedFilename()).toMatch(/\.waymark\.json$/);
  const packPath = join(mkdtempSync(join(tmpdir(), 'waymark-pack-')), 'pack.waymark.json');
  await download.saveAs(packPath);
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  expect(pack).toMatchObject({ format: 'waymark-pack', formatVersion: 1, guides: [{ id: guideId, title: 'Shared guide' }] });

  // A second profile: import first, then one Allow request for the pack's sites.
  const dir2 = mkdtempSync(join(tmpdir(), 'waymark-e2e-b-'));
  const ctx2 = await launch(dir2);
  try {
    const sw2 = await serviceWorker(ctx2);
    const ext2 = new ExtensionHelper(ctx2, new URL(sw2.url()).host, () => serviceWorker(ctx2));
    const app2 = await ctx2.newPage();
    await app2.goto(`${site.main}/app/orders?static`);
    const panel2 = await ctx2.newPage();
    await panel2.goto(`chrome-extension://${ext2.extensionId}/sidepanel.html`);
    await panel2.getByTestId('import-file').setInputFiles(packPath);
    await expect(panel2.getByTestId('import-dialog')).toContainText('Shared guide');
    await panel2.getByTestId('import-confirm').click();
    await expect(panel2.getByTestId('library-message')).toContainText('Imported 1 guide');
    await expect(panel2.getByTestId('allow-banner')).toContainText('http://127.0.0.1');
    // First-run access: one Allow request covering the pack's sites (the native dialog).
    await panel2.bringToFront();
    await panel2.getByTestId('allow-all').click();
    await panel2.waitForTimeout(1200);
    const { execFileSync } = await import('node:child_process');
    execFileSync('python3', [join(process.cwd(), 'test', 'e2e', 'helpers', 'x11-keys.py'), 'Tab,Return']);
    await expect(panel2.getByTestId('allow-banner')).toHaveCount(0);
    await expect.poll(async () => (await ext2.registeredMatches()).includes('http://127.0.0.1/*')).toBe(true);

    // Plays the same way: same steps, same elements.
    await app2.reload();
    await expect.poll(() => marker(app2, 'loaded')).toBe('yes');
    const tab2 = await tabIdFor(ext2, app2);
    await expect.poll(() => badge(ext2, tab2)).toBe('1');
    await msg(ext2, 'run.start', { tabId: tab2, guideId });
    await app2.bringToFront();
    await expect.poll(() => marker(app2, 'player')).toBe('drawn:0');
    await expect(app2.locator('waymark-overlay .tip .title')).toHaveText('Click Import');
    await app2.getByRole('button', { name: 'Import', exact: true }).click();
    await expect.poll(() => marker(app2, 'player')).toBe('drawn:1');
    await app2.getByRole('button', { name: 'Export', exact: true }).click();
    await expect.poll(() => marker(app2, 'player')).toBe('done');
  } finally {
    await ctx2.close();
    rmSync(dir2, { recursive: true, force: true });
  }
});

test('on-page launcher (on by default where a page has guides, off per site) and deep links start a guide', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  // No guides for this page yet: no button, even though the launcher is on by default.
  await expect.poll(() => marker(app, 'launcher')).toBe('off');
  const { guideId } = await recordOrdersGuide(ext, app, 'Launcher guide');
  await app.reload();
  await expect.poll(() => marker(app, 'launcher')).toBe('1'); // on by default (D150)
  const tabId = await tabIdFor(ext, app);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('site-options').click(); // folded away (D120)
  await expect(panel.getByTestId('launcher-toggle')).toBeChecked();
  // Turned off for the site, it stays off.
  await panel.getByTestId('launcher-toggle').uncheck();
  await app.bringToFront();
  await app.reload();
  await expect.poll(() => marker(app, 'launcher')).toBe('off');
  await panel.reload();
  await panel.getByTestId('site-options').click();
  await expect(panel.getByTestId('launcher-toggle')).not.toBeChecked();
  await panel.getByTestId('launcher-toggle').check();
  await app.bringToFront();
  await app.reload();
  await expect.poll(() => marker(app, 'launcher')).toBe('1');
  await app.locator('waymark-overlay .wm-launch').click();
  await app.locator(`waymark-overlay [data-guide="${guideId}"]`).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await app.locator('waymark-overlay .tip [data-action="exit"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('off');

  // Deep link: offered, removed from the URL at once (hash routes untouched), then started.
  await app.goto(`${site.main}/app/orders?static&waymark=${guideId}#/keep`);
  await expect.poll(() => marker(app, 'deeplink')).toBe(guideId);
  expect(app.url()).toBe(`${site.main}/app/orders?static#/keep`);
  await app.locator('waymark-overlay .wm-offer [data-action="start"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  // An unknown or foreign guide id offers nothing.
  await app.goto(`${site.main}/app/orders?static&waymark=01NOTAREALGUIDE0000000000`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await app.waitForTimeout(500);
  expect(await app.locator('waymark-overlay .wm-offer').count()).toBe(0);
});

for (const reduced of [false, true]) {
test(`on-page launcher with the production closed shadow root: a guide in the menu starts (#42), ${reduced ? 'reduced motion' : 'with motion (D134)'}`, async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const { guideId } = await recordOrdersGuide(ext, app, 'Closed root guide');
  // From now on the overlay's shadow root is closed, as in the store build.

  const tabId = await tabIdFor(ext, app);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('site-options').click();
  await expect(panel.getByTestId('launcher-toggle')).toBeChecked(); // on by default (D150)
  await app.bringToFront();
  await app.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await app.goto(`${site.main}/app/orders?static&waymark-test-closed`);
  await expect.poll(() => marker(app, 'launcher')).toBe('1');
  expect(await app.evaluate(() => [!!document.querySelector('waymark-overlay'), !!document.querySelector('waymark-overlay')?.shadowRoot])).toEqual([true, false]); // closed
  const vp = app.viewportSize()!;
  // No waiting for the pop-in (D134): it scales about its centre, so the press lands mid-animation.
  // But not before the button can be hit: a press within ~20 ms of its insertion, with motion on,
  // went to the page about 1 run in 12 (D134, release 0.4.0). A real press can't come that soon.
  const [cx, cy] = [vp.width - 16 - 22, vp.height - 16 - 22]; // the ? button, bottom right
  await expect.poll(() => app.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, [cx, cy]), { intervals: [10] }).toBe('WAYMARK-OVERLAY');
  await app.mouse.click(cx, cy);
  await expect.poll(() => marker(app, 'launcher-item')).not.toBeNull();
  const [x, y] = (await marker(app, 'launcher-item'))!.split(',').map(Number);
  await app.mouse.click(x!, y!);
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  void guideId;
});
}

test('library URL: subscribe, read-only team guides, refresh on chrome.alarms, updates and removals', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const { guideId } = await recordOrdersGuide(ext, app, 'Team guide');
  const guide = await msg<Record<string, unknown>>(ext, 'guide.get', { id: guideId });
  await msg(ext, 'guide.delete', { id: guideId });
  const publish = async (guides: unknown[]) => {
    const res = await fetch(`${site.main}/__library`, { method: 'PUT', body: JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: new Date().toISOString(), guides }) });
    expect(res.status).toBe(204);
  };
  await publish([guide]);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByTestId('library-url').fill(`${site.main}/library.waymark.json`);
  await options.getByTestId('library-subscribe').click();
  await expect(options.getByTestId('library-status')).toContainText('1 team guide');
  const sw = await ext.sw();
  const alarm = await sw.evaluate(() => chrome.alarms.get('library-refresh'));
  expect(alarm?.periodInMinutes).toBe(360);

  const all = await msg<{ guides: { id: string; source: string; title: string }[] }>(ext, 'guide.list', {});
  expect(all.guides).toEqual([expect.objectContaining({ id: guideId, source: 'library' })]);
  // Read-only: saving is refused; Duplicate gives an editable copy.
  await expect(msg(ext, 'guide.save', { guide: { ...guide, source: 'library' }, baseRevisionId: guide.revisionId })).rejects.toThrow(/read-only/);
  const copy = await msg<{ id: string; source: string; forkedFrom: { guideId: string } }>(ext, 'guide.duplicate', { id: guideId });
  expect(copy).toMatchObject({ source: 'local', forkedFrom: { guideId } });

  // A new revision replaces the library copy; a guide dropped from the pack disappears.
  await publish([{ ...guide, revisionId: '01NEWREVISION0000000000000', title: 'Team guide v2' }]);
  await options.getByTestId('library-refresh').click();
  await expect.poll(async () => (await msg<{ guides: { id: string; title: string }[] }>(ext, 'guide.list', {})).guides.find((g) => g.id === guideId)?.title).toBe('Team guide v2');
  await publish([]);
  await options.getByTestId('library-refresh').click();
  await expect.poll(async () => (await msg<{ guides: { id: string }[] }>(ext, 'guide.list', {})).guides.map((g) => g.id)).toEqual([copy.id]);

  // A broken library file is reported, and nothing is changed.
  await fetch(`${site.main}/__library`, { method: 'PUT', body: '{"format":"waymark-pack","formatVersion":9,"guides":[]}' });
  await options.getByTestId('library-refresh').click();
  await expect(options.getByTestId('library-status')).toContainText('newer version');
});

test('review fixes: unsubscribing during a slow library fetch wins; a malformed deep link breaks nothing; badges clear when access is removed; Copy link', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const { guideId } = await recordOrdersGuide(ext, app, 'Linked guide');
  const tabId = await tabIdFor(ext, app);
  const guide = await msg<Record<string, unknown>>(ext, 'guide.get', { id: guideId });

  // Copy link gives a working deep link (clipboard, or the link itself shown when it is blocked).
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`more-${guideId}`).click(); // Copy link moved into More (D124)
  await panel.getByTestId(`link-${guideId}`).click();
  await expect(panel.getByTestId('library-message')).toContainText(/Link copied|waymark=/);

  // Library: a refresh still waiting on a slow host must not bring guides back after unsubscribing.
  await fetch(`${site.main}/__library`, { method: 'PUT', body: JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: '', guides: [{ ...guide, id: '01TEAMGUIDE000000000000000', title: 'Slow team guide' }] }) });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByTestId('library-url').fill(`${site.main}/library.waymark.json?delay=2500`);
  await options.getByTestId('library-subscribe').click(); // the library answers after 2.5 s
  // Once the subscription is saved its first refresh is in flight: unsubscribe now.
  await expect.poll(async () => (await msg<{ url: string | null }>(ext, 'library.get', {})).url, { timeout: 4000, intervals: [100] }).not.toBeNull();
  await msg(ext, 'library.set', { url: null });
  await options.waitForTimeout(3500);
  expect((await msg<{ url: string | null }>(ext, 'library.get', {})).url).toBeNull();
  const titles = (await msg<{ guides: { title: string }[] }>(ext, 'guide.list', {})).guides.map((g) => g.title);
  expect(titles).not.toContain('Slow team guide');

  // A malformed deep link is ignored; the content script still runs.
  await app.goto(`${site.main}/app/orders?static&waymark=%E0%A4%A`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await expect.poll(() => badge(ext, tabId)).toBe('1');

  // Removing site access clears the badge.
  await ext.revoke('http://127.0.0.1/*');
  await expect.poll(() => badge(ext, tabId)).toBe('');
});
