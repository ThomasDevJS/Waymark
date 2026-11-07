/**
 * Issue #97 (D213): Site options → Advanced matching. A stable attribute set in the panel is
 * recorded and finds the steps after the visible labels changed (without it they aren't found);
 * an ignore pattern keeps generated ids out; Save tests the page's steps before and after; a pack
 * carries the profile to another library; a team guide uses the library's profile.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

type Fp = { testId?: { attr: string; value: string }; id?: string };
type G = { id: string; revisionId: string; source: string; steps: { target: Fp; url: { value: string } }[] } & Record<string, unknown>;

async function tabIdOf(ext: ExtensionHelper) {
  return (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
}

async function open(context: BrowserContext, url: string): Promise<Page> {
  const app = await context.newPage();
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  return app;
}

async function record(context: BrowserContext, ext: ExtensionHelper, site: { main: string }, title: string): Promise<string> {
  const app = await open(context, `${site.main}/automation.html`);
  await ext.message('rec.start', { tabId: await tabIdOf(ext), title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  for (const name of ['Save', 'Print']) {
    await app.getByRole('button', { name, exact: true }).click();
    await app.waitForTimeout(200);
  }
  const { guideId } = await ext.message<{ guideId: string }>('rec.stop', {});
  await app.close();
  return guideId;
}

/** Plays the guide on the page whose labels changed; returns how far it got. */
async function playRenamed(context: BrowserContext, ext: ExtensionHelper, site: { main: string }, guideId: string): Promise<string> {
  const app = await open(context, `${site.main}/automation.html?renamed`);
  await ext.message('run.start', { tabId: await tabIdOf(ext), guideId });
  await expect.poll(() => marker(app, 'player'), { timeout: 20_000 }).toMatch(/^(drawn|not-found):0$/);
  if ((await marker(app, 'player')) !== 'drawn:0') {
    const out = (await marker(app, 'player'))!;
    await app.close();
    return out;
  }
  await app.getByRole('button', { name: 'Store' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  await app.getByRole('button', { name: 'Output' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('done');
  await app.close();
  return 'done';
}

const profile = (origin: string, over: Record<string, unknown> = {}) => ({ origin, stableAttributes: [], ignorePatterns: [], hashRouting: false, keepQueryKeys: [], ...over });

test('Advanced matching: a stable attribute and an ignore pattern set in the panel; steps survive renamed labels; Save tests before and after; Revert', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(180_000);
  await ext.grant('http://127.0.0.1/*');
  const page = await open(context, `${site.main}/automation.html`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${await tabIdOf(ext)}`);
  await panel.getByTestId('site-options').click();
  await panel.getByTestId('advanced-matching').locator('summary').click();

  // Find candidates on this page lists the attribute; Add puts it in the field.
  await panel.getByTestId('matching-find').click();
  await expect(panel.getByTestId('matching-candidates')).toContainText('data-automation-id');
  await panel.getByTestId('matching-add-data-automation-id').click();
  await expect(panel.getByTestId('matching-attrs')).toHaveValue('data-automation-id');
  // A pattern Waymark can't use is refused in plain words.
  await panel.getByTestId('matching-patterns').fill('*');
  await panel.getByTestId('matching-save').click();
  await expect(panel.getByTestId('matching-error')).toContainText('not a pattern');
  await panel.getByTestId('matching-patterns').fill('id=gen-*');
  await panel.getByTestId('matching-save').click();
  await expect(panel.getByTestId('matching-outcome')).toContainText('nothing was tested');
  await panel.getByTestId('matching-keep').click();
  await page.close();

  // Recorded with the profile: the stable attribute is the test id, the generated id is left out.
  const withProfile = await record(context, ext, site, 'With profile');
  const g = await ext.message<G>('guide.get', { id: withProfile });
  expect(g.steps[0]!.target.testId).toEqual({ attr: 'data-automation-id', value: 'save-order' });
  expect(g.steps[0]!.target.id).toBeUndefined();
  expect(await playRenamed(context, ext, site, withProfile)).toBe('done');

  // Without the profile the same change breaks the guide (and nothing wrong is highlighted).
  await ext.message('profile.site.set', { origin: site.main, profile: null });
  const without = await record(context, ext, site, 'Without profile');
  expect((await ext.message<G>('guide.get', { id: without })).steps[0]!.target.testId).toBeUndefined();
  expect(await playRenamed(context, ext, site, without)).toBe('not-found:0');

  // Save on the renamed page tests the site's steps before and after; Revert puts it back.
  const renamed = await open(context, `${site.main}/automation.html?renamed`);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${await tabIdOf(ext)}`);
  await panel.getByTestId('site-options').click();
  await panel.getByTestId('advanced-matching').locator('summary').click();
  await expect(panel.getByTestId('matching-attrs')).toHaveValue('');
  await panel.getByTestId('matching-attrs').fill('data-automation-id');
  await panel.getByTestId('matching-save').click();
  // "With profile" finds both steps either way; "Without profile" was recorded without the attribute: not found either way.
  await expect(panel.getByTestId('matching-summary')).toContainText('2 → 2 found');
  await expect(panel.getByTestId('matching-summary')).toContainText('2 → 2 not found');
  await panel.getByTestId('matching-revert').click();
  await expect(panel.getByTestId('matching-attrs')).toHaveValue('');
  expect(await ext.message('profile.site.get', { origin: site.main })).toEqual({ local: null, library: null });
  await renamed.close();
});

test('a pack carries the profile to a fresh library; a team guide uses the library’s profile over the own one', async ({ context, ext, site }) => {
  test.setTimeout(180_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.message('profile.site.set', { origin: site.main, profile: profile(site.main, { stableAttributes: ['data-automation-id'] }) });
  const id = await record(context, ext, site, 'Carried');
  const guide = await ext.message<G>('guide.get', { id });
  const pack = JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: new Date().toISOString(), guides: [guide], profiles: [profile(site.main, { stableAttributes: ['data-automation-id'] })] });

  // Gone from this Waymark: the guide and the profile.
  await ext.message('guide.delete', { id });
  await ext.message('profile.site.set', { origin: site.main, profile: null });
  const check = await ext.message<{ profiles: { origin: string; status: string }[] }>('pack.check', { text: pack });
  expect(check.profiles).toEqual([{ origin: site.main, status: 'new' }]);
  await ext.message('pack.import', { text: pack, choices: {} });
  expect(((await ext.message<{ local: { stableAttributes: string[] } }>('profile.site.get', { origin: site.main })).local).stableAttributes).toEqual(['data-automation-id']);
  expect(await playRenamed(context, ext, site, id)).toBe('done');

  // A hash-routed team guide: its step is on #/orders. The library says hash routing; the own profile doesn't.
  await ext.message('profile.site.set', { origin: site.main, profile: profile(site.main, { hashRouting: false, stableAttributes: ['data-automation-id'] }) });
  const team = {
    ...guide,
    id: '01TEAMHASHGUIDE00000000000',
    revisionId: '01TEAMHASHREV0000000000000',
    title: 'Team hash guide',
    startUrl: `${site.main}/automation.html#/orders`,
    matchUrls: [{ kind: 'pattern', value: '/orders' }],
    steps: guide.steps.map((s) => ({ ...s, url: { kind: 'pattern', value: '/orders' } })),
  };
  const res = await fetch(`${site.main}/__library`, { method: 'PUT', body: JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: '', guides: [team], profiles: [profile(site.main, { hashRouting: true })] }) });
  expect(res.status).toBe(204);
  await ext.message('library.set', { url: `${site.main}/library.waymark.json` });
  await expect.poll(async () => (await ext.message<{ guides: { id: string; source: string }[] }>('guide.list', {})).guides.find((x) => x.id === team.id)?.source).toBe('library');
  expect(((await ext.message<{ library: { hashRouting: boolean } }>('profile.site.get', { origin: site.main })).library).hashRouting).toBe(true);

  const app = await open(context, `${site.main}/automation.html#/orders`);
  // The team guide's start page is #/orders with the library's hash routing: it starts here.
  expect(await ext.message('run.start', { tabId: await tabIdOf(ext), guideId: team.id })).toEqual({ status: 'started' });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await ext.message('run.stop', { tabId: await tabIdOf(ext) });
  // Its own copy (Duplicate) is the author's guide: the own profile has no hash routing, so this page isn't its start.
  const copy = await ext.message<{ id: string }>('guide.duplicate', { id: team.id });
  expect(await ext.message('run.start', { tabId: await tabIdOf(ext), guideId: copy.id })).toMatchObject({ status: 'needs-start' });
});
