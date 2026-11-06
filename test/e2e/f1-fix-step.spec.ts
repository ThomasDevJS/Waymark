/**
 * Issue #95 (D210): an author fixes a broken step while playing their own guide. The not-found
 * card (and the tooltip, for a wrong highlight) offers Pick the right element; the picked element
 * is saved as a new revision, the run goes on, and the panel's toast offers Undo.
 */
import type { BrowserContext, Frame, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

type SavedGuide = { version: number; revisionId: string; source: string; steps: { id: string; target: { text?: string; framePath: string[] } }[] };

const tooltip = (p: Page) => p.locator('waymark-overlay .tip');

async function tabIdOf(ext: ExtensionHelper) {
  return (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
}

async function record(ext: ExtensionHelper, app: Page, tabId: number, title: string, actions: ((p: Page) => Promise<void>)[]) {
  await ext.message('rec.start', { tabId, title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  for (const a of actions) {
    await a(app);
    await app.waitForTimeout(150);
  }
  return ext.message<{ guideId: string; steps: { title: string }[] }>('rec.stop', {});
}

const guide = (ext: ExtensionHelper, id: string) => ext.message<SavedGuide>('guide.get', { id });

/** The app changed: the Export button is gone and a Download button took its job. */
async function renameExport(app: Page) {
  await app.evaluate(() => {
    document.querySelector('[data-fx="tb-export"]')?.remove();
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Download';
    document.getElementById('app-root')?.append(b);
  });
}

/** The partner iframe of page3.html, once Waymark runs in it. */
async function partnerFrame(app: Page): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(async () => {
      frame = app.frames().find((f) => f.url().includes('frame.html'));
      return frame ? await marker(frame, 'loaded') : null;
    })
    .not.toBeNull();
  return frame!;
}

async function openApp(context: BrowserContext, site: { main: string }) {
  const app = await context.newPage();
  await app.goto(`${site.main}/?static&seed=3`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  return app;
}

test('a not-found step is fixed from the card: Esc and a refused element change nothing, Undo restores it, a second play needs no card', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(150_000);
  await ext.grant('http://127.0.0.1/*');
  let app = await openApp(context, site);
  const tabId = await tabIdOf(ext);
  const { guideId } = await record(ext, app, tabId, 'Export the orders', [
    (p) => p.getByRole('button', { name: 'Import', exact: true }).click(),
    (p) => p.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const v1 = await guide(ext, guideId);
  expect(v1.steps[1]!.target.text).toBe('Export');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await app.bringToFront();
  await renameExport(app);
  await ext.message('run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');

  // A highlighted step of the author's own guide has Pick the right element in the tooltip. Esc
  // during that pick brings the highlight back.
  await tooltip(app).locator('[data-action="fix"]').click();
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await expect.poll(() => marker(app, 'player')).toBe('fixing:0');
  await expect(tooltip(app)).toHaveCount(0);
  await app.keyboard.press('Escape');
  await expect.poll(() => marker(app, 'picking')).toBe('off');
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await app.getByRole('button', { name: 'Import', exact: true }).click();

  // Step 2's button was renamed: the card offers the fix.
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toBe('not-found:1');
  const fix = tooltip(app).locator('[data-action="fix"]');
  await expect(fix).toHaveText('Pick the right element');

  // Esc during the pick: the card comes back, the guide is unchanged.
  await fix.click();
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await app.keyboard.press('Escape');
  await expect.poll(() => marker(app, 'picking')).toBe('off');
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toBe('not-found:1');
  expect((await guide(ext, guideId)).revisionId).toBe(v1.revisionId);

  // Something with nothing to find it by is refused, and picking goes on; the guide is unchanged.
  await tooltip(app).locator('[data-action="fix"]').click();
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await app.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'You have 3 overdue invoices this month. This sentence is plain text, not a button.';
    document.getElementById('app-root')?.prepend(p);
  });
  let appSawClick = false;
  await app.exposeFunction('__appClicked', () => (appSawClick = true));
  await app.evaluate(() => document.getElementById('app-root')?.addEventListener('click', () => (window as unknown as { __appClicked(): void }).__appClicked()));
  await app.getByText('You have 3 overdue invoices this month.').click();
  await expect.poll(() => marker(app, 'pick-rejected')).toBe('p');
  expect(await marker(app, 'picking')).toBe('on');
  expect((await guide(ext, guideId)).revisionId).toBe(v1.revisionId);

  // The right element: saved as a new revision, and the run goes on, drawn on it.
  await app.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => marker(app, 'picking')).toBe('off');
  expect(appSawClick).toBe(false); // the picking click never reached the app
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  const v2 = await guide(ext, guideId);
  expect(v2.version).toBe(v1.version + 1);
  expect(v2.revisionId).not.toBe(v1.revisionId);
  expect(v2.steps[1]!.target.text).toBe('Download');
  expect(v2.steps[1]!.id).toBe(v1.steps[1]!.id);
  expect(v2.steps[0]).toEqual(v1.steps[0]);

  // The panel's toast offers Undo: the old element and revision come back; the run stays on step 2.
  await panel.bringToFront();
  const toast = panel.getByTestId('fix-undo-toast');
  await expect(toast).toContainText('Fixed step 2');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await guide(ext, guideId)).revisionId).toBe(v1.revisionId);
  const back = await guide(ext, guideId);
  expect(back.steps[1]!.target.text).toBe('Export');
  expect(back.version).toBe(v1.version);
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toBe('not-found:1');

  // Fixed again, and the learner's click on the picked element finishes the guide.
  await tooltip(app).locator('[data-action="fix"]').click();
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await app.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  await app.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('done');
  expect((await guide(ext, guideId)).steps[1]!.target.text).toBe('Download');

  // A second play runs without the card.
  await app.close();
  app = await openApp(context, site);
  await renameExport(app);
  await ext.message('run.start', { tabId: await tabIdOf(ext), guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  await app.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('done');
});

test('a step in a cross-origin iframe is fixed by picking inside the frame; a library guide has no fix button', async ({ context, ext, site }) => {
  test.setTimeout(150_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  let app = await context.newPage();
  await app.goto(`${site.main}/page3.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  let frame = await partnerFrame(app);
  const tabId = await tabIdOf(ext);
  const { guideId } = await record(ext, app, tabId, 'Partner action', [(p) => p.frameLocator('iframe.partner-frame').getByRole('button', { name: 'Frame action' }).click()]);
  const v1 = await guide(ext, guideId);
  expect(v1.steps[0]!.target.framePath.length).toBe(1);

  // The partner changed its button: the old one is gone, a new one does the job.
  const change = async (f: Frame) =>
    f.evaluate(() => {
      document.getElementById('frame-button')?.remove();
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'partner-send';
      b.textContent = 'Send to partner';
      document.querySelector('form')?.append(b);
    });
  await change(frame);
  await ext.message('run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toBe('not-found:0');
  await tooltip(app).locator('[data-action="fix"]').click();
  await expect.poll(() => marker(frame, 'picking')).toBe('on');
  await app.frameLocator('iframe.partner-frame').getByRole('button', { name: 'Send to partner' }).click();
  await expect.poll(() => marker(frame, 'picking')).toBe('off');
  await expect.poll(() => marker(frame, 'player')).toBe('drawn:0');
  const v2 = await guide(ext, guideId);
  expect(v2.steps[0]!.target.text).toBe('Send to partner');
  expect(v2.steps[0]!.target.framePath).toEqual(v1.steps[0]!.target.framePath);
  await app.frameLocator('iframe.partner-frame').getByRole('button', { name: 'Send to partner' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('done');

  // The same guide as a library guide: neither the card nor the tooltip offers the fix.
  await (await ext.sw()).evaluate(async (id) => {
    const key = `guide:${id}`;
    const g = (await chrome.storage.local.get(key))[key] as object;
    await chrome.storage.local.set({ [key]: { ...g, source: 'library' } });
  }, guideId);
  await app.close();
  app = await context.newPage();
  await app.goto(`${site.main}/page3.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  frame = await partnerFrame(app);
  await change(frame);
  await ext.message('run.start', { tabId: await tabIdOf(ext), guideId });
  await expect.poll(() => marker(frame, 'player')).toBe('drawn:0');
  await expect(app.frameLocator('iframe.partner-frame').locator('waymark-overlay .tip [data-action="replay-voice"]')).toHaveCount(1);
  await expect(app.frameLocator('iframe.partner-frame').locator('waymark-overlay .tip [data-action="fix"]')).toHaveCount(0);
  // Gone again: the not-found card has Report broken step, but no fix.
  await frame.evaluate(() => document.getElementById('partner-send')?.remove());
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toBe('not-found:0');
  await expect(tooltip(app).locator('[data-action="report"]')).toBeVisible();
  await expect(tooltip(app).locator('[data-action="fix"]')).toHaveCount(0);
});
