/**
 * M4 acceptance: an author can fix a wrong match by re-picking; a spy shows chrome.tts.speak
 * gets the stored voiceText once per step, and stop on step change and Exit.
 */
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { canGrant, expect, KEYS_SCRIPT, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

/**
 * Sends a message from an extension page in a separate popup window, so the app tab stays the
 * active tab of the last-focused normal window (as with the side panel).
 */
async function msg<T>(ext: ExtensionHelper, type: string, payload: object): Promise<T> {
  const sw = await ext.sw();
  const [page] = await Promise.all([
    ext.context.waitForEvent('page'),
    sw.evaluate((url) => chrome.windows.create({ url, type: 'popup', focused: false }), `chrome-extension://${ext.extensionId}/sidepanel.html`),
  ]);
  await page.waitForLoadState();
  const r = await page.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload] as const);
  await page.close();
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

async function setup(context: import('@playwright/test').BrowserContext, ext: ExtensionHelper, site: { main: string }) {
  await ext.grant('http://127.0.0.1/*');
  const app = await context.newPage();
  await app.goto(`${site.main}/?static&seed=3`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  const tabId = await (await ext.sw()).evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  return { app, tabId };
}

async function record(ext: ExtensionHelper, app: Page, tabId: number, title: string, actions: ((p: Page) => Promise<void>)[]) {
  await msg(ext, 'rec.start', { tabId, title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  for (const a of actions) {
    await a(app);
    await app.waitForTimeout(150);
  }
  return msg<{ guideId: string; steps: { title: string }[] }>(ext, 'rec.stop', {});
}

const tooltip = (p: Page) => p.locator('waymark-overlay .tip');

test('an author fixes a wrong match by re-picking, and the fixed guide plays on the right element', async ({ context, ext, site, extensionId }) => {
  const { app, tabId } = await setup(context, ext, site);
  // The author meant "CSV" but clicked "Export".
  const { guideId } = await record(ext, app, tabId, 'Export as CSV', [(p) => p.getByRole('button', { name: 'Export', exact: true }).click()]);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${guideId}`).click();
  await expect(panel.getByTestId('step-0-title')).toHaveValue('Click **Export**');

  // Test step highlights the (wrong) element on the page.
  await panel.getByTestId('step-0-test').click();
  await expect(panel.getByTestId('step-0-test-result')).toContainText('Found');
  await expect.poll(() => marker(app, 'tested')).toBe('found');

  // Re-pick: the click on the page selects the element and does not reach the app.
  await panel.getByTestId('step-0-repick').click();
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await app.bringToFront();
  let appSawClick = false;
  await app.exposeFunction('__appClicked', () => (appSawClick = true));
  await app.evaluate(() => document.getElementById('app-root')?.addEventListener('click', () => (window as unknown as { __appClicked(): void }).__appClicked()));
  // A target Waymark could never find again is refused, and picking goes on (issue #6).
  await app.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'You have 3 overdue invoices this month. This sentence is plain text, not a button.';
    document.getElementById('app-root')?.prepend(p);
  });
  await app.getByText('You have 3 overdue invoices this month.').click();
  await expect.poll(() => marker(app, 'pick-rejected')).toBe('p');
  expect(await marker(app, 'picking')).toBe('on');
  await expect(app.locator('waymark-overlay .pick-banner')).toContainText('could not find that again');
  await app.getByRole('button', { name: 'CSV' }).click();
  await expect.poll(() => marker(app, 'picking')).toBe('off');
  expect(appSawClick).toBe(false);

  await panel.bringToFront();
  await panel.getByTestId('step-0-use-title').click();
  await expect(panel.getByTestId('step-0-title')).toHaveValue('Click **CSV**');
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toHaveText('Saved (version 2).');
  const saved = await msg<{ version: number; steps: { target: { text?: string } }[] }>(ext, 'guide.get', { id: guideId });
  expect(saved.version).toBe(2);
  expect(saved.steps[0]!.target.text).toBe('CSV');

  // Played, the guide now spotlights CSV, and clicking CSV finishes it.
  await msg(ext, 'run.start', { tabId, guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await expect(app.locator('waymark-overlay .ring')).toHaveCount(1); // the Test step highlight gave way
  const ring = await app.locator('waymark-overlay .ring').boundingBox();
  const csv = await app.getByRole('button', { name: 'CSV' }).boundingBox();
  expect(Math.abs(ring!.x + 6 - csv!.x)).toBeLessThanOrEqual(2);
  await app.getByRole('button', { name: 'CSV' }).click();
  await expect.poll(() => marker(app, 'player')).toBe('done');
});

test('chrome.tts.speak gets the stored voiceText once per step, and stop on step change and Exit', async ({ context, ext, site }) => {
  const { app, tabId } = await setup(context, ext, site);
  const { guideId } = await record(ext, app, tabId, 'Voice', [
    (p) => p.getByRole('button', { name: 'Import', exact: true }).click(),
    (p) => p.getByRole('button', { name: 'Export', exact: true }).click(),
    (p) => p.getByRole('button', { name: 'CSV' }).click(),
  ]);
  // Store voice text on the first two steps (the third reads its title).
  const guide = await msg<{ revisionId: string; steps: { voiceText?: string }[] }>(ext, 'guide.get', { id: guideId });
  guide.steps[0]!.voiceText = 'First, import your orders.';
  guide.steps[1]!.voiceText = 'Then export them.';
  await msg(ext, 'guide.save', { guide, baseRevisionId: (guide as unknown as { revisionId: string }).revisionId });

  // CI machines have no voices: give the service worker one on-device voice and spy on tts.
  const sw = await ext.sw();
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((text: string) => void log.push(`speak:${text}`)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => void log.push('stop')) as unknown as typeof chrome.tts.stop;
  });
  const log = () => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.slice());

  await app.bringToFront();
  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await expect.poll(log).toEqual(['stop', 'speak:First, import your orders.']);
  // Match reports and re-broadcasts do not speak again.
  await app.waitForTimeout(800);
  expect((await log()).filter((x) => x.startsWith('speak')).length).toBe(1);

  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  await expect.poll(log).toEqual(['stop', 'speak:First, import your orders.', 'stop', 'speak:Then export them.']);

  // Mute stops speech and the next step stays silent.
  await tooltip(app).locator('[data-action="mute"]').click();
  await expect.poll(async () => (await log()).length).toBe(5);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:2');
  await app.waitForTimeout(300);
  expect((await log()).slice(4)).toEqual(['stop', 'stop']);
  await expect(tooltip(app).locator('[data-action="mute"]')).toHaveAttribute('aria-pressed', 'true');

  // Exit stops speech.
  await tooltip(app).locator('[data-action="exit"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('off');
  await expect.poll(async () => (await log()).at(-1)).toBe('stop');
  const speaks = (await log()).filter((x) => x.startsWith('speak'));
  expect(speaks).toEqual(['speak:First, import your orders.', 'speak:Then export them.']);
});

test('editing: titles, notes, voice text, reorder, delete, a new note step and optional steps; Save bumps the version', async ({ context, ext, site, extensionId }) => {
  const { app, tabId } = await setup(context, ext, site);
  const { guideId } = await record(ext, app, tabId, 'Edit me', [
    (p) => p.getByRole('button', { name: 'Import', exact: true }).click(),
    (p) => p.getByRole('button', { name: 'Export', exact: true }).click(),
    (p) => p.getByRole('button', { name: 'CSV' }).click(),
  ]);
  const before = await msg<{ revisionId: string }>(ext, 'guide.get', { id: guideId });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${guideId}`).click();
  await panel.getByTestId('step-0-title').fill('Import the **orders** file');
  await panel.getByTestId('step-0-note').fill('Use the *latest* export.');
  await panel.getByTestId('step-2-delete').click(); // drop CSV
  await panel.getByTestId('step-0-add-note').click(); // note after step 1
  await panel.getByTestId('step-1-title').fill('Check the file name');
  // reorder: move Export up above the note, then back down (exercises both buttons)
  await panel.getByTestId('step-2').getByRole('button', { name: 'Move up' }).click();
  await panel.getByTestId('step-1').getByRole('button', { name: 'Move down' }).click();
  await panel.getByTestId('step-1-optional').check();
  await panel.getByTestId('save-guide').click();
  await expect(panel.getByTestId('editor-status')).toHaveText('Saved (version 2).');

  const g = await msg<{ version: number; revisionId: string; steps: { kind: string; title: string; note?: string; optional?: boolean }[] }>(ext, 'guide.get', { id: guideId });
  expect(g.version).toBe(2);
  expect(g.revisionId).not.toBe(before.revisionId);
  expect(g.steps.map((s) => `${s.kind}: ${s.title}${s.optional ? ' (optional)' : ''}`)).toEqual([
    'click: Import the **orders** file',
    'note: Check the file name (optional)',
    'click: Click **Export**',
  ]);
  expect(g.steps[0]!.note).toBe('Use the *latest* export.');

  // Played: the note step shows Next and Skip (optional).
  await msg(ext, 'run.start', { tabId, guideId });
  await app.bringToFront();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await expect(tooltip(app).locator('.note')).toHaveText('Use the latest export.');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player')).toBe('note:1');
  await expect(tooltip(app).locator('[data-action="skip"]')).toBeVisible();
  await tooltip(app).locator('[data-action="next"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:2');
});


async function spyTts(ext: ExtensionHelper) {
  const sw = await ext.sw();
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((text: string) => void log.push(`speak:${text}`)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => void log.push('stop')) as unknown as typeof chrome.tts.stop;
  });
  return () => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.slice());
}

