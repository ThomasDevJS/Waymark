/**
 * D153: while recording, the page shows an outline on what a click will record, in the store
 * build's closed shadow root. It never takes the click, never ends up in recorded data, and can be
 * turned off in Settings.
 */
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

test('recording outlines what a click will record (closed root); the click still records; Settings turns it off', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?waymark-test-closed`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  expect(await app.evaluate(() => !!document.querySelector('waymark-overlay')?.shadowRoot)).toBe(false); // closed
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);

  await ext.message('rec.start', { tabId, title: 'Hover' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await expect.poll(() => marker(app, 'rec-hover')).toBe('none'); // on by default, nothing hovered yet
  await app.bringToFront();
  const orders = app.getByRole('link', { name: 'Orders', exact: true });
  await orders.hover();
  await expect.poll(() => marker(app, 'rec-hover')).toBe('ok');
  // The outline takes no pointer: the click lands on the link and is recorded as usual.
  await orders.click();
  await expect
    .poll(async () => ((await ext.message<{ steps: { title: string }[] } | null>('rec.state', {}))?.steps ?? []).map((s) => s.title))
    .toEqual(['Click **Orders**']);
  const stored = JSON.stringify(await (await ext.sw()).evaluate(() => chrome.storage.session.get('recording')));
  expect(stored).not.toContain('rec-box');
  expect(stored).not.toContain('waymark-overlay');

  // Off in Settings: the next view (a new step, or the next page) has no outline.
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(settings.getByTestId('rec-hover')).toBeChecked();
  await settings.getByTestId('rec-hover').uncheck();
  await expect.poll(() => ext.message<{ hover: boolean }>('recorder.settings.get', {}).then((s) => s.hover)).toBe(false);
  await app.bringToFront();
  await app.reload();
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('link', { name: 'Orders', exact: true }).hover();
  await app.waitForTimeout(300);
  expect(await marker(app, 'rec-hover')).not.toBe('ok');
  await ext.message('rec.stop', {});
  await expect.poll(() => marker(app, 'rec-hover')).not.toBe('ok');
});
