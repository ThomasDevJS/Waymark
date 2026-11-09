/**
 * #115 (bug, the owner's editable sheet): a filter menu opened from a button drawn on the grid,
 * then cells typed into with Tab between them. Before, the click that opened the menu was not
 * recorded, the guide started on a hidden menu item, the "Enter C3" steps had no cell selected
 * first, and playback showed nothing for 8 s. Now: the menu item is flagged "in a menu", a
 * "Looking for this step…" card says to open the menu first, and each typed cell gets a
 * "Select cell" step before it.
 */
import type { Page } from '@playwright/test';
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

async function cellPoint(app: Page, c: number, r: number) {
  const box = (await app.locator('#grid').boundingBox())!;
  return { x: box.x + 40 + c * 90 + 45, y: box.y + 24 + r * 24 + 12 };
}
async function clickCell(app: Page, c: number, r: number) {
  const p = await cellPoint(app, c, r);
  await app.mouse.click(p.x, p.y);
}
/** The filter button, drawn in column C's header. */
async function clickFilter(app: Page) {
  const box = (await app.locator('#grid').boundingBox())!;
  await app.mouse.click(box.x + 40 + 2 * 90 + 75, box.y + 12);
}

test('a filter menu opened from the grid and cells typed with Tab: flagged, explained, and each typed cell selected first', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/sheet.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);

  await ext.message('rec.start', { tabId, title: 'Filter and fill in' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await clickFilter(app);
  await expect(app.getByRole('menu', { name: 'Filter' })).toBeVisible();
  await app.waitForTimeout(150);
  await app.getByRole('menuitemcheckbox', { name: 'Done' }).click();
  await app.waitForTimeout(150);
  await app.keyboard.press('Escape');
  await clickCell(app, 2, 2); // C3
  await app.waitForTimeout(150);
  await app.keyboard.type('42');
  await app.keyboard.press('Tab'); // to D3
  await app.waitForTimeout(150);
  await app.keyboard.type('7');
  await app.keyboard.press('Tab');
  await app.waitForTimeout(400);
  await expect(app.locator('#last-action')).toHaveText('C3=42 D3=7');
  const rec = await ext.message<{ guideId: string; steps: { kind: string; title: string; flags?: string[] }[] }>('rec.stop', {});
  expect(rec.steps.map((s) => `${s.kind}: ${s.title}${s.flags?.length ? ` [${s.flags.join(',')}]` : ''}`)).toEqual([
    'check: Uncheck **Done** [in-menu]',
    'cell: Select cell **C3** on **Budget**',
    'input: Enter C3',
    'cell: Select cell **D3** on **Budget**',
    'input: Enter D3',
  ]);

  // The editor explains the flag.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${rec.guideId}`).click();
  await expect(panel.getByTestId('step-0')).toContainText('In a menu');

  // Played: the hidden item gets a "Looking for this step…" card that says to open the menu.
  await app.goto(`${site.main}/sheet.html?waymark-test-closed`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 5000 }).toBe('searching-card:0');
  await clickFilter(app);
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:0');
  await app.getByRole('menuitemcheckbox', { name: 'Done' }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:1');
  await app.keyboard.press('Escape');
  await clickCell(app, 2, 2);
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:2');
  await app.keyboard.type('42');
  await app.keyboard.press('Tab');
  // D3 is selected by the Tab: its cell step moves on by itself, then the typing step is drawn.
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:4');
  await app.keyboard.type('7');
  await app.keyboard.press('Tab');
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('done');
});
