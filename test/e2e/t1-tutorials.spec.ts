/**
 * Built-in tutorials on the Practice page (D128, D129): the panel lists them, Start opens the
 * practice page, which plays them with the real player, matcher and advance rules; voice reads
 * only the bundled text; tutorials never become guides unless copied; the section can be hidden.
 */
import { execFileSync } from 'node:child_process';
import { canGrant, expect, KEYS_SCRIPT, marker, test } from './fixtures';
import type { Page } from '@playwright/test';

const overlay = (p: Page, action: string) => p.locator(`waymark-overlay [data-action="${action}"]`);

test('the panel lists the tutorials; Start opens the practice page, which plays the tour with the real player', async ({ context, extensionId, sw, ext }) => {
  // CI machines have no voices: give the service worker one on-device voice and spy on tts.
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((text: string) => void log.push(`speak:${text}`)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => void log.push('stop')) as unknown as typeof chrome.tts.stop;
  });
  const spoken = () => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.filter((x) => x.startsWith('speak:')));

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByTestId('welcome-done').click();
  const list = panel.getByTestId('tutorials');
  await expect(list).toContainText('Built-in');
  await expect(list.locator('.tutorial-title')).toHaveText(['How Waymark works', 'Record your first guide', 'Edit a guide', 'Share a guide', 'What the warnings mean']);

  const [practice] = await Promise.all([context.waitForEvent('page'), panel.getByTestId('tutorial-start-tour').click()]);
  await practice.waitForLoadState();
  expect(practice.url()).toBe(`chrome-extension://${extensionId}/practice.html?tutorial=tour`);
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
  await expect(practice.locator('waymark-overlay .tip')).toContainText('Welcome to the tutorial page');
  await expect.poll(spoken).toContainEqual(expect.stringContaining('speak:Welcome to the tutorial page.'));

  // A note step: Next. A click step: the learner clicks the real button, and the guide moves on.
  await overlay(practice, 'next').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:1');
  await expect(practice.locator('waymark-overlay .tip')).toContainText('Click the highlighted item to continue.');
  await practice.getByRole('main').getByRole('button', { name: 'New invoice' }).click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:2');
  await practice.getByLabel('Customer name').fill('Ada');
  await overlay(practice, 'next').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:3');
  // Back, then forward again.
  await overlay(practice, 'back').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:2');
  await overlay(practice, 'next').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:3');
  await overlay(practice, 'next').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:4');
  await practice.getByRole('button', { name: 'Send invoice' }).click(); // a submit step
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:5');
  await overlay(practice, 'next').click(); // Done
  await expect.poll(() => marker(practice, 'practice')).toMatch(/^done/);
  await expect(practice.locator('waymark-overlay .tip')).toContainText('You finished “How Waymark works”');
  await overlay(practice, 'close').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('finished');
  await expect(practice.getByTestId('practice-tutorials')).toContainText('You finished');

  // The text typed in practice never reached the voice; tutorials never became guides.
  expect((await spoken()).join('\n')).not.toContain('Ada');
  expect((await ext.message<{ guides: unknown[] }>('guide.list', {})).guides).toEqual([]);
  // A tutorial is not a play of a guide: no step results are written (D211).
  expect(Object.keys(await (await ext.sw()).evaluate(() => chrome.storage.local.get(null))).filter((k) => k.startsWith('stats:'))).toEqual([]);
});

test('the warnings tutorial shows the real not-found card for a missing element; Skip goes on', async ({ context, extensionId }) => {
  const practice = await context.newPage();
  await practice.goto(`chrome-extension://${extensionId}/practice.html?tutorial=warnings`);
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
  // Step 1 spotlights the chart, a drawing area.
  await expect(practice.locator('waymark-overlay .tip')).toContainText('Drawing area');
  for (const i of [1, 2]) {
    await overlay(practice, 'next').click();
    await expect.poll(() => marker(practice, 'practice')).toBe(`drawn:${i}`);
  }
  await overlay(practice, 'next').click();
  await expect.poll(() => marker(practice, 'practice'), { timeout: 10_000 }).toBe('not-found:3');
  await overlay(practice, 'report').click();
  await expect(practice.locator('waymark-overlay .tip')).toContainText('Settings → Problems');
  await overlay(practice, 'skip').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:4');
  // Exit from the tooltip ends the tutorial.
  await overlay(practice, 'exit').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('exited');
  await expect(practice.locator('waymark-overlay .tip')).toHaveCount(0);
});

test('a page cannot make the voice read its own text; tutorial.speak takes ids only', async ({ ext }) => {
  await expect(ext.message('tutorial.speak', { tutorialId: 'tour', stepId: 'nope' })).resolves.toEqual({ ok: false });
  await expect(ext.message('tutorial.speak', { tutorialId: 'tour', stepId: 'tour-1', text: 'Say this' })).resolves.toBeDefined(); // extra keys are dropped by the schema
  await expect(ext.message('tutorial.speak', { tutorialId: 'Not An Id!', stepId: 'tour-1' })).rejects.toThrow(/invalid payload/);
});

