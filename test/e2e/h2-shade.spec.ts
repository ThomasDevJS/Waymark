/**
 * The highlight shade end to end (D144–D147), with the store build's closed overlay root: the
 * author sets a guide's shade in the editor, the guide file carries it, the page draws it, and
 * the learner's Settings choice overrides it on the page at once (and "Follow each guide" brings
 * the guide's back). The test build marks the dim's computed colour (`data-waymark-test-shade`).
 */
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

async function tabIdFor(ext: ExtensionHelper, page: Page): Promise<number> {
  const url = page.url();
  return (await ext.sw()).evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
}

/** The test build's mark: the drawn level and the dim's alpha (rgba(…) or color(srgb … / a)). */
async function shadeOf(page: Page): Promise<string> {
  const m = (await marker(page, 'shade')) ?? '';
  const [level, css = ''] = m.split('|');
  const a = /\/\s*([\d.]+)\s*\)/.exec(css)?.[1] ?? /rgba\([^)]*,\s*([\d.]+)\)/.exec(css)?.[1] ?? '1';
  return `${level}:${Number(a).toFixed(2)}`;
}

async function openApp(context: BrowserContext, url: string) {
  const app = await context.newPage();
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  return app;
}

test('shade: the editor sets it per guide, the guide file carries it, the page draws it, Settings overrides it (closed root)', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static&waymark-test-closed`);
  const tabId = await tabIdFor(ext, app);
  await ext.message('rec.start', { tabId, title: 'Shaded' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(150);
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});

  // The author picks Darker for this guide in the editor.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}&edit=${guideId}`);
  await expect(panel.getByTestId('guide-shade')).toHaveValue('');
  await panel.getByTestId('guide-shade').selectOption('darker');
  await panel.getByTestId('save-guide').click();
  await expect.poll(async () => (await ext.message<{ shade?: string }>('guide.get', { id: guideId })).shade).toBe('darker');

  // The guide file carries it.
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('export').click();
  await panel.getByLabel('Select Shaded for export').check();
  await panel.getByTestId('export-selected').click();
  const [file] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download-pack').click()]);
  const pack = JSON.parse(readFileSync((await file.path())!, 'utf8')) as { guides: { id: string; shade?: string }[] };
  expect(pack.guides.find((g) => g.id === guideId)?.shade).toBe('darker');

  // Played: the page draws the guide's shade (the learner follows each guide by default).
  await ext.message('run.start', { tabId, guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  expect(await app.evaluate(() => document.querySelector('waymark-overlay')?.shadowRoot ?? null)).toBeNull();
  await expect.poll(() => shadeOf(app)).toMatch(/^darker:/);
  const darker = Number((await shadeOf(app)).split(':')[1]);

  // The learner picks Lighter in Settings: the step on the page follows at once, without moving on.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#highlight`);
  await expect(options.getByTestId('shade-guide')).toBeChecked();
  await options.getByTestId('shade-lighter').check();
  await expect.poll(async () => (await ext.message<{ shade: string }>('player.settings.get', {})).shade).toBe('lighter');
  await app.bringToFront();
  await expect.poll(() => shadeOf(app)).toMatch(/^lighter:/);
  // Clearly lighter than the guide's Darker (two levels apart).
  expect(darker - Number((await shadeOf(app)).split(':')[1])).toBeGreaterThan(0.2);
  expect(await marker(app, 'player')).toBe('drawn:0');

  // Back to "Follow each guide": the guide's Darker again.
  await options.bringToFront();
  await options.getByTestId('shade-guide').check();
  await app.bringToFront();
  await expect.poll(() => shadeOf(app)).toBe(`darker:${darker.toFixed(2)}`);
  // The step still moves on as before.
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:1');
  await expect.poll(() => shadeOf(app)).toMatch(/^darker:/);
});

test('shade: tutorials on the Practice page follow the Settings choice', async ({ context, extensionId, sw }) => {
  await sw.evaluate(() => chrome.storage.local.set({ playerSettings: { shade: 'darker' } }));
  const practice = await context.newPage();
  await practice.goto(`chrome-extension://${extensionId}/practice.html?tutorial=tour`);
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
  await practice.locator('waymark-overlay [data-action="next"]').click(); // step 2 has a target, so a dim
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:1');
  await expect.poll(() => shadeOf(practice)).toMatch(/^darker:/);
  const dark = Number((await shadeOf(practice)).split(':')[1]);
  // Changed in Settings while the tutorial plays: the drawn step follows.
  await sw.evaluate(() => chrome.storage.local.set({ playerSettings: { shade: 'lighter' } }));
  await expect.poll(() => shadeOf(practice)).toMatch(/^lighter:/);
  expect(dark - Number((await shadeOf(practice)).split(':')[1])).toBeGreaterThan(0.2);
});
