/**
 * Issue #98 (D212): a broken-step report carries a link to the step. Opened by the author it
 * offers Fix step N (their own guide: the run starts there with the pick open), Start from step N
 * (a team guide), Start from step 1 (the step is gone), or says the guide isn't in their library.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

async function tabIdOf(ext: ExtensionHelper) {
  return (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
}

async function open(context: BrowserContext, url: string): Promise<Page> {
  const app = await context.newPage();
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  return app;
}

const offer = (p: Page) => p.locator('waymark-overlay .wm-offer');

/** Records Import, Export; a learner then finds Export gone and reports step 2. Returns the copied report. */
async function recordAndReport(context: BrowserContext, ext: ExtensionHelper, site: { main: string }, extensionId: string) {
  let app = await open(context, `${site.main}/?static&seed=3`);
  const tabId = await tabIdOf(ext);
  await ext.message('rec.start', { tabId, title: 'Export orders' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  for (const name of ['Import', 'Export']) {
    await app.getByRole('button', { name, exact: true }).click();
    await app.waitForTimeout(150);
  }
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  await app.close();

  app = await open(context, `${site.main}/?static&seed=3`);
  await app.evaluate(() => document.querySelector('[data-fx="tb-export"]')?.remove());
  await ext.message('run.start', { tabId: await tabIdOf(ext), guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toBe('not-found:1');
  await app.locator('waymark-overlay .tip [data-action="report"]').click();
  await expect(app.locator('waymark-overlay .tip')).toContainText('Problems list');
  await app.locator('waymark-overlay .tip [data-action="exit"]').click();
  await app.close();

  // Settings → Problems → Copy as text: the report has a link per problem.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(() => {
    navigator.clipboard.writeText = async (t: string) => void ((window as unknown as { copied: string }).copied = t);
  });
  await options.getByTestId('copy-problems').click();
  const text = await options.evaluate(() => (window as unknown as { copied: string }).copied);
  await options.close();
  return { guideId, text };
}

test('a report link fixes the step: the copied report has it, the author lands with Fix step N and the pick opens; the panel offers the same', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(150_000);
  await ext.grant('http://127.0.0.1/*');
  const { guideId, text } = await recordAndReport(context, ext, site, extensionId);
  const link = /Fix it: (\S+)/.exec(text)?.[1];
  expect(link).toBe(`${site.main}/?waymark=${guideId}&waymark-step=2`);

  // The author opens the link (with the page's own parameters after it): both of Waymark's go from the address.
  const app = await open(context, `${link}&static&seed=3`);
  await expect.poll(() => marker(app, 'deeplink-offer')).toBe('fix');
  expect(app.url()).toBe(`${site.main}/?static&seed=3`);
  await expect(offer(app)).toContainText('Fix step 2 of “Export orders”');

  // The panel shows the same offer for this tab.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${await tabIdOf(ext)}`);
  await expect(panel.getByTestId('link-offer-fix')).toHaveText('Fix step 2');

  await app.bringToFront();
  await offer(app).locator('[data-action="fix"]').click();
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await expect.poll(() => marker(app, 'player')).toBe('fixing:1');
  await expect(offer(app)).toHaveCount(0);
  await expect(panel.getByTestId('link-offer')).toHaveCount(0); // used: the panel's copy goes too
  await app.keyboard.press('Escape');
  await expect.poll(() => marker(app, 'picking')).toBe('off');
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
});

test('report links: a team guide offers Start from step N; a missing guide, a gone step and a malformed step number', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(150_000);
  await ext.grant('http://127.0.0.1/*');
  const { guideId } = await recordAndReport(context, ext, site, extensionId);

  // The page isn't ready for the step (its element is missing): Fix starts the run there, the
  // not-found card shows with Pick the right element, and no pick opens by itself.
  const page = await open(context, `${site.main}/?static&seed=3&waymark=${guideId}&waymark-step=2`);
  await page.evaluate(() => document.querySelector('[data-fx="tb-export"]')?.remove());
  await expect.poll(() => marker(page, 'deeplink-offer')).toBe('fix');
  await offer(page).locator('[data-action="fix"]').click();
  await expect.poll(() => marker(page, 'player'), { timeout: 20_000 }).toBe('not-found:1');
  await expect(page.locator('waymark-overlay .tip [data-action="fix"]')).toBeVisible();
  expect(await marker(page, 'picking')).not.toBe('on');
  await page.locator('waymark-overlay .tip [data-action="exit"]').click();
  await page.close();

  // Not in the author's library.
  let app = await open(context, `${site.main}/?static&seed=3&waymark=01NOTMYGUIDE00000000000000&waymark-step=2`);
  await expect.poll(() => marker(app, 'deeplink-offer')).toBe('not-in-library');
  await expect(offer(app)).toContainText('This guide isn’t in your library.');
  await expect(offer(app).locator('[data-action="start"], [data-action="fix"]')).toHaveCount(0);
  await app.close();

  // The step is gone from this copy: Start from step 1.
  app = await open(context, `${site.main}/?static&seed=3&waymark=${guideId}&waymark-step=9`);
  await expect.poll(() => marker(app, 'deeplink-offer')).toBe('no-step');
  await expect(offer(app)).toContainText('That step no longer exists in your copy');
  await expect(offer(app).locator('[data-action="start"]')).toHaveText('Start from step 1');
  await app.close();

  // A malformed step number: a plain deep link, and both parameters leave the address.
  app = await open(context, `${site.main}/?static&waymark=${guideId}&waymark-step=abc&seed=3`);
  await expect.poll(() => marker(app, 'deeplink-offer')).toBe('plain');
  expect(app.url()).toBe(`${site.main}/?static&seed=3`);
  await app.close();

  // A team guide: Start from step N runs from that step.
  await (await ext.sw()).evaluate(async (id) => {
    const key = `guide:${id}`;
    const g = (await chrome.storage.local.get(key))[key] as object;
    await chrome.storage.local.set({ [key]: { ...g, source: 'library' } });
  }, guideId);
  app = await open(context, `${site.main}/?static&seed=3&waymark=${guideId}&waymark-step=2`);
  await expect.poll(() => marker(app, 'deeplink-offer')).toBe('start');
  await expect(offer(app).locator('[data-action="start"]')).toHaveText('Start from step 2');
  await expect(offer(app).locator('[data-action="fix"]')).toHaveCount(0);
  await offer(app).locator('[data-action="start"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
});