test('review fixes: Open start page reads step 1 once it arrives; closing the tab stops speech', async ({ context, ext, site }) => {
  const { app, tabId } = await setup(context, ext, site);
  const { guideId } = await record(ext, app, tabId, 'Start page voice', [(p) => p.getByRole('button', { name: 'Import', exact: true }).click()]);
  const log = await spyTts(ext);
  await app.goto(`${site.main}/page3.html`); // not the start page
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await app.bringToFront();
  const r = await msg<{ status: string }>(ext, 'run.start', { tabId, guideId });
  expect(r.status).toBe('needs-start');
  await msg(ext, 'run.start', { tabId, guideId, openStart: true });
  await expect.poll(() => marker(app, 'player'), { timeout: 10_000 }).toBe('drawn:0');
  await expect.poll(async () => (await log()).filter((x) => x.startsWith('speak'))).toEqual(['speak:Click Import']);
  const before = (await log()).length;
  await app.close();
  await expect.poll(async () => (await log()).slice(before)).toContain('stop');
});

test('review fixes: Esc ends a pick everywhere; Test step refuses another site; Save refuses a stale copy', async ({ context, ext, site, extensionId }) => {
  const { app, tabId } = await setup(context, ext, site);
  const { guideId } = await record(ext, app, tabId, 'Pick', [(p) => p.getByRole('button', { name: 'Export', exact: true }).click()]);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${guideId}`).click();
  await panel.getByTestId('step-0-repick').click();
  await expect.poll(() => marker(app, 'picking')).toBe('on');
  await app.bringToFront();
  await app.keyboard.press('Escape');
  await expect.poll(() => marker(app, 'picking')).toBe('off');
  await expect(panel.getByTestId('step-0-repick')).toHaveText('Re-pick element'); // the panel stopped waiting
  // A click after Esc reaches the app and changes nothing in the step.
  await app.getByRole('button', { name: 'CSV' }).click();
  await expect(panel.getByTestId('step-0-title')).toHaveValue('Click **Export**');

  // Saving from a stale copy is refused.
  const g = await msg<{ revisionId: string; title: string }>(ext, 'guide.get', { id: guideId });
  await msg(ext, 'guide.save', { guide: { ...g, title: 'Newer' }, baseRevisionId: g.revisionId });
  await expect(msg(ext, 'guide.save', { guide: { ...g, title: 'Older' }, baseRevisionId: g.revisionId })).rejects.toThrow(/changed elsewhere/);

  // Test step on a page of another site is refused (steps only go to their own origin).
  await ext.grant('http://localhost/*');
  await app.goto(`${site.other}/?static`);
  await expect.poll(() => marker(app, 'loaded')).toBe('yes');
  await panel.bringToFront();
  await panel.getByTestId('step-0-test').click();
  await expect(panel.getByRole('alert')).toContainText("Open a page of this guide's site");
  expect(await marker(app, 'tested')).toBeNull();
});

test('review fixes: a Test step during a live run hands the overlay back to the player', async ({ context, ext, site, extensionId }) => {
  const { app, tabId } = await setup(context, ext, site);
  const { guideId } = await record(ext, app, tabId, 'Live', [(p) => p.getByRole('button', { name: 'Export', exact: true }).click()]);
  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId(`edit-${guideId}`).click();
  await panel.getByTestId('step-0-test').click();
  await expect.poll(() => marker(app, 'tested')).toBe('found');
  const tip = app.locator('waymark-overlay .tip');
  await expect(tip).toHaveAttribute('aria-label', 'Waymark guide: Test step');
  await expect(tip).toHaveCount(1); // the highlight replaced the player's tooltip for now
  // After the 4 s highlight the learner's tooltip is back.
  await expect(tip).toHaveAttribute('aria-label', 'Waymark guide: Live', { timeout: 8000 });
  await expect(tip).toContainText('Step 1 of 1');
});

test('Settings shows the best-ranked voice in use; Edge natural online voices lead once allowed', async ({ context, ext, extensionId }) => {
  const sw = await ext.sw();
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) =>
      cb([
        { voiceName: 'Microsoft David - English (United States)', lang: 'en-US', remote: false },
        { voiceName: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', remote: true },
        { voiceName: 'Ava (Premium)', lang: 'en-US', remote: false },
      ])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((_t: string, o: chrome.tts.TtsOptions) => void log.push(`speak:${o.voiceName}`)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => undefined) as unknown as typeof chrome.tts.stop;
  });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByTestId('voice-in-use')).toContainText('Ava (Premium)');
  await expect(options.getByTestId('voice-in-use')).toContainText('(on this device)');
  await expect(options.getByTestId('better-voices')).toContainText('Linux'); // the CI runner's OS
  await options.getByTestId('test-voice').click();
  await expect.poll(() => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.slice())).toEqual(['speak:Ava (Premium)']);

  await options.getByTestId('online').check();
  await expect(options.getByTestId('voice-in-use')).toContainText('Microsoft Aria Online (Natural)');
  await expect(options.getByTestId('voice-in-use')).toContainText('(online)');
  // The user's own choice wins over the ranking.
  await options.getByTestId('voice').selectOption('Microsoft David - English (United States)');
  await expect(options.getByTestId('voice-in-use')).toContainText('Microsoft David');
  await expect(options.getByTestId('voice-in-use')).toContainText('a basic voice');
  // Turning online voices off again: the saved online choice is not usable, so the picker shows Automatic.
  await options.getByTestId('voice').selectOption('Microsoft Aria Online (Natural) - English (United States)');
  await options.getByTestId('online').uncheck();
  await expect(options.getByTestId('voice-in-use')).toContainText('Ava (Premium)');
  await expect(options.getByTestId('voice')).toHaveValue('');
});

test('HD voice (stub engine): opt-in downloads, steps play in HD, a failure falls back to the system voice, Remove frees it', async ({ context, ext, site, extensionId }) => {
  const sw = await ext.sw();
  // CI must not download the model: the test build's stub engine stands in for Kokoro.
  await sw.evaluate(() => chrome.storage.local.set({ 'test:hdStub': true }));
  const { app, tabId } = await setup(context, ext, site);
  const { guideId } = await record(ext, app, tabId, 'HD voice', [
    (p) => p.getByRole('button', { name: 'Import', exact: true }).click(),
    (p) => p.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const guide = await msg<{ revisionId: string; steps: { voiceText?: string }[] }>(ext, 'guide.get', { id: guideId });
  guide.steps[0]!.voiceText = 'Import your orders.';
  guide.steps[1]!.voiceText = 'Export them. STUB-FAIL';
  await msg(ext, 'guide.save', { guide, baseRevisionId: guide.revisionId });
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((text: string) => void log.push(text)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => undefined) as unknown as typeof chrome.tts.stop;
  });
  const ttsLog = () => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.slice());
  const hdLog = () => sw.evaluate(async () => ((await chrome.storage.session.get('test:hdPlayed'))['test:hdPlayed'] as string[] | undefined) ?? []);

  // Opt in: the click asks for the two download hosts (accepted in Chrome's dialog).
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByTestId('hd-state')).toHaveText('Off.');
  await expect(options.getByTestId('hd-enable')).toContainText('170 MB');
  await options.bringToFront();
  await options.getByTestId('hd-enable').click();
  await options.waitForTimeout(1200);
  execFileSync('python3', [KEYS_SCRIPT, 'Tab,Return']);
  await expect(options.getByTestId('hd-state')).toHaveText('On. English guides use the HD voice.', { timeout: 15_000 });
  await expect(options.getByTestId('voice-in-use')).toContainText('HD voice');
  // The download hosts are released, and Waymark never runs on them.
  const after = await sw.evaluate(async () => ({ perms: (await chrome.permissions.getAll()).origins ?? [], regs: (await chrome.scripting.getRegisteredContentScripts()).flatMap((r) => r.matches ?? []) }));
  expect(after.perms).not.toContain('https://huggingface.co/*');
  expect(after.perms).not.toContain('https://raw.githubusercontent.com/*');
  expect(after.regs).toEqual(['http://127.0.0.1/*']);

  await options.getByTestId('hd-test').click();
  await expect.poll(hdLog).toEqual(['This is how Waymark will read your guides.']);

  // A run: step 1 plays in HD; step 2's HD audio fails, so the system voice reads it.
  await app.bringToFront();
  await msg(ext, 'run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await expect.poll(hdLog).toEqual(['This is how Waymark will read your guides.', 'Import your orders.']);
  expect(await ttsLog()).toEqual([]);
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => marker(app, 'player')).toBe('drawn:1');
  await expect.poll(ttsLog).toEqual(['Export them. STUB-FAIL']);
  expect((await hdLog()).length).toBe(2);
  await tooltip(app).locator('[data-action="exit"]').click();
  await expect.poll(() => marker(app, 'player')).toBe('off');

  // Remove frees the model and closes the offscreen document; guides use the system voice again.
  await options.bringToFront();
  await options.getByTestId('hd-remove').click();
  await expect(options.getByTestId('hd-state')).toHaveText('Off.');
  await expect.poll(() => sw.evaluate(() => chrome.offscreen.hasDocument())).toBe(false);
  await expect(options.getByTestId('voice-in-use')).toContainText('Test Voice');
});
