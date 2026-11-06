/**
 * D200: the theme chosen in Settings overrides the system's light or dark setting, in Settings and
 * in the on-page overlay (live, without a reload); System follows the computer again.
 */
import type { Page } from '@playwright/test';
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const bg = (p: Page) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim());
const overlayTheme = (p: Page) => p.evaluate(() => document.querySelector('waymark-overlay')?.shadowRoot?.querySelector('.wm-theme')?.getAttribute('data-wm-theme') ?? 'none');

test('Light, Dark and System in Settings apply to Settings and to the overlay on an open page', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.emulateMedia({ colorScheme: 'light' });
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  // Something on the page so the overlay exists: start recording (the REC pill).
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  await ext.message('rec.start', { tabId, title: 'Theme' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  expect(await overlayTheme(app)).toBe('none');

  const settings = await context.newPage();
  await settings.emulateMedia({ colorScheme: 'light' });
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(settings.getByTestId('theme-system')).toBeChecked();
  const light = await bg(settings);

  // Dark, on a light system.
  await settings.getByTestId('theme-dark').check();
  await expect.poll(() => bg(settings)).not.toBe(light);
  await expect.poll(() => overlayTheme(app)).toBe('dark');
  const dark = await bg(settings);

  // Light, on a dark system.
  await settings.emulateMedia({ colorScheme: 'dark' });
  await settings.getByTestId('theme-light').check();
  await expect.poll(() => bg(settings)).toBe(light);
  await expect.poll(() => overlayTheme(app)).toBe('light');

  // System again: the dark system shows dark.
  await settings.getByTestId('theme-system').check();
  await expect.poll(() => bg(settings)).toBe(dark);
  await expect.poll(() => overlayTheme(app)).toBe('none');

  // A reopened page starts in the stored choice.
  await settings.getByTestId('theme-dark').check();
  await settings.emulateMedia({ colorScheme: 'light' });
  await settings.reload();
  await expect.poll(() => bg(settings)).toBe(dark);
  await ext.message('rec.stop', {});
});
