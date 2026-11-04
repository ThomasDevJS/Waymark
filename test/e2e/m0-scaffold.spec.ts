/** M0 acceptance: the build loads; per-site grant registers the content script there only. */
import { canGrant, expect, launch, marker, serviceWorker, test, ExtensionHelper } from './fixtures';

test('the build loads in Chromium: service worker runs, manifest has no content_scripts or host_permissions', async ({ sw, ext }) => {
  expect(sw.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest).not.toHaveProperty('content_scripts');
  expect(manifest).not.toHaveProperty('host_permissions');
  expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
  expect(await ext.registeredMatches()).toEqual([]);
  const panel = await ext.extensionPage();
  await expect(panel.getByRole('heading', { name: 'Waymark' })).toBeVisible();
});

test('messages are checked against per-sender allowlists', async ({ ext, sw }) => {
  const panel = await ext.extensionPage();
  const reply = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'frame.claim', payload: { nonce: 'x' } }));
  expect(reply).toEqual({ ok: false, error: 'frame.claim not allowed from extension' });
  const bad = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'nope', payload: {} }));
  expect(bad).toEqual({ ok: false, error: 'unknown type' });
  const list = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'site.list', payload: {} }));
  expect(list).toEqual({ ok: true, data: { origins: [], registered: [] } });
  void sw;
});

test.describe('per-site permission', () => {
  test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

  test('granting a site registers the content script there and nowhere else; open tabs get it; revoking removes it', async ({ context, ext, site }) => {
    const before = await context.newPage();
    await before.goto(`${site.main}/?static`);
    expect(await marker(before, 'loaded')).toBeNull();

    await ext.grant('http://127.0.0.1/*');
    expect(await ext.registeredMatches()).toEqual(['http://127.0.0.1/*']);
    const reg = await (await ext.sw()).evaluate(() => chrome.scripting.getRegisteredContentScripts());
    expect(reg[0]).toMatchObject({ allFrames: true, matchOriginAsFallback: true, runAt: 'document_start', js: ['waymark-content.js'] });

    // Already-open tab of the granted site gets the script after the grant.
    await expect.poll(() => marker(before, 'loaded')).toBe('yes');

    // A new page on the granted site gets it at load.
    const granted = await context.newPage();
    await granted.goto(`${site.main}/?static`);
    await expect.poll(() => marker(granted, 'loaded')).toBe('yes');

    // Another site does not, and neither does the cross-origin iframe inside the granted page.
    const other = await context.newPage();
    await other.goto(`${site.other}/?static`);
    await other.waitForTimeout(500);
    expect(await marker(other, 'loaded')).toBeNull();
    const cross = granted.frames().find((f) => f.url().startsWith(site.other));
    expect(cross).toBeTruthy();
    expect(await marker(cross!, 'loaded')).toBeNull();
    // The same-origin iframe does.
    const same = granted.frames().find((f) => f.url().startsWith(`${site.main}/frame.html`));
    await expect.poll(() => marker(same!, 'loaded')).toBe('yes');

    await ext.revoke('http://127.0.0.1/*');
    expect(await ext.registeredMatches()).toEqual([]);
    const after = await context.newPage();
    await after.goto(`${site.main}/?static`);
    await after.waitForTimeout(500);
    expect(await marker(after, 'loaded')).toBeNull();
  });

  test('registrations are re-synced with granted permissions at startup', async ({ userDataDir, site }) => {
    let context = await launch(userDataDir);
    let ext = new ExtensionHelper(context, new URL((await serviceWorker(context)).url()).host, () => serviceWorker(context));
    await ext.grant('http://127.0.0.1/*');
    // Simulate drift: the registration disappears while the permission stays.
    await (await ext.sw()).evaluate(() => chrome.scripting.unregisterContentScripts());
    expect(await ext.registeredMatches()).toEqual([]);
    await context.close();

    context = await launch(userDataDir);
    ext = new ExtensionHelper(context, new URL((await serviceWorker(context)).url()).host, () => serviceWorker(context));
    await ext.waitFor(async () => (await ext.registeredMatches()).includes('http://127.0.0.1/*'));
    const page = await context.newPage();
    await page.goto(`${site.main}/?static`);
    await expect.poll(() => marker(page, 'loaded')).toBe('yes');
    await context.close();
  });
});
