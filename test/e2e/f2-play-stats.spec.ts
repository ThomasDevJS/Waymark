/**
 * Issue #96 (D211): steps that may break, from real plays on this device. A step found by one
 * strong signal and a step not found twice are flagged in the library row and the editor; a
 * Re-pick clears the flag.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

async function tabIdOf(ext: ExtensionHelper) {
  return (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
}

async function openApp(context: BrowserContext, site: { main: string }) {
  const app = await context.newPage();
  await app.goto(`${site.main}/?static&seed=3`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  return app;
}

/** The app changed: Import got another accessible name (only its text still matches), and Export is gone. */
async function changeApp(app: Page) {
  await app.evaluate(() => {
    document.querySelector('[data-fx="tb-import"]')?.setAttribute('aria-label', 'Bring in orders');
    document.querySelector('[data-fx="tb-export"]')?.remove();
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Download';
    document.getElementById('app-root')?.append(b);
  });
}

async function playOnce(context: BrowserContext, ext: ExtensionHelper, site: { main: string }, guideId: string) {
  const app = await openApp(context, site);
  await changeApp(app);
  await ext.message('run.start', { tabId: await tabIdOf(ext), guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await app.getByRole('button', { name: 'Bring in orders' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  await app.getByRole('button', { name: 'CSV', exact: true }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toBe('not-found:2');
  await app.locator('waymark-overlay .tip [data-action="exit"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('off');
  await app.close();
}

test('plays flag a one-signal step and a step not found twice; Re-pick clears the flag', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(150_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, site);
  const tabId = await tabIdOf(ext);
  await ext.message('rec.start', { tabId, title: 'Export as CSV' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  for (const name of ['Import', 'CSV', 'Export']) {
    await app.getByRole('button', { name, exact: true }).click();
    await app.waitForTimeout(150);
  }
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  await app.close();

  // Nothing played yet: nothing flagged.
  expect(await ext.message('stats.summary', { ids: [guideId] })).toEqual({ counts: {} });

  await playOnce(context, ext, site, guideId);
  await playOnce(context, ext, site, guideId);

  const page = await openApp(context, site);
  await changeApp(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${await tabIdOf(ext)}`);
  await expect(panel.getByTestId(`may-break-${guideId}`)).toHaveText('2 steps may break');

  await panel.getByTestId(`edit-${guideId}`).click();
  await expect(panel.getByTestId('step-0-may-break')).toBeVisible(); // folded: a badge
  // CSV was found by its unique test id (the fast path): sturdy, not flagged.
  await expect(panel.getByTestId('step-1-may-break')).toHaveCount(0);
  await panel.getByTestId('step-0-toggle').click();
  await expect(panel.getByTestId('step-0-plays')).toContainText('Found by one signal only');
  await panel.getByTestId('step-2-toggle').click();
  await expect(panel.getByTestId('step-2-plays')).toContainText('Not found in 2 of the last 2 plays');

  // Re-pick from the flag: the flag goes at once, and stays gone once saved.
  await panel.getByTestId('step-2-plays-repick').click();
  await expect.poll(() => marker(page, 'picking')).toBe('on');
  await page.bringToFront();
  await page.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => marker(page, 'picking')).toBe('off');
  await panel.bringToFront();
  await expect(panel.getByTestId('step-2-plays')).toHaveCount(0);
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toContainText('Saved');
  await expect(panel.getByTestId('step-2-plays')).toHaveCount(0);
  await expect(panel.getByTestId('step-0-plays')).toContainText('Found by one signal only');
  const counts = await ext.message<{ counts: Record<string, number> }>('stats.summary', { ids: [guideId] });
  expect(counts.counts[guideId]).toBe(1);
});
