/**
 * M3 acceptance: play a recorded scenario across 3 pages, an in-app route change, an iframe and
 * a modal dialog; a run survives a service worker stopped through ServiceWorker.stopAllWorkers.
 */
import type { BrowserContext, Frame, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const TITLES = [
  'Click **Orders**',
  'Click **Billing page**',
  'Click **Delete order**',
  'Click **Confirm**',
  'Enter Comment',
  'Check the total before you continue',
  'Click **Continue**',
  'Click **Frame action**',
  'Check **I agree to the terms**',
  'Click **Finish**',
];

async function tabIdOf(ext: ExtensionHelper, pattern = 'http://127.0.0.1/*') {
  return (await ext.sw()).evaluate(async (p) => (await chrome.tabs.query({ url: p }))[0]!.id!, pattern);
}

async function msg<T>(ext: ExtensionHelper, type: string, payload: object): Promise<T> {
  const page = await ext.extensionPage();
  const r = await page.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload] as const);
  await page.close();
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

/** The actions of the scenario, used both to record and to play. */
const actions: ((app: Page) => Promise<void>)[] = [
  (app) => app.getByRole('link', { name: 'Orders', exact: true }).click(),
  (app) => app.getByRole('link', { name: 'Billing page' }).click(),
  (app) => app.getByRole('button', { name: 'Delete order' }).click(),
  (app) => app.getByRole('dialog', { name: 'Confirm delete' }).getByRole('button', { name: 'Confirm' }).click(),
  async (app) => {
    await app.getByLabel('Comment').click();
    await app.keyboard.type('Rush order');
    await app.keyboard.press('Tab');
  },
  async () => undefined, // note step: Next during playback
  (app) => app.getByRole('link', { name: 'Continue' }).click(),
  (app) => app.frameLocator('iframe.partner-frame').getByRole('button', { name: 'Frame action' }).click(),
  (app) => app.getByRole('form', { name: 'Agreement' }).getByText('I agree to the terms').click(),
  (app) => app.getByRole('button', { name: 'Finish' }).click(),
];

