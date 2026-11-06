/**
 * D204 (#94): a side nav whose item opens a flyout while the pointer rests on it (Thomas: the
 * Samsara side nav). Recording records "Point at" the item before the click on the flyout's
 * link; playing it, pointing at the item moves on, and a keyboard user completes it with Tab.
 */
import type { Page } from '@playwright/test';
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

async function open(app: Page, url: string) {
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
}

test('a hover menu records a Point at step and plays by pointer and by keyboard', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await open(app, `${site.main}/menu.html`);
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);

  await ext.message('rec.start', { tabId, title: 'Fuel report' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.locator('#start').hover();
  await app.waitForTimeout(100);
  await app.locator('#reports').hover();
  await expect(app.locator('#fuel')).toBeVisible();
  await app.waitForTimeout(200);
  await app.locator('#fuel').click();
  await expect(app.locator('#picked')).toHaveText('Picked Fuel');
  await app.waitForTimeout(200);
  const rec = await ext.message<{ guideId: string; steps: { kind: string; title: string }[] }>('rec.stop', {});
  expect(rec.steps.map((s) => `${s.kind}: ${s.title}`)).toEqual(['hover: Point at **Reports**', 'click: Click **Fuel**']);

  // Played with the pointer, in a closed overlay root (as in production).
  await open(app, `${site.main}/menu.html?waymark-test-closed`);
  await app.mouse.move(0, 0);
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  expect(await app.evaluate(() => document.querySelector('waymark-overlay')?.shadowRoot ?? null)).toBeNull();
  await expect(app.locator('#fuel')).toBeHidden();
  await app.locator('#reports').hover();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:1');
  await app.locator('#fuel').click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('done');
  await ext.message('run.stop', { tabId }).catch(() => undefined);

  // Played with the keyboard only: Tab to the item opens its menu and moves on.
  await open(app, `${site.main}/menu.html`);
  await app.mouse.move(0, 0);
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  await app.locator('#start').focus();
  await app.keyboard.press('Tab');
  await expect(app.locator('#reports')).toBeFocused();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:1');
  await app.keyboard.press('Tab');
  await expect(app.locator('#fuel')).toBeFocused();
  await app.keyboard.press('Enter');
  await expect(app.locator('#picked')).toHaveText('Picked Fuel');
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('done');
});
