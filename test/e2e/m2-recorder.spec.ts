/** M2 acceptance: the fixture's 10-action scenario yields exactly the expected steps; no typed value is stored. */
import { canGrant, expect, marker, test } from './fixtures';
import type { Page } from '@playwright/test';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const TYPED = ['Ada', 'Lovelace', 'ada@example.com', 'xK9#secret'];

async function overlayPill(page: Page) {
  return page.locator('waymark-overlay .pill');
}

test('10-action scenario yields exactly the expected steps, recorded from the side panel', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?seed=7`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async (url) => (await chrome.tabs.query({ url: url + '/*' }))[0]!.id!, site.main.replace(':' + site.port, ''));

  // Start recording from the real side panel UI.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('guide-title').fill('Update profile');
  await panel.getByTestId('record').click();
  await expect(panel.getByText('● Recording: Update profile')).toBeVisible();
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  expect(await (await ext.sw()).evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('REC');

  await app.bringToFront();
  // 1. in-app link (history routing): one click step, the route change belongs to it
  await app.getByRole('link', { name: 'Orders', exact: true }).click();
  // 2-3. click a field and type: one input step each, values never stored
  await app.locator('#first-name').click();
  await app.keyboard.type('Ada Lovelace');
  await app.locator('#email').click();
  await app.keyboard.type('ada@example.com');
  // 4. native select: click plus change
  await app.locator('#country').click();
  await app.keyboard.press('ArrowDown');
  await app.keyboard.press('Enter');
  // 5. checkbox through its label
  await app.getByText('Send me the newsletter').click();
  // 6. ARIA switch
  await app.getByRole('switch', { name: 'Dark mode' }).click();
  // 7-8. custom dropdown with options in a portal
  await app.getByRole('combobox', { name: 'Status' }).click();
  await app.getByRole('option', { name: 'Closed' }).click();
  // 9. keyboard activation (Enter on a button, no pointerdown)
  await app.getByRole('button', { name: 'Export', exact: true }).focus();
  await app.keyboard.press('Enter');
  // 10. submit button
  await app.getByRole('form', { name: 'Profile' }).getByRole('button', { name: 'Save' }).click();

  const expected = [
    'click: Click **Orders**',
    'input: Enter First name',
    'input: Enter Email',
    'select: Choose **Germany** in **Country**',
    'check: Check **Send me the newsletter**',
    'check: Check **Dark mode**',
    'click: Click **Status**',
    'select: Choose **Closed**',
    'click: Click **Export**',
    'submit: Submit the form',
  ];
  const sw = await ext.sw();
  const current = async () =>
    ((await sw.evaluate(async () => (await chrome.storage.session.get('recording')).recording)) as { steps: { kind: string; title: string }[] }).steps.map(
      (s) => `${s.kind}: ${s.title}`,
    );
  await expect.poll(current).toEqual(expected);

  // The on-page pill and the side panel follow along.
  await expect(await overlayPill(app)).toContainText('Submit the form');
  await expect(panel.getByTestId('steps').locator('li')).toHaveCount(10);

  // Stop saves the guide.
  await panel.bringToFront();
  await panel.getByTestId('stop').click();
  await expect(panel.getByTestId('saved')).toContainText('with 10 steps');
  await expect.poll(() => marker(app, 'recording')).toBe('off');
  expect(await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('');
  await expect(await overlayPill(app)).toHaveCount(0);

  const guide = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all).find(([k]) => k.startsWith('guide:'))?.[1] as { steps: { kind: string; title: string; url: unknown }[]; appOrigins: string[] };
  });
  expect(guide.steps.map((s) => `${s.kind}: ${s.title}`)).toEqual(expected);
  expect(guide.appOrigins).toEqual([site.main]);
  expect(guide.steps[1]!.url).toEqual({ kind: 'pattern', value: '/app/orders' });
});

test('no typed value is ever stored', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const sw = await ext.sw();
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  const panel = await ext.extensionPage();
  const reply = await panel.evaluate((id) => chrome.runtime.sendMessage({ type: 'rec.start', payload: { tabId: id, title: 'Typing' } }), tabId);
  expect(reply.ok).toBe(true);
  await expect.poll(() => marker(app, 'recording')).toBe('on');

  await app.bringToFront();
  await app.locator('#first-name').fill(''); // focus only
  await app.locator('#first-name').pressSequentially(TYPED[0]! + ' ' + TYPED[1]!);
  await app.locator('#email').pressSequentially(TYPED[2]!);
  await app.locator('textarea').pressSequentially(TYPED[3]!);
  await app.getByLabel('Teammate email', { exact: true }).evaluate(() => undefined).catch(() => undefined);
  await app.locator('#email').press('Enter'); // implicit submission

  const dump = async () => JSON.stringify([await sw.evaluate(() => chrome.storage.session.get(null)), await sw.evaluate(() => chrome.storage.local.get(null))]);
  await expect.poll(async () => (await dump()).includes('Enter Email')).toBe(true);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'rec.stop', payload: {} }));
  const everything = await dump();
  for (const v of TYPED) expect(everything).not.toContain(v);
  // what was recorded: which fields, not what was typed
  expect(everything).toContain('Enter First name');
  expect(everything).toContain('Submit the form');
});

test('a tab that is not recording records nothing', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  // The recorder only runs while the service worker says this tab is recording.
  await app.getByRole('button', { name: 'Import' }).click();
  const sw = await ext.sw();
  expect(await sw.evaluate(() => chrome.storage.session.get('recording'))).toEqual({});
});

async function startRecording(ext: import('./fixtures').ExtensionHelper, tabId: number, title: string) {
  const panel = await ext.extensionPage();
  const reply = await panel.evaluate(({ id, t }) => chrome.runtime.sendMessage({ type: 'rec.start', payload: { tabId: id, title: t } }), { id: tabId, t: title });
  expect(reply.ok).toBe(true);
  return panel;
}

async function recordedSteps(ext: import('./fixtures').ExtensionHelper) {
  const sw = await ext.sw();
  return ((await sw.evaluate(async () => (await chrome.storage.session.get('recording')).recording)) as {
    steps: { kind: string; title: string; url: { value: string }; target?: { framePath: string[] } }[];
    tabIds: number[];
  });
}

test('navigation: a route change not caused by an action becomes a navigate step; replace, query-only and click-caused ones do not', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  await startRecording(ext, tabId, 'Nav');
  await expect.poll(() => marker(app, 'recording')).toBe('on');

  await app.click('#push-route'); // click-caused pushState: belongs to the click
  await app.waitForTimeout(1700);
  await app.evaluate(() => history.replaceState({}, '', '/app/replaced')); // replace: ignored
  await app.evaluate(() => history.pushState({}, '', '/app/replaced?page=3')); // query-only: ignored
  await app.evaluate(() => history.pushState({}, '', '/app/customers/9')); // app-driven: navigate step
  await app.waitForTimeout(700);
  await app.goto(`${site.main}/app/orders/5?static`); // full page load: navigate step, recording continues
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import' }).click();

  await expect
    .poll(async () => (await recordedSteps(ext)).steps.map((s) => `${s.kind}: ${s.title} @${s.url.value}`))
    .toEqual([
      'click: Click **Push route** @/',
      'navigate: Go to Fixture app @/app/customers/:id',
      'navigate: Go to /app/orders/:id @/app/orders/:id',
      'click: Click **Import** @/app/orders/:id',
    ]);
});

test('a link that opens a new tab carries the recording there; iframe steps get a framePath and the page URL', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]!.id!, 'http://127.0.0.1/*');
  await startRecording(ext, tabId, 'Frames and tabs');
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.bringToFront();

  const same = app.frameLocator('iframe.frame-same');
  const cross = app.frameLocator('iframe.frame-cross');
  await same.getByRole('button', { name: 'Frame action' }).click();
  await cross.getByRole('button', { name: 'Frame action' }).click();
  await cross.frameLocator('iframe.frame-nested').getByRole('button', { name: 'Nested action' }).click();

  const [popup] = await Promise.all([context.waitForEvent('page'), app.click('#new-tab-link')]);
  await popup.waitForLoadState();
  await expect.poll(() => marker(popup, 'recording')).toBe('on');
  await popup.getByRole('button', { name: 'Export', exact: true }).click();

  await expect.poll(async () => (await recordedSteps(ext)).steps.length).toBe(5);
  const rec = await recordedSteps(ext);
  expect(rec.steps.map((s) => s.title)).toEqual([
    'Click **Frame action**',
    'Click **Frame action**',
    'Click **Nested action**',
    'Click **Open reports**',
    'Click **Export**',
  ]);
  expect(rec.steps[0]!.target!.framePath).toHaveLength(1);
  expect(rec.steps[0]!.target!.framePath[0]).toContain('frame-same');
  expect(rec.steps[1]!.target!.framePath[0]).toContain('frame-cross');
  expect(rec.steps[2]!.target!.framePath).toHaveLength(2);
  // frame steps belong to the top page
  expect(rec.steps[1]!.url.value).toBe('/');
  expect(rec.steps[4]!.url.value).toBe('/app/reports');
  expect(rec.tabIds).toHaveLength(2);
});