async function recordScenario(context: BrowserContext, ext: ExtensionHelper, site: { main: string }): Promise<string> {
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await msg(ext, 'rec.start', { tabId: await tabIdOf(ext), title: 'Delete an order' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  for (let i = 0; i < actions.length; i++) {
    if (i === 5) await msg(ext, 'rec.note', { title: 'Check the total before you continue' });
    else await actions[i]!(app);
    if (i === 1 || i === 6) await app.waitForLoadState();
    await expect.poll(() => marker(app, 'recording'), { message: `recording after action ${i}` }).toBe('on');
    await app.waitForTimeout(150);
  }
  const res = await msg<{ guideId: string; steps: { title: string }[] }>(ext, 'rec.stop', {});
  expect(res.steps.map((s) => s.title)).toEqual(TITLES);
  await app.close();
  return res.guideId;
}

const tooltip = (f: Page | Frame) => f.locator('waymark-overlay .tip');

/** Checks the spotlight ring surrounds the element the step is about. */
async function expectSpotlightOn(f: Page | Frame, target: import('@playwright/test').Locator) {
  // The target may be scrolled into view smoothly first; the ring follows it.
  await expect
    .poll(async () => {
      const ring = await f.locator('waymark-overlay .ring').boundingBox();
      const box = await target.boundingBox();
      if (!ring || !box) return 'missing';
      const off = Math.max(Math.abs(ring.x + 6 - box.x), Math.abs(ring.y + 6 - box.y), Math.abs(ring.width - 12 - box.width), Math.abs(ring.height - 12 - box.height));
      return off <= 2 ? 'aligned' : `off by ${off}`;
    })
    .toBe('aligned');
}

test('plays the scenario across 3 pages, an in-app route change, an iframe and a modal dialog', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const guideId = await recordScenario(context, ext, site);

  // The learner starts on another page: the panel offers to open the start page.
  const app = await context.newPage();
  await app.goto(`${site.main}/page2.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await tabIdOf(ext);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`start-${guideId}`).click();
  await panel.getByTestId('open-start').click();
  await app.bringToFront();
  await app.waitForURL(`${site.main}/?static`);

  const targets = [
    () => app.getByRole('link', { name: 'Orders', exact: true }),
    () => app.getByRole('link', { name: 'Billing page' }),
    () => app.getByRole('button', { name: 'Delete order' }),
    () => app.getByRole('dialog', { name: 'Confirm delete' }).getByRole('button', { name: 'Confirm' }),
    () => app.getByLabel('Comment'),
  ];

  for (let i = 0; i < TITLES.length; i++) {
    const inFrame = i === 7;
    if (inFrame) await expect.poll(() => app.frames().some((f) => f.url().includes('name=partner'))).toBe(true);
    const frame = inFrame ? app.frames().find((f) => f.url().includes('name=partner'))! : app;
    await expect.poll(() => marker(frame, 'player'), { message: `step ${i + 1} drawn`, timeout: 10_000 }).toBe(i === 5 ? `note:${i}` : `drawn:${i}`);
    await expect(tooltip(frame)).toContainText(`Step ${i + 1} of 10`);
    await expect(tooltip(frame).locator('.title')).toHaveText(TITLES[i]!.replace(/\*\*/g, ''));
    if (i < targets.length) await expectSpotlightOn(frame, targets[i]!());
    if (i === 3) {
      // inside an open modal dialog the overlay mounts in the dialog (else it would be inert)
      expect(await app.evaluate(() => document.querySelector('waymark-overlay')?.parentElement?.localName)).toBe('dialog');
    }
    if (i === 5) await tooltip(app).locator('[data-action="next"]').click();
    else await actions[i]!(app);
  }
  await expect.poll(() => marker(app, 'player')).toBe('done');
  await expect(tooltip(app)).toContainText('Done!');
  const completions = (await (await ext.sw()).evaluate(async () => (await chrome.storage.local.get('completions')).completions)) as Record<string, string[]>;
  expect(Object.keys(completions)).toEqual([guideId]);
  await tooltip(app).locator('[data-action="close"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('off');
});

test('a run survives a service worker stopped through ServiceWorker.stopAllWorkers', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const guideId = await recordScenario(context, ext, site);
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await tabIdOf(ext);
  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');

  // Watch the extension's worker through the DevTools protocol (Playwright's worker list goes stale).
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const cdp = await context.newCDPSession(page);
  const statuses: string[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e: { versions: { runningStatus: string; scriptURL: string }[] }) => {
    for (const v of e.versions) if (v.scriptURL.endsWith('/background.js')) statuses.push(v.runningStatus);
  });
  await cdp.send('ServiceWorker.enable');
  const stopWorkers = async () => {
    statuses.length = 0;
    await cdp.send('ServiceWorker.stopAllWorkers');
    await expect.poll(() => statuses, { message: 'service worker stopped' }).toContain('stopped');
  };

  await stopWorkers();
  await app.bringToFront();
  await actions[0]!(app); // advancing wakes the worker, which reads the run back from storage
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  expect(statuses).toContain('running'); // it really was restarted

  await stopWorkers();
  await actions[1]!(app); // a full page load while the worker is stopped
  await app.waitForURL(/page2/);
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:2');
  await expect(tooltip(app)).toContainText('Step 3 of 10');
  expect(statuses).toContain('running');
});

test('not found within 8 seconds shows Retry, Skip, Exit and Report broken step; Report saves a problem', async ({ context, ext, site }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const guideId = await recordScenario(context, ext, site);
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  // The app changed: the main navigation (with the first step's link) is gone.
  await app.evaluate(() => document.querySelector('nav[aria-label="Main"]')?.remove());
  await msg(ext, 'run.start', { tabId: await tabIdOf(ext), guideId });
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('not-found:0');
  const card = tooltip(app);
  for (const a of ['retry', 'skip', 'exit', 'report']) await expect(card.locator(`[data-action="${a}"]`)).toBeVisible();
  await card.locator('[data-action="report"]').click();
  await expect(card).toContainText('Problems list');
  const problems = await msg<{ problems: { stepTitle: string; url: string }[] }>(ext, 'problems.list', {});
  expect(problems.problems).toEqual([expect.objectContaining({ stepTitle: 'Click **Orders**', url: expect.stringContaining('/?static') })]);
  await card.locator('[data-action="skip"]').click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toMatch(/:(1)$/);
});

test('off track: on another page the learner sees Go back, Skip and Exit', async ({ context, ext, site }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const guideId = await recordScenario(context, ext, site);
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await msg(ext, 'run.start', { tabId: await tabIdOf(ext), guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await app.goto(`${site.main}/page3.html`); // wander off
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('off-track:0');
  for (const a of ['go-back', 'skip', 'exit']) await expect(tooltip(app).locator(`[data-action="${a}"]`)).toBeVisible();
  await tooltip(app).locator('[data-action="go-back"]').click();
  await app.waitForURL(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:0');
});

test('a link that opens a new tab carries the run there and pauses the old tab', async ({ context, ext, site }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  // A two-step guide: click "Open reports" (opens a new tab), then click Export there.
  const app = await context.newPage();
  await app.goto(`${site.main}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await tabIdOf(ext);
  await msg(ext, 'rec.start', { tabId, title: 'Reports' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  const [rec] = await Promise.all([context.waitForEvent('page'), app.click('#new-tab-link')]);
  await expect.poll(() => marker(rec, 'recording')).toBe('on');
  await rec.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(async () => (await msg<{ steps: unknown[] } | null>(ext, 'rec.state', {}))?.steps.length).toBe(2);
  const { guideId } = await msg<{ guideId: string }>(ext, 'rec.stop', {});
  await rec.close();

  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  const [popup] = await Promise.all([context.waitForEvent('page'), app.click('#new-tab-link')]);
  await expect.poll(() => marker(popup, 'player'), { timeout: 10_000 }).toBe('drawn:1');
  await expect.poll(() => marker(app, 'player')).toBe('paused');
  await popup.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => marker(popup, 'player')).toBe('done');
});
