/**
 * D205 (#108): in a guide of 11 steps, moving step 7 to the top took 6 clicks on ↑. A step card
 * now has a drag handle: drag it (the panel scrolls near its edges, Esc cancels), or by keyboard
 * press Space, the arrow keys and Space. Move to top / bottom are in More options.
 */
import type { Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

type G = { id: string; revisionId: string; source: string; steps: { id: string; title: string }[] };

/** A recorded guide made into 11 steps, "Step 1" to "Step 11". */
async function elevenSteps(context: import('@playwright/test').BrowserContext, ext: ExtensionHelper, site: { main: string }) {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  await ext.message('rec.start', { tabId, title: 'Report' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(200);
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  const g = await ext.message<G>('guide.get', { id: guideId });
  const steps = Array.from({ length: 11 }, (_, i) => ({ ...g.steps[0]!, id: `s${i + 1}`, title: `Step ${i + 1}` }));
  await ext.message('guide.save', { guide: { ...g, steps }, baseRevisionId: g.revisionId });
  return { tabId, guideId };
}
const order = async (panel: Page) => (await panel.locator('.edit-steps > li .step-toggle .grow').allTextContents()).map((t) => t.trim());
const stored = async (ext: ExtensionHelper, id: string) => (await ext.message<G>('guide.get', { id })).steps.map((s) => s.title);
const ELEVEN = Array.from({ length: 11 }, (_, i) => `Step ${i + 1}`);

async function openEditor(panel: Page, extensionId: string, tabId: number, guideId: string) {
  await panel.setViewportSize({ width: 400, height: 640 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${guideId}`).click();
  await expect(panel.getByTestId('step-10-drag')).toBeVisible();
}

test('drag step 7 to the top: the panel scrolls up on its own, Save keeps the order; Esc cancels a drag', async ({ context, ext, site, extensionId }) => {
  const { tabId, guideId } = await elevenSteps(context, ext, site);
  const panel = await context.newPage();
  await openEditor(panel, extensionId, tabId, guideId);

  // Esc during a drag: nothing moves.
  const h1 = (await panel.getByTestId('step-1-drag').boundingBox())!;
  await panel.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(h1.x + h1.width / 2, h1.y + 300, { steps: 6 });
  await expect(panel.locator('.edit-step.drop-after')).toHaveCount(1);
  await panel.keyboard.press('Escape');
  await panel.mouse.up();
  await expect(panel.locator('.edit-step.dragging')).toHaveCount(0);
  expect(await order(panel)).toEqual(ELEVEN);
  await expect(panel.getByTestId('save-guide')).toBeDisabled();

  // Review fix: the editor closing mid-drag (a recording started by shortcut does this) ends the
  // drag, so the next editor can drag again.
  const h2 = (await panel.getByTestId('step-1-drag').boundingBox())!; // the drag above may have scrolled
  await panel.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(h2.x + h2.width / 2, h2.y + 60, { steps: 4 });
  await expect(panel.locator('.edit-steps.is-dragging')).toHaveCount(1);
  await panel.evaluate(() => (document.querySelector('[data-testid="close-editor"]') as HTMLElement).click());
  await panel.mouse.up();
  await panel.getByTestId(`edit-${guideId}`).click();
  await expect(panel.getByTestId('step-10-drag')).toBeVisible();
  await expect(panel.locator('.edit-steps.is-dragging, .edit-step.dragging, .drop-before, .drop-after')).toHaveCount(0);

  // Step 7 is below the fold: scroll to it, grab it, and hold near the top until the list is back at the top.
  await panel.getByTestId('step-6-drag').scrollIntoViewIfNeeded();
  await panel.evaluate(() => window.scrollBy(0, 200));
  expect((await panel.getByTestId('step-0').boundingBox())!.y).toBeLessThan(0); // the top is out of sight
  const h = (await panel.getByTestId('step-6-drag').boundingBox())!;
  const x = h.x + h.width / 2;
  await panel.mouse.move(x, h.y + h.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(x, h.y - 20, { steps: 4 });
  await panel.mouse.move(x, 4, { steps: 8 });
  await expect.poll(async () => (await panel.getByTestId('step-0').boundingBox())!.y, { timeout: 5000 }).toBeGreaterThan(0);
  const first = (await panel.getByTestId('step-0').boundingBox())!;
  await panel.mouse.move(x, first.y + 8, { steps: 3 });
  await expect(panel.getByTestId('step-0')).toHaveClass(/drop-before/);
  if (process.env.WAYMARK_SHOT) await panel.screenshot({ path: process.env.WAYMARK_SHOT });
  await panel.mouse.up();
  expect(await order(panel)).toEqual(['Step 7', ...ELEVEN.filter((t) => t !== 'Step 7')]);
  await expect(panel.getByTestId('reorder-status')).toHaveText('Step moved to position 1 of 11.');
  await expect(panel.locator('.edit-step[style*="transform"]')).toHaveCount(0);

  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toHaveText(/^Saved/);
  expect(await stored(ext, guideId)).toEqual(['Step 7', ...ELEVEN.filter((t) => t !== 'Step 7')]);
  await panel.reload();
  await panel.getByTestId(`edit-${guideId}`).click();
  expect(await order(panel)).toEqual(['Step 7', ...ELEVEN.filter((t) => t !== 'Step 7')]);
});

test('by keyboard: Space picks the step up, the arrow keys move it, Space drops it, Esc puts it back; Move to top / bottom; none for a team guide', async ({ context, ext, site, extensionId }) => {
  const { tabId, guideId } = await elevenSteps(context, ext, site);
  const panel = await context.newPage();
  await openEditor(panel, extensionId, tabId, guideId);

  // Review fix: picked up and put back without a move, the draft is unchanged (Save stays off).
  await panel.getByTestId('step-6-drag').focus();
  await panel.keyboard.press('Space');
  await panel.keyboard.press('Escape');
  await panel.getByTestId('step-0-drag').focus();
  await panel.keyboard.press('Enter');
  await panel.keyboard.press('Home'); // already at the top
  await panel.keyboard.press('ArrowUp');
  await panel.keyboard.press('Escape');
  await expect(panel.getByTestId('save-guide')).toBeDisabled();
  expect(await order(panel)).toEqual(ELEVEN);

  // Review fix: a click elsewhere drops a lifted step where it is.
  await panel.getByTestId('step-3-drag').focus();
  await panel.keyboard.press('Space');
  await expect(panel.getByTestId('step-3-drag')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByTestId('guide-title-edit').click();
  await expect(panel.getByTestId('step-3-drag')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByTestId('reorder-status')).toHaveText('Step dropped at position 4 of 11.');

  await panel.getByTestId('step-6-drag').focus();
  await panel.keyboard.press('Space');
  await expect(panel.getByTestId('step-6-drag')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('reorder-status')).toContainText('Step 7 of 11 picked up');
  for (let i = 0; i < 6; i++) await panel.keyboard.press('ArrowUp');
  await expect(panel.getByTestId('step-0-drag')).toBeFocused(); // focus stays on the moved step's handle
  await panel.keyboard.press('Space');
  await expect(panel.getByTestId('reorder-status')).toHaveText('Step dropped at position 1 of 11.');
  await expect(panel.getByTestId('step-0-drag')).toHaveAttribute('aria-pressed', 'false');
  const moved = ['Step 7', ...ELEVEN.filter((t) => t !== 'Step 7')];
  expect(await order(panel)).toEqual(moved);

  // Esc puts it back where it was picked up.
  await panel.keyboard.press('Space');
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('Escape');
  await expect(panel.getByTestId('reorder-status')).toHaveText('Move cancelled. Step back at position 1 of 11.');
  expect(await order(panel)).toEqual(moved);
  await expect(panel.getByTestId('step-0-drag')).toBeFocused();

  // Enter picks up, End sends it to the bottom, Tab drops it there.
  await panel.keyboard.press('Enter');
  await panel.keyboard.press('End');
  await expect(panel.getByTestId('step-10-drag')).toBeFocused();
  await panel.keyboard.press('Tab');
  await expect(panel.getByTestId('reorder-status')).toHaveText('Step dropped at position 11 of 11.');
  expect((await order(panel)).at(-1)).toBe('Step 7');
  await panel.getByTestId('step-10-drag').focus();
  await panel.keyboard.press('Space');
  await panel.keyboard.press('Home');
  await panel.keyboard.press('Space');
  expect(await order(panel)).toEqual(moved);

  // Move to top and to bottom, in More options.
  await panel.getByTestId('step-4-toggle').click();
  await panel.getByTestId('step-4-more').click();
  await panel.getByTestId('step-4-to-top').click();
  expect((await order(panel))[0]).toBe('Step 4'); // the 5th card in this order
  await panel.getByTestId('step-0-drag').focus();
  await panel.keyboard.press('Space');
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('Space');
  expect(await order(panel)).toEqual(moved);
  await panel.getByTestId('step-0-toggle').click();
  await panel.getByTestId('step-0-more').click();
  await expect(panel.getByTestId('step-0-to-top')).toBeDisabled();
  await panel.getByTestId('step-0-to-bottom').click();
  expect((await order(panel)).at(-1)).toBe('Step 7');
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toHaveText(/^Saved/);
  expect((await stored(ext, guideId)).at(-1)).toBe('Step 7');

  // A team guide is read-only: no handles.
  await (await ext.sw()).evaluate(async (id) => {
    const key = `guide:${id}`;
    const g = (await chrome.storage.local.get(key))[key] as object;
    await chrome.storage.local.set({ [key]: { ...g, source: 'library' } });
  }, guideId);
  await panel.reload();
  await panel.getByTestId(`edit-${guideId}`).click();
  await expect(panel.getByTestId('step-0-toggle')).toBeVisible();
  await expect(panel.locator('[data-testid$="-drag"]')).toHaveCount(0);
});

test('review fix: an open (tall) card drags down past the next card once its bottom edge passes that card\'s middle', async ({ context, ext, site, extensionId }) => {
  const { tabId, guideId } = await elevenSteps(context, ext, site);
  const panel = await context.newPage();
  await openEditor(panel, extensionId, tabId, guideId);
  await panel.getByTestId('step-0-toggle').click();
  await panel.getByTestId('step-0-more').click(); // taller still
  const card = (await panel.getByTestId('step-0').boundingBox())!;
  const next = (await panel.getByTestId('step-1').boundingBox())!;
  expect(card.height).toBeGreaterThan(next.height * 2);
  const h = (await panel.getByTestId('step-0-drag').boundingBox())!;
  const x = h.x + h.width / 2;
  // Just enough for the card's bottom edge to pass the next card's middle: far less than the card's height.
  const by = next.y + next.height / 2 - (card.y + card.height) + 12;
  expect(by).toBeLessThan(card.height / 2);
  await panel.mouse.move(x, h.y + h.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(x, h.y + h.height / 2 + by, { steps: 6 });
  await expect(panel.getByTestId('step-1')).toHaveClass(/drop-after/);
  await panel.mouse.up();
  expect((await order(panel)).slice(0, 2)).toEqual(['Step 2', 'Step 1']);
});
