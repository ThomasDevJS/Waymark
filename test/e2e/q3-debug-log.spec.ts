/**
 * Debug log (issue #33, D110–D112) end to end on the fixture app:
 * - off by default: recording and playing store nothing;
 * - the Settings switch reaches open pages at once;
 * - on: the recorder, matcher, frame board, advance rules and run are logged, without typed values,
 *   queries or fragments; Copy debug log and the not-found card's Copy log; off stops collecting;
 *   Clear empties it.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const TYPED = 'Zebediah-typed-value';

function msg<T>(ext: ExtensionHelper, type: string, payload: object): Promise<T> {
  return ext.message<T>(type, payload);
}

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

async function storedLog(ext: ExtensionHelper): Promise<unknown> {
  return (await ext.sw()).evaluate(async () => (await chrome.storage.session.get('debugLog')).debugLog);
}

/** Import, type into First name, Export. */
async function record(ext: ExtensionHelper, app: Page, tabId: number, title: string) {
  await msg(ext, 'rec.start', { tabId, title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(150);
  await app.getByLabel('First name').click();
  await app.keyboard.type(TYPED);
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(150);
  const res = await msg<{ guideId: string; steps: { title: string }[] }>(ext, 'rec.stop', {});
  expect(res.steps.map((s) => s.title)).toEqual(['Click **Import**', 'Enter First name', 'Click **Export**']);
  return res.guideId;
}

/** Plays the first two steps; with `breakLast`, the third step's button is gone. */
async function play(ext: ExtensionHelper, app: Page, tabId: number, guideId: string, breakLast: boolean) {
  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:0');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:1');
  if (breakLast) await app.evaluate(() => document.querySelector('[data-fx="tb-export"]')?.remove());
  await app.getByLabel('First name').fill('x');
  await app.keyboard.press('Tab');
  if (!breakLast) await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('drawn:2');
}

test('off: nothing is collected; on: decisions are logged and copied without typed values, queries or fragments; Clear', async ({ context, ext, site, extensionId }) => {
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static&token=s3cret#frag-secret`);
  const tabId = await tabIdFor(ext, app);

  // Off (the default): record and play; nothing is stored, and the page was never told it is on.
  const first = await record(ext, app, tabId, 'Debug off');
  await play(ext, app, tabId, first, false);
  await msg(ext, 'run.stop', { tabId });
  await app.waitForTimeout(700); // longer than both batching delays
  expect(await storedLog(ext)).toBeUndefined();
  expect(await marker(app, 'debug')).toBeNull();
  expect(await msg(ext, 'debug.get', {})).toEqual({ on: false, since: null, count: 0 });

  // On, from Settings: the open page learns at once.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByTestId('debug-count')).toHaveText('Off. Nothing is being logged.');
  await expect(options.getByTestId('debug-copy')).toBeDisabled();
  await options.getByTestId('debug-switch').check();
  await expect.poll(() => marker(app, 'debug')).toBe('on');
  // A page loaded now learns it from its first route report's reply.
  await app.reload();
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await expect.poll(() => marker(app, 'debug')).toBe('on');

  const second = await record(ext, app, tabId, 'Debug on');
  await play(ext, app, tabId, second, true);
  await expect.poll(() => marker(app, 'player'), { timeout: 15_000 }).toBe('not-found:2');

  // The not-found card's Copy log: this tab since the guide started, no settings.
  await app.locator('waymark-overlay [data-action="copy-log"]').click();
  await expect.poll(() => marker(app, 'debug-copy')).toMatch(/^(copied|blocked)$/);
  const cardText = (await marker(app, 'debug-copy-text'))!;
  expect(cardText).toMatch(/^Waymark debug log\nVersion: \d+\.\d+\.\d+\nBrowser: /);
  expect(cardText).toMatch(/ match not-found .*reason=[a-z-]+/);
  expect(cardText).not.toMatch(/Voice:|Team library|Debug log: on/);
  expect(cardText).not.toContain('Debug off'); // the earlier recording is not part of this run
  await expect(app.locator('waymark-overlay .flash')).toContainText(/Debug log copied|Couldn’t copy here/);

  // Settings → Copy debug log: everything, with the header.
  await options.bringToFront();
  await expect(options.getByTestId('debug-count')).toContainText(/\d+ entries/);
  await options.getByTestId('debug-copy').click();
  await expect(options.getByTestId('debug-copy')).toContainText(/Copied|Copy debug log/);
  const { text } = await msg<{ text: string }>(ext, 'debug.text', {});
  expect(text).toMatch(/^Waymark debug log\nVersion: \d+\.\d+\.\d+\nBrowser: .+\nDebug log: on since \d{4}-/);
  expect(text).toMatch(/\nVoice: read aloud on, muted off/);
  expect(text).toMatch(/\nRuns: tab \d+: step 3 of 3 \(click\), running/);
  for (const line of [
    / rec +target tag=button/, // the recorder's resolved target
    / rec +field\.held /, // a click into a field waits for typing
    / rec +emit op=add kind=input title="Enter First name"/,
    / rec +step\.added .*title="Click Import"/, // the service worker accepted it (inside the queue)
    / match search step=1 kind=click signals=/,
    / match found step=1 score=\d+ margin=\d+ matched=/,
    / frame frame\.report step=1 found=true .*winnerFrame=0/,
    / play +advance\.watch kind=click targets=1 listeners=pointerdown@document,click@document/,
    / play +advance kind=click why="a click on the target"/,
    / run +step op=done from=1 step=2 of=3 kind=input/,
    / play +card\.not-found step=3/,
    / page +page\.load via=load url=http:\/\/127\.0\.0\.1:\d+\/app\/orders /,
    / voice /,
  ])
    expect(text).toMatch(line);
  // Privacy: no typed value, no query or fragment anywhere.
  for (const secret of [TYPED, 's3cret', 'frag-secret', 'token=']) expect(text).not.toContain(secret);
  expect(cardText).not.toContain(TYPED);
  // Newest last.
  const times = text.split('---\n')[1]!.trim().split('\n').map((l) => l.slice(0, 12));
  expect([...times].sort()).toEqual(times);

  // Off: nothing more is collected.
  await options.getByTestId('debug-switch').uncheck();
  await expect.poll(() => marker(app, 'debug')).toBe('off');
  await msg(ext, 'run.stop', { tabId });
  const before = (await msg<{ count: number }>(ext, 'debug.get', {})).count;
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.reload();
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await app.waitForTimeout(700);
  expect((await msg<{ count: number }>(ext, 'debug.get', {})).count).toBe(before);

  // Clear empties it.
  await options.reload();
  await options.getByTestId('debug-clear').click();
  await expect(options.getByTestId('debug-count')).toHaveText('Off. Nothing is being logged.');
  expect((await msg<{ count: number }>(ext, 'debug.get', {})).count).toBe(0);
});
