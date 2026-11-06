/**
 * D202 (#89): an author adds a forgotten step to a recorded guide, by picking it on the page or by
 * recording steps into the guide at a chosen place.
 */
import type { Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

async function setup(context: import('@playwright/test').BrowserContext, ext: ExtensionHelper, site: { main: string }) {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?static&seed=3`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  await ext.message('rec.start', { tabId, title: 'Export' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(200);
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  return { app, tabId, guideId };
}
const stored = async (ext: ExtensionHelper, id: string) => ext.message<{ version: number; revisionId: string; title: string; steps: { title: string }[] }>('guide.get', { id });
const titles = async (ext: ExtensionHelper, id: string) => (await stored(ext, id)).steps.map((s) => s.title);

async function pickOn(app: Page, name: string, role: 'button' | 'link' = 'button') {
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await app.bringToFront();
  await app.getByRole(role, { name, exact: true }).click();
  await expect.poll(() => marker(app, 'picking')).toBe('off');
}

test('Add a step: pick it on the page, at the end and after a step; Save keeps them in place', async ({ context, ext, site, extensionId }) => {
  const { app, tabId, guideId } = await setup(context, ext, site);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${guideId}`).click();

  await panel.getByTestId('end-add-pick').click();
  await pickOn(app, 'CSV');
  await panel.bringToFront();
  await expect(panel.getByTestId('step-1-title')).toHaveValue('Click **CSV**'); // opened, ready to edit

  await panel.getByTestId('step-0-toggle').click();
  await panel.getByTestId('step-0-more').click();
  await panel.getByTestId('step-0-add-pick').click(); // after "Export"
  // Steps move while the pick waits: the new step still goes after "Export" (review of D202).
  await panel.getByTestId('step-1-up').click(); // CSV, Export
  await pickOn(app, 'Orders', 'link');
  await panel.bringToFront();
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toHaveText('Saved (version 2).');
  expect(await titles(ext, guideId)).toEqual(['Click **CSV**', 'Click **Export**', 'Click **Orders**']);
});

test('Record steps here: Stop puts them into the guide at that place; not while there are unsaved edits', async ({ context, ext, site, extensionId }) => {
  const { app, tabId, guideId } = await setup(context, ext, site);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${guideId}`).click();
  // Unsaved edits first: recording into the guide would conflict with them.
  await panel.getByTestId('guide-title-edit').fill('Export as CSV');
  await expect(panel.getByTestId('end-add-record')).toBeDisabled();
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toHaveText('Saved (version 2).');

  await panel.getByTestId('end-add-record').click();
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.bringToFront();
  await app.getByRole('button', { name: 'CSV' }).click();
  await app.waitForTimeout(200);
  await panel.bringToFront();
  await panel.getByTestId('stop').click();
  await expect(panel.getByTestId('saved')).toContainText('Added 1 step to “Export as CSV”');
  await expect(panel.getByTestId('guide-title-edit')).toHaveValue('Export as CSV'); // back in the same guide
  const g = await stored(ext, guideId);
  expect(g.version).toBe(3);
  expect(g.steps.map((s) => s.title)).toEqual(['Click **Export**', 'Click **CSV**']);
});

test('a guide changed while recording into it: the new steps become their own guide, nothing is lost', async ({ context, ext, site }) => {
  const { app, tabId, guideId } = await setup(context, ext, site);
  const before = await stored(ext, guideId);
  await ext.message('rec.start', { tabId, title: '', insertInto: { guideId, at: 0 } });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'CSV' }).click();
  await app.waitForTimeout(200);
  // Saved elsewhere meanwhile (another panel).
  const g = await stored(ext, guideId);
  await ext.message('guide.save', { guide: { ...g, title: 'Renamed elsewhere' }, baseRevisionId: before.revisionId });
  const r = await ext.message<{ guideId: string; title: string; aside?: boolean; added?: unknown }>('rec.stop', {});
  expect(r.aside).toBe(true);
  expect(r.added).toBeUndefined();
  expect(r.guideId).not.toBe(guideId);
  expect(await titles(ext, r.guideId)).toEqual(['Click **CSV**']);
  expect(r.title).toBe('Export (added steps)');
  expect(await titles(ext, guideId)).toEqual(['Click **Export**']); // untouched by the recording
});
