/**
 * D155: an app embedded through a wrapper frame on another site (as in Google Sites). The panel
 * offers Allow for the embedded sites one level at a time; once allowed, a click in the innermost
 * frame records and plays back, also after the wrapper moved to another address (a republish),
 * with the store build's closed overlay root.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const appFrame = (p: Page): Frame | undefined => p.frames().find((f) => f.url().includes('/embed/app.html'));
const wrapperFrame = (p: Page): Frame | undefined => p.frames().find((f) => f.url().includes('/embed/wrapper.html'));

async function acceptDialog(panel: Page) {
  await panel.waitForTimeout(1200);
  execFileSync('python3', [join(process.cwd(), 'test', 'e2e', 'helpers', 'x11-keys.py'), 'Tab,Return']);
}

test('embedded sites: Allow one level at a time; record and play a click in the innermost frame, after the wrapper moved too', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/embed/index.html?wrap=127.0.0.2&waymark-test-closed`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const sw = await ext.sw();
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);

  // The panel sees the wrapper's site only: Waymark can't look inside it yet.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByTestId('embeds-sites')).toHaveText(`127.0.0.2:${site.port}`);
  await panel.bringToFront();
  await panel.getByTestId('allow-embeds').click();
  await acceptDialog(panel);
  // Allowed, the wrapper reports the app inside it: the next level is offered.
  await expect(panel.getByTestId('embeds-sites')).toHaveText(`localhost:${site.port}`, { timeout: 10_000 });
  await panel.getByTestId('allow-embeds').click();
  await acceptDialog(panel);
  await expect(panel.getByTestId('embeds-offer')).toHaveCount(0, { timeout: 10_000 });

  // Record a click in the innermost frame (the content script reaches it once its site is allowed).
  await app.bringToFront();
  await app.reload();
  await expect.poll(async () => (appFrame(app) ? marker(appFrame(app)!, 'frame-path') : null), { timeout: 10_000 }).not.toBeNull();
  expect(JSON.parse((await marker(appFrame(app)!, 'frame-path'))!)).toHaveLength(2);
  await ext.message('rec.start', { tabId, title: 'Approve' });
  await expect.poll(() => marker(appFrame(app)!, 'recording')).toBe('on');
  await appFrame(app)!.getByRole('button', { name: 'Approve shipment' }).click();
  await app.waitForTimeout(300);
  const rec = await ext.message<{ guideId: string; steps: { title: string; target?: { framePath: string[] } }[] }>('rec.stop', {});
  expect(rec.steps.map((s) => s.title)).toEqual(['Click **Approve shipment**']);
  expect(rec.steps[0]!.target!.framePath).toHaveLength(2);

  // The site is republished: the wrapper has a new address. The panel offers it again.
  await app.goto(`${site.main}/embed/index.html?wrap=127.0.0.3&waymark-test-closed`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await panel.bringToFront();
  await expect(panel.getByTestId('embeds-sites')).toHaveText(`127.0.0.3:${site.port}`, { timeout: 10_000 });
  await panel.getByTestId('allow-embeds').click();
  await acceptDialog(panel);
  await expect(panel.getByTestId('embeds-offer')).toHaveCount(0, { timeout: 10_000 });

  // Plays: the step is found in the app frame through the new wrapper.
  await app.bringToFront();
  await app.reload();
  await expect.poll(async () => (appFrame(app) ? marker(appFrame(app)!, 'frame-path') : null), { timeout: 10_000 }).not.toBeNull();
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await expect.poll(() => marker(appFrame(app)!, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  expect(await appFrame(app)!.evaluate(() => !!document.querySelector('waymark-overlay')?.shadowRoot)).toBe(false); // closed
  // The wrapper isn't a guide site: it never draws the step (it gets no guide data, D48).
  expect(await marker(wrapperFrame(app)!, 'player')).not.toBe('drawn:0');
  await appFrame(app)!.getByRole('button', { name: 'Approve shipment' }).click();
  await expect.poll(() => marker(appFrame(app)!, 'approved')).toBe('1');
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('done');
});