test('Hide removes the section; Help shows it again', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByTestId('welcome-done').click();
  await panel.getByTestId('tutorials-hide').click();
  await expect(panel.getByTestId('tutorials')).toHaveCount(0);
  await panel.reload();
  await expect(panel.getByTestId('open-help')).toBeVisible();
  await expect(panel.getByTestId('tutorials')).toHaveCount(0);
  await panel.getByTestId('open-help').click();
  await panel.getByTestId('help-show-tutorials').click();
  await expect(panel.getByTestId('tutorials')).toBeVisible();
});

test.describe('copy to my guides', () => {
  test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

  test('on an allowed site, a tutorial is copied as note steps on that site; elsewhere it is not offered', async ({ context, ext, site, extensionId }) => {
    const app = await context.newPage();
    await app.goto(`${site.main}/?static`);
    const notAllowed = await context.newPage();
    // Without an allowed site there is nothing to copy onto.
    await notAllowed.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await notAllowed.getByTestId('welcome-done').click();
    await notAllowed.getByTestId('tutorial-more-record').click();
    await expect(notAllowed.getByTestId('tutorial-copy-record')).toHaveCount(0);
    await expect(notAllowed.getByTestId('tutorials')).toContainText('allow Waymark there');
    await notAllowed.close();

    await ext.grant('http://127.0.0.1/*');
    await app.reload();
    await app.bringToFront();
    const appTab = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${appTab}`);
    await panel.getByTestId('tutorial-more-record').click();
    await panel.getByTestId('tutorial-copy-record').click();
    await expect(panel.getByTestId('tutorials-message')).toContainText('Copied “Draft: Record your first guide”');
    await panel.getByTestId('tutorial-more-record').click();
    await expect(panel.getByTestId('tutorial-copy-record')).toBeDisabled(); // one copy, not one per press
    const guides = (await ext.message<{ guides: { id: string; title: string; appOrigins: string[] }[] }>('guide.list', {})).guides;
    expect(guides.map((g) => g.title)).toEqual(['Draft: Record your first guide']);
    expect(guides[0]!.appOrigins).toEqual([site.main]);
    const g = await ext.message<{ steps: { kind: string; target?: unknown }[]; source: string }>('guide.get', { id: guides[0]!.id });
    expect(g.source).toBe('local');
    expect(g.steps.every((s) => s.kind === 'note' && !s.target)).toBe(true);
  });
});

test('leaving the step’s view shows the off-track card; Go back returns to it', async ({ context, extensionId }) => {
  const practice = await context.newPage();
  await practice.goto(`chrome-extension://${extensionId}/practice.html?tutorial=record`);
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
  await overlay(practice, 'next').click();
  await overlay(practice, 'next').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:2'); // "click New invoice" on the dashboard
  await practice.getByRole('navigation').getByRole('button', { name: 'Invoices' }).click();
  await expect.poll(() => marker(practice, 'practice'), { timeout: 10_000 }).toBe('off-track:2');
  await overlay(practice, 'go-back').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:2');
  await practice.getByRole('main').getByRole('button', { name: 'New invoice' }).click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:3');
});

test('keyboard: Enter in a field never submits the practice form; focus follows the guide; Alt+. moves on', async ({ context, extensionId }) => {
  const practice = await context.newPage();
  await practice.goto(`chrome-extension://${extensionId}/practice.html`);
  await expect.poll(() => marker(practice, 'practice')).toBe('ready');
  // Start from the list with the keyboard: the first step's Next gets focus (the list is gone).
  await practice.getByTestId('practice-start-tour').focus();
  await practice.keyboard.press('Enter');
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
  await expect.poll(() => practice.evaluate(() => document.activeElement?.localName)).toBe('waymark-overlay');
  await practice.keyboard.press('Enter'); // Next, from the keyboard
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:1');
  // An action step: focus goes to the element to act on, so Enter does it.
  await expect.poll(() => practice.evaluate(() => document.activeElement?.getAttribute('data-guide-id'))).toBe('practice-new-invoice');
  await practice.keyboard.press('Enter');
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:2');
  await practice.getByLabel('Customer name').fill('Ada');
  await practice.getByLabel('Customer name').press('Enter'); // finishes the field, never sends the form
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:3');
  await expect(practice.getByRole('heading', { name: 'New invoice' })).toBeVisible();
  // The browser shortcut Alt+. works on this page too (real keys, as in q2).
  if (!canGrant) return; // real keys need X (xvfb-run)
  await practice.bringToFront();
  execFileSync('python3', [KEYS_SCRIPT, 'Alt_L+period']);
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:4');
});
