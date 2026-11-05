/**
 * #32: a step three frames deep, on a clickable card <div> in a frame that renders late.
 * The voice waits for the element, a click on the highlighted card advances, and the card is
 * recorded as the control (no low-confidence flag).
 */
import type { Frame, Page } from '@playwright/test';
import { canGrant, expect, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const activity = (p: Page): Frame | undefined => p.frames().find((f) => f.url().includes('/nested/activity.html'));

async function ttsSpy(ext: ExtensionHelper) {
  const sw = await ext.sw();
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((text: string) => void log.push(`speak:${text}`)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => undefined) as unknown as typeof chrome.tts.stop;
  });
  return () => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.slice());
}

test('a late, 3-deep nested frame: voice waits for the element; a click on the card advances; no low-confidence flag', async ({ context, ext, site }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/nested/index.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);

  // Record: Safety (top nav) → Unsafe Driving (card in the nested frame) → 24 Months.
  await ext.message('rec.start', { tabId, title: 'Nested' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.bringToFront();
  await app.getByRole('link', { name: 'Safety' }).click();
  await expect.poll(async () => (activity(app) ? marker(activity(app)!, 'activity') : null), { timeout: 10_000 }).toBe('ready');
  await expect.poll(async () => marker(activity(app)!, 'recording')).toBe('on');
  await activity(app)!.locator('.cards .title', { hasText: 'Unsafe Driving' }).click();
  await activity(app)!.locator('.detail.open').getByRole('button', { name: '24 Months' }).click();
  await app.waitForTimeout(300);
  const rec = await ext.message<{ guideId: string; steps: { title: string; flags?: string[]; target?: { tag: string; id?: string } }[] }>('rec.stop', {});
  expect(rec.steps.map((s) => s.title)).toEqual(['Click **Safety**', 'Click **Unsafe Driving**', 'Click **24 Months**']);
  // The card is the control: recorded as the card, not as its title, and not flagged.
  expect(rec.steps[1]!.flags ?? []).not.toContain('low-confidence');
  expect(rec.steps[1]!.target?.id).toBe('unsafe_driving-basic-cat-info-toggle');

  // Play from the start page; the nested frame renders 1.5 s after it loads, and the card's
  // count has changed since recording (live data must not break the step).
  await app.evaluate(() => sessionStorage.setItem('count', '7'));
  await app.goto(`${site.main}/nested/index.html`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const log = await ttsSpy(ext);
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await app.getByRole('link', { name: 'Safety' }).click();

  // Step 2 is not read while its frame is still loading; it is read once it is drawn.
  // The step has changed (the top frame no longer draws step 1) but the frame has not rendered yet.
  await expect.poll(async () => (activity(app) ? activity(app)!.evaluate(() => !!document.getElementById('loading')) : false), { timeout: 10_000 }).toBe(true);
  await app.waitForTimeout(700);
  expect(await activity(app)!.evaluate(() => !!document.getElementById('loading'))).toBe(true);
  expect((await log()).filter((x) => x.includes('Unsafe Driving'))).toEqual([]);
  await expect.poll(async () => (activity(app) ? marker(activity(app)!, 'player') : null), { timeout: 15_000 }).toBe('drawn:1');
  await expect.poll(async () => (await log()).filter((x) => x.includes('Unsafe Driving')).length).toBe(1);
  expect(await activity(app)!.locator('.cards .count').first().textContent()).toBe('7');

  // A click anywhere on the highlighted card advances: here on its count, not its title (#32).
  await activity(app)!.locator('#unsafe_driving-basic-cat-info-toggle .count').click();
  await expect.poll(async () => marker(activity(app)!, 'player'), { timeout: 10_000 }).toBe('drawn:2');
  await activity(app)!.locator('.detail.open').getByRole('button', { name: '24 Months' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('done');
});

test('a screen reopened in new frames: the old frame that is going away never blocks the new one (debug log of #32)', async ({ context, ext, site }) => {
  test.setTimeout(120_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  const url = `${site.main}/nested/index.html?swap=600`;
  await app.goto(url);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);

  await ext.message('rec.start', { tabId, title: 'Reopen' });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.bringToFront();
  await app.getByRole('link', { name: 'Safety' }).click();
  await expect.poll(async () => (activity(app) ? marker(activity(app)!, 'activity') : null), { timeout: 10_000 }).toBe('ready');
  await expect.poll(async () => marker(activity(app)!, 'recording')).toBe('on');
  await activity(app)!.locator('.cards .title', { hasText: 'Unsafe Driving' }).click();
  await app.waitForTimeout(300);
  const rec = await ext.message<{ guideId: string; steps: { title: string }[] }>('rec.stop', {});
  expect(rec.steps.map((s) => s.title)).toEqual(['Click **Safety**', 'Click **Unsafe Driving**']);

  // The Safety screen is still open when the run starts: the old frames find the card at once,
  // then the app swaps in new frames that find it again. The new frame must win and draw.
  await expect.poll(async () => (activity(app) ? marker(activity(app)!, 'activity') : null)).toBe('ready');
  await ext.message('run.start', { tabId, guideId: rec.guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  const oldFrame = activity(app)!;
  await app.getByRole('link', { name: 'Safety' }).click();
  await expect.poll(async () => (activity(app) && activity(app) !== oldFrame ? marker(activity(app)!, 'player') : null), { timeout: 15_000 }).toBe('drawn:1');
  await activity(app)!.locator('#unsafe_driving-basic-cat-info-toggle .count').click();
  await expect.poll(() => marker(app, 'player')).toBe('done');
});
