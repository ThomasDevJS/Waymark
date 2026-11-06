/**
 * D203: a guide whose first page has an id in its address (the owner's case: /o/:id/fleet/list). From
 * another page of the site, the panel opens the start page with the id filled in from that page;
 * from a page without it, plain words and a link to the site, never a pattern.
 */
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

test('Open start page fills the id in from the page the learner is on', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/app/o/4815162342/orders?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  await ext.message('rec.start', { tabId, title: 'Export' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(200);
  const rec = await ext.message<{ guideId: string; steps: { url: { value: string } }[] }>('rec.stop', {});
  expect(rec.steps[0]!.url.value).toBe('/app/o/:id/orders'); // no id kept (D33)

  // Another page of the same account: the start page can be opened for the learner.
  await app.goto(`${site.main}/app/o/4815162342/settings?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`start-${rec.guideId}`).click();
  await expect(panel.getByTestId('open-start')).toHaveText('Open start page');
  await expect(panel.getByTestId('start-hint')).toHaveCount(0);
  await panel.getByTestId('open-start').click();
  await expect.poll(() => app.url()).toBe(`${site.main}/app/o/4815162342/orders`);
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:0');
  await ext.message('run.stop', { tabId }).catch(() => undefined);

  // A page without the id: plain words and the site, never a pattern.
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await panel.bringToFront();
  await panel.reload();
  await panel.getByTestId(`start-${rec.guideId}`).click();
  await expect(panel.getByTestId('start-hint')).toContainText('in this tab and sign in if needed');
  await expect(panel.getByTestId('start-hint')).not.toContainText(':id');
});
