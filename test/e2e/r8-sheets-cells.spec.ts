/**
 * D206 (#114): Google Sheets draws its grid on a canvas. A click on a cell (or a drag, or a
 * reference typed into the Name Box) records "Select cell B8", read from the Name Box; playing it
 * highlights the Name Box and moves on when the Name Box shows that cell on that sheet. The
 * fixture page has the Sheets element ids and classes the steps rely on.
 */
import type { Page } from '@playwright/test';
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

/** The middle of a cell on the fixture's canvas (column A = 0, row 1 = 0). */
async function cellPoint(app: Page, c: number, r: number) {
  const box = (await app.locator('#grid').boundingBox())!;
  return { x: box.x + 40 + c * 90 + 45, y: box.y + 24 + r * 24 + 12 };
}
async function clickCell(app: Page, c: number, r: number) {
  const p = await cellPoint(app, c, r);
  await app.mouse.click(p.x, p.y);
}
async function dragCells(app: Page, from: [number, number], to: [number, number]) {
  const a = await cellPoint(app, ...from);
  const b = await cellPoint(app, ...to);
  await app.mouse.move(a.x, a.y);
  await app.mouse.down();
  await app.mouse.move(b.x, b.y, { steps: 5 });
  await app.mouse.up();
}

test('Sheets cells: record a click, a drag and a typed reference; play them: each cell selected by the player, ringed, then clicked; a range with Next', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/sheet.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);

  await ext.message('rec.start', { tabId, title: 'Sort the totals' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await clickCell(app, 2, 3); // C4
  await app.waitForTimeout(150);
  await clickCell(app, 2, 4); // C5: clicking around keeps the last cell
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Totals' }).click();
  await app.waitForTimeout(150);
  await dragCells(app, [1, 1], [3, 4]); // B2:D5
  await expect(app.locator('#t-name-box')).toHaveValue('B2:D5');
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Sort A to Z' }).click();
  await app.waitForTimeout(150);
  await app.locator('#t-name-box').click();
  await app.locator('#t-name-box').fill('');
  await app.keyboard.type('f9');
  await app.keyboard.press('Enter');
  await app.waitForTimeout(250);
  const rec = await ext.message<{ guideId: string; steps: { kind: string; title: string; cell?: { ref: string; sheet?: string } }[] }>('rec.stop', {});
  expect(rec.steps.map((s) => `${s.kind}: ${s.title}`)).toEqual([
    'cell: Select cell **C5** on **Budget**',
    'click: Click **Totals**',
    'cell: Select cells **B2:D5** on **Totals**',
    'click: Click **Sort A to Z**',
    'cell: Select cell **F9** on **Totals**',
  ]);
  expect(rec.steps[2]!.cell).toEqual({ ref: 'B2:D5', sheet: 'Totals' });

  // Played (D208): the player selects each cell once and rings the real cell; the learner then clicks it.
  await app.goto(`${site.main}/sheet.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  await expect(app.locator('#t-name-box')).toHaveValue('C5');
  const overlay = app.locator('waymark-overlay');
  const c5 = await cellPoint(app, 2, 4);
  await expect.poll(async () => {
    const r = (await overlay.locator('.ring').boundingBox())!;
    return r.x < c5.x && c5.x < r.x + r.width && r.y < c5.y && c5.y < r.y + r.height;
  }).toBe(true);
  // The tooltip docks away from the grid: the cells near the Name Box stay clickable.
  for (const [c, r] of [[0, 0], [2, 4], [4, 6]] as const) {
    const p = await cellPoint(app, c, r);
    expect(await app.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, p)).toMatch(/^(grid|waffle-rich-text-editor)$/); // the page's own grid or cell editor
  }
  if (process.env.WAYMARK_SHOT) await app.screenshot({ path: process.env.WAYMARK_SHOT });
  await app.waitForTimeout(600);
  expect(await marker(app, 'player')).toBe('drawn:0'); // the player's own selection doesn't count
  await clickCell(app, 2, 3); // C4: not the step's cell
  await app.waitForTimeout(600);
  expect(await marker(app, 'player')).toBe('drawn:0');
  // Moved away: not selected again by itself; Show again does.
  await expect(app.locator('#t-name-box')).toHaveValue('C4');
  await overlay.locator('[data-action="show-cell"]').click();
  await expect(app.locator('#t-name-box')).toHaveValue('C5');
  await clickCell(app, 2, 4); // C5
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:1');
  await app.getByRole('button', { name: 'Totals' }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:2');
  // A range: selected by the player, then Next.
  await expect(app.locator('#t-name-box')).toHaveValue('B2:D5');
  await overlay.locator('[data-action="next"]').click();
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:3');
  await app.getByRole('button', { name: 'Sort A to Z' }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:4');
  await expect(app.locator('#t-name-box')).toHaveValue('F9');
  await clickCell(app, 5, 8); // F9
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('done');
});

test('D208: on another sheet tab, "Open the … tab" and nothing selected; then the cell is selected once (closed root)', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/sheet.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  await ext.message('rec.start', { tabId, title: 'One cell' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await clickCell(app, 1, 2); // B3 on Budget
  await app.waitForTimeout(250);
  const rec = await ext.message<{ guideId: string }>('rec.stop', {});

  await app.goto(`${site.main}/sheet.html?waymark-test-closed`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await app.getByRole('button', { name: 'Totals' }).click();
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  await expect.poll(() => marker(app, 'cell-wait')).toBe('sheet');
  await app.waitForTimeout(500);
  await expect(app.locator('#t-name-box')).toHaveValue('A1'); // nothing selected on Totals
  await expect(app.locator('.docs-sheet-active-tab')).toHaveText('Totals');
  await app.getByRole('button', { name: 'Budget' }).click();
  await expect(app.locator('#t-name-box')).toHaveValue('B3');
  await clickCell(app, 1, 2); // B3
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('done');
});

test('D208: never selects while a cell is being typed into; a typing step is one step and moves on at Tab', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/sheet.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  await ext.message('rec.start', { tabId, title: 'Fill in' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await clickCell(app, 2, 4); // C5
  await app.waitForTimeout(150);
  await app.keyboard.type('12');
  await app.keyboard.press('Tab');
  await app.waitForTimeout(300);
  const rec = await ext.message<{ guideId: string; steps: { kind: string; title: string }[] }>('rec.stop', {});
  expect(rec.steps.map((s) => `${s.kind}: ${s.title}`)).toEqual(['input: Enter a value in **C5** on **Budget**']);

  await app.goto(`${site.main}/sheet.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  // The learner is typing into A1 when the guide starts: the player waits.
  await clickCell(app, 0, 0);
  await app.keyboard.type('half');
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  await expect.poll(() => marker(app, 'cell-wait')).toBe('editing');
  await expect(app.locator('#t-name-box')).toHaveValue('A1');
  await expect(app.locator('#last-action')).toHaveText(''); // nothing committed
  await app.keyboard.press('Escape');
  await app.evaluate(() => (document.getElementById('waffle-rich-text-editor')!.textContent = '')); // Esc cancels, as in Sheets
  await expect(app.locator('#t-name-box')).toHaveValue('C5');
  await app.keyboard.type('12');
  await app.keyboard.press('Tab');
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('done');
  await expect(app.locator('#last-action')).toHaveText('C5=12');
});
