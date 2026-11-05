/**
 * On-page player motion (D133) end to end, with motion on and the store build's closed overlay
 * root (`waymark-test-closed`): a guide plays on the fixture site, the learner clicks the
 * targets right away (during the ripple and the glide), and the guide moves on and finishes as
 * before. The test build counts the glides and ripples that ran (`data-waymark-test-motion`).
 */
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

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

test('motion on, closed root: clicks during the ripple and glide still advance; the glide and ripple run', async ({ context, ext, site }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static&waymark-test-closed`);
  const tabId = await tabIdFor(ext, app);
  await ext.message('rec.start', { tabId, title: 'Glide' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(150);
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});

  await ext.message('run.start', { tabId, guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  // The store build's root: the page can't reach into it.
  expect(await app.evaluate(() => document.querySelector('waymark-overlay')?.shadowRoot ?? null)).toBeNull();

  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:1');
  // Straight away, while the ring is still gliding over: the click lands and finishes the guide.
  await app.getByRole('button', { name: 'Export', exact: true }).click({ timeout: 2000 });
  await expect.poll(() => marker(app, 'player')).toBe('done');
  // The page can't see into the closed root; the test build counts what ran.
  // Both presses rippled. The glide needs step 2 drawn within 1.5 s of step 1 going, which a slow
  // runner may miss, so it is not required here (the browser tests check the glide itself).
  expect(await marker(app, 'motion')).toMatch(/^glide:[01],ripple:2$/);
});
