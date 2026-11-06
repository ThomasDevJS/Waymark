/**
 * Issue #69 (D170–D172): with 6 or more guides for a page, the side panel's "For this page" list
 * and the on-page ? menu get a search box. The menu runs in the production closed shadow root
 * (`waymark-test-closed`) and is driven by the keyboard only, from the box to a started guide.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, ExtensionHelper, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const msg = <T,>(ext: ExtensionHelper, type: string, payload: object) => ext.message<T>(type, payload);

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

/** Titles and tags of the guides made for /app/orders: seven, so both search boxes show. */
const GUIDES: { title: string; tags: string[] }[] = [
  { title: 'Import orders', tags: ['Orders'] },
  { title: 'Crème brûlée order', tags: ['Kitchen'] },
  { title: 'Refund a payment', tags: ['Billing'] },
  { title: 'Send an invoice', tags: ['Billing'] },
  { title: 'Invite a teammate', tags: ['Team'] },
  { title: 'Export the report', tags: ['Reports'] },
  { title: 'Change the address', tags: ['Account'] },
];

test('6+ guides for a page: search in the panel and in the ? menu (closed root), start a guide by keyboard', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const tabId = await tabIdFor(ext, app);
  // One recorded guide ("Import" → "Export"), copied six times under other titles and tags.
  await msg(ext, 'rec.start', { tabId, title: GUIDES[0]!.title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(150);
  const { guideId } = await msg<{ guideId: string }>(ext, 'rec.stop', {});
  const ids: Record<string, string> = {};
  for (const [i, g] of GUIDES.entries()) {
    const base = i === 0 ? await msg<{ id: string; revisionId: string }>(ext, 'guide.get', { id: guideId }) : await msg<{ id: string; revisionId: string }>(ext, 'guide.duplicate', { id: guideId });
    await msg(ext, 'guide.save', { guide: { ...base, title: g.title, tags: g.tags }, baseRevisionId: base.revisionId });
    ids[g.title] = base.id;
  }

  // ---- side panel: the box and chips narrow "For this page" only ----
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  const forPage = panel.getByTestId('for-this-page');
  await expect(forPage.locator(':scope > li')).toHaveCount(7);
  await panel.getByTestId('page-search').fill('creme'); // accents don't matter
  await expect(forPage.locator(':scope > li')).toHaveCount(1);
  await expect(forPage).toContainText('Crème brûlée order');
  await panel.getByTestId('page-search').fill('zzzz');
  await expect(panel.getByTestId('page-search-status')).toHaveText('No guides match');
  await expect(forPage).toBeHidden();
  await panel.getByTestId('page-search').press('Escape'); // clears
  await expect(panel.getByTestId('page-search')).toHaveValue('');
  await expect(forPage.locator(':scope > li')).toHaveCount(7);
  // Chips: the most common tags of this page's guides, at most three.
  await expect(panel.getByTestId('page-tag-chips').getByRole('button')).toHaveCount(3);
  await panel.getByTestId('page-tag-Billing').click();
  await expect(forPage.locator(':scope > li')).toHaveCount(2);
  await panel.getByTestId('page-tag-Billing').click();

  // The ? button is on by default (D150).
  await panel.getByTestId('site-options').click();
  await expect(panel.getByTestId('launcher-toggle')).toBeChecked();

  // ---- the ? menu, in the production closed shadow root ----
  await app.bringToFront();
  await app.goto(`${site.main}/app/orders?static&waymark-test-closed`);
  await expect.poll(() => marker(app, 'launcher')).toBe('7');
  expect(await app.evaluate(() => !!document.querySelector('waymark-overlay') && !document.querySelector('waymark-overlay')!.shadowRoot)).toBe(true);
  const vp = app.viewportSize()!;
  const [cx, cy] = [vp.width - 16 - 22, vp.height - 16 - 22];
  await expect.poll(() => app.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, [cx, cy]), { intervals: [10] }).toBe('WAYMARK-OVERLAY');
  await app.mouse.click(cx, cy);
  await expect.poll(() => marker(app, 'launcher-menu')).toBe('search');
  // Focus is in the box: typing filters at once, without clicking it.
  await app.keyboard.type('INV');
  await expect.poll(() => marker(app, 'launcher-results')).toBe([ids['Send an invoice'], ids['Invite a teammate']].join(','));
  await app.keyboard.press('Escape'); // clears
  await expect.poll(() => marker(app, 'launcher-results')).toBe(GUIDES.map((g) => ids[g.title]).join(','));
  await app.keyboard.type('billing'); // a tag
  await expect.poll(() => marker(app, 'launcher-results')).toBe([ids['Refund a payment'], ids['Send an invoice']].join(','));
  await app.keyboard.press('ArrowDown');
  await expect.poll(() => marker(app, 'launcher-active')).toBe(ids['Send an invoice']);
  await app.keyboard.press('Enter');
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  const run = await msg<{ guideId: string }>(ext, 'run.state', { tabId });
  expect(run.guideId).toBe(ids['Send an invoice']);
  await expect.poll(() => marker(app, 'launcher-menu')).toBe('closed');
});
