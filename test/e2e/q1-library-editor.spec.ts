/**
 * Library and editor conveniences (D100–D102), end to end: Undo for a deleted guide survives the
 * panel closing; duplicate guide and step; tags and the tag chips; the completed checkmark with
 * Restart; and "Start from step N".
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

/** Records "Click Import → Click Export" on /app/orders. */
async function recordOrders(ext: ExtensionHelper, app: Page, title: string): Promise<string> {
  const tabId = await tabIdFor(ext, app);
  await ext.message('rec.start', { tabId, title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(150);
  return (await ext.message<{ guideId: string }>('rec.stop', {})).guideId;
}

async function openPanel(context: BrowserContext, extensionId: string, tabId: number, edit?: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}${edit ? `&edit=${edit}` : ''}`);
  return panel;
}

test('a deleted guide can be restored with Undo, even from a panel opened after the first one closed', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const guideId = await recordOrders(ext, app, 'Keep me safe');
  const tabId = await tabIdFor(ext, app);

  let panel = await openPanel(context, extensionId, tabId);
  await expect(panel.getByTestId(`guide-${guideId}`)).toBeVisible();
  await panel.getByTestId(`more-${guideId}`).click();
  await panel.getByTestId(`delete-${guideId}`).click();
  await expect(panel.getByTestId(`guide-${guideId}`)).toHaveCount(0);
  await expect(panel.getByTestId('guide-undo-toast')).toContainText('Deleted “Keep me safe”.');
  await expect(panel.getByTestId('toast-undo')).toBeFocused();
  // The panel closes before Undo: the guide is in the trash, not lost.
  await panel.close();
  expect(await ext.message<{ guides: unknown[] }>('guide.list', {})).toMatchObject({ guides: [] });
  // CI can be slow: restart the 8 s window now, so the reopened panel is surely inside it.
  await (await ext.sw()).evaluate(async () => {
    const t = (await chrome.storage.local.get('guides:trash'))['guides:trash'] as { deletedAt: number }[];
    await chrome.storage.local.set({ 'guides:trash': t.map((e) => ({ ...e, deletedAt: Date.now() })) });
  });
  panel = await openPanel(context, extensionId, tabId);
  await expect(panel.getByTestId('guide-undo-toast')).toContainText('Keep me safe');
  await panel.getByTestId('toast-undo').click();
  await expect(panel.getByTestId(`guide-${guideId}`)).toBeVisible();
  await expect(panel.getByTestId('library-message')).toContainText('Restored');
  const g = await ext.message<{ steps: unknown[]; title: string }>('guide.get', { id: guideId });
  expect(g).toMatchObject({ title: 'Keep me safe' });
  expect(g.steps).toHaveLength(2);

  // After the window, the toast goes and the trash is empty.
  await panel.getByTestId(`more-${guideId}`).click();
  await panel.getByTestId(`delete-${guideId}`).click();
  await expect(panel.getByTestId('guide-undo-toast')).toBeVisible();
  await expect(panel.getByTestId('guide-undo-toast')).toHaveCount(0, { timeout: 12_000 });
  await expect.poll(async () => (await ext.message<{ items: unknown[] }>('trash.list', {})).items).toEqual([]);
  // The deleted guide is gone from disk too, not only hidden.
  expect(await (await ext.sw()).evaluate(async () => Object.keys(await chrome.storage.local.get('guides:trash')))).toEqual([]);
});

test('duplicate a guide and a step; tags filter the library', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const guideId = await recordOrders(ext, app, 'Orders basics');
  const tabId = await tabIdFor(ext, app);

  // Editor: tags, a duplicated step, then a deleted step with Undo.
  const panel = await openPanel(context, extensionId, tabId, guideId);
  await panel.getByTestId('guide-tags').fill('orders, Onboarding');
  await panel.getByTestId('step-0-duplicate').click();
  await expect(panel.getByTestId('step-2')).toBeVisible();
  await panel.getByTestId('step-2-delete').click();
  await expect(panel.getByTestId('step-undo-toast')).toContainText('Deleted step 3.');
  await panel.getByTestId('toast-undo').click();
  await expect(panel.getByTestId('step-2')).toBeVisible();
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toContainText('Saved (version 2)');
  const saved = await ext.message<{ tags: string[]; steps: { id: string; title: string }[] }>('guide.get', { id: guideId });
  expect(saved.tags).toEqual(['orders', 'Onboarding']);
  expect(saved.steps.map((s) => s.title)).toEqual(['Click **Import**', 'Click **Import**', 'Click **Export**']);
  expect(new Set(saved.steps.map((s) => s.id)).size).toBe(3);
  await panel.getByTestId('close-editor').click();

  // Library: duplicate the guide, then filter by a tag only the original has.
  await recordOrders(ext, app, 'Untagged guide');
  await panel.getByTestId(`more-${guideId}`).click();
  await panel.getByTestId(`duplicate-guide-${guideId}`).click();
  await expect(panel.getByTestId('library-message')).toContainText('Made a copy: “Orders basics (copy)”.');
  await expect(panel.locator('.guide-title')).toHaveCount(3);
  await panel.getByTestId('tag-orders').click();
  await expect(panel.getByTestId('tag-orders')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.guide-title')).toHaveText(['Orders basics', 'Orders basics (copy)']);
  await panel.getByTestId('search').fill('copy');
  await expect(panel.locator('.guide-title')).toHaveText(['Orders basics (copy)']);
  await panel.getByTestId('search').fill('');
  await panel.getByTestId('clear-tags').click();
  await expect(panel.locator('.guide-title')).toHaveCount(3);
});

test('a finished guide shows a checkmark and Restart; Start from step N starts there', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const guideId = await recordOrders(ext, app, 'Finish me');
  const tabId = await tabIdFor(ext, app);
  const panel = await openPanel(context, extensionId, tabId);
  await expect(panel.getByTestId(`completed-${guideId}`)).toHaveCount(0);

  // Start from step 2: the run begins on "Click Export".
  await panel.getByTestId(`more-${guideId}`).click();
  await panel.getByTestId(`start-from-${guideId}`).selectOption('1');
  await panel.getByTestId(`start-step-${guideId}`).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:1');
  await expect(app.locator('waymark-overlay .tip .count')).toHaveText('Step 2 of 2');
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => marker(app, 'player')).toBe('done');

  // The library marks it finished; the run card and the row offer Restart.
  await expect(panel.getByTestId(`completed-${guideId}`)).toContainText('Completed');
  await expect(panel.getByTestId(`start-${guideId}`)).toContainText('Restart');
  await panel.getByTestId('restart-run').click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  await expect(app.locator('waymark-overlay .tip .count')).toHaveText('Step 1 of 2');
  await expect(panel.getByTestId('run-status')).toContainText('step 1 of 2');
});
