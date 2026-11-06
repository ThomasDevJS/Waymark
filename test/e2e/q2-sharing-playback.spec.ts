/**
 * Sharing and playback conveniences (D104–D106), end to end: the text how-to export (Markdown
 * and printable HTML) after the review; the recording and side panel shortcuts pressed as real
 * keys (XTest under Xvfb, so chrome.commands sees them); the tooltip's Repeat step and Replay
 * voice.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { canGrant, expect, KEYS_SCRIPT, marker, test, type ExtensionHelper } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

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

async function recordOrders(ext: ExtensionHelper, app: Page, title: string): Promise<string> {
  const tabId = await tabIdFor(ext, app);
  await ext.message('rec.start', { tabId, title });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await app.waitForTimeout(150);
  await app.getByRole('button', { name: 'Export', exact: true }).click();
  await app.waitForTimeout(150);
  return (await ext.message<{ guideId: string }>('rec.stop', {})).guideId;
}

/** A real key chord to the focused browser window (chrome.commands ignores CDP key events). */
async function press(app: Page, chord: string) {
  await app.bringToFront();
  await app.waitForTimeout(300);
  execFileSync('python3', [KEYS_SCRIPT, chord]);
}

const tooltip = (app: Page) => app.locator('waymark-overlay .tip');

test('exports a guide as a Markdown and a printable HTML how-to after the review', async ({ context, ext, site, extensionId }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const guideId = await recordOrders(ext, app, 'Export orders');
  const g = await ext.message<{ revisionId: string; steps: { id: string; note?: string }[] } & Record<string, unknown>>('guide.get', { id: guideId });
  g.steps[0]!.note = 'Ask ada@example.com for the file, see https://wiki.example.com/orders';
  g.steps[1]!.note = 'Pick **CSV**.';
  await ext.message('guide.save', { guide: g, baseRevisionId: g.revisionId });
  const tabId = await tabIdFor(ext, app);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByTestId('export').click(); // checkboxes appear only while choosing (D124)
  await panel.getByLabel('Select Export orders for export').check();
  await panel.getByTestId('export-selected').click();
  await panel.getByTestId('format-markdown').check();
  await expect(panel.getByTestId('data-like-warning')).toContainText('1 item looks like data');
  await panel.getByTestId(`remove-${guideId}|${g.steps[0]!.id}|note`).click();
  await expect(panel.getByTestId('data-like-warning')).toHaveCount(0);
  const [md] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('download-howto').click()]);
  expect(md.suggestedFilename()).toBe('guides.md');
  const text = readFileSync((await md.path())!, 'utf8');
  expect(text).toBe(['# Export orders', '', `Start at ${site.main}`, '', '1. Click **Import**', '', '2. Click **Export**', '', '   Pick **CSV**.', ''].join('\n'));

  // HTML: the same review, this time from the guide's Share… (D124), then the preview page (D195);
  // nothing but the origin as an address.
  await panel.getByTestId(`more-${guideId}`).click();
  await panel.getByTestId(`share-${guideId}`).click();
  await panel.getByTestId('format-html').check();
  const [preview] = await Promise.all([context.waitForEvent('page'), panel.getByTestId('open-preview').click()]);
  await expect(preview.getByTestId('howto-preview')).toHaveAttribute('data-ready', 'yes');
  const [html] = await Promise.all([preview.waitForEvent('download'), preview.getByTestId('howto-download').click()]);
  expect(html.suggestedFilename()).toBe('guides.html');
  const page = readFileSync((await html.path())!, 'utf8');
  expect(page).toContain('<li><div class="title">Click <strong>Import</strong></div>');
  expect(page).toContain('ada@example.com'); // not removed this time: the author chose
  expect(page).not.toContain('wiki.example.com');
  expect(page).not.toContain('/app/orders');
  expect(page).not.toMatch(/<script|href=|src=/);
  // It renders as a page with the two numbered steps.
  const view = await context.newPage();
  await view.setContent(page);
  await expect(view.locator('ol > li')).toHaveCount(2);
  await expect(view.locator('h1')).toHaveText('Export orders');
});

test('Alt+R starts and stops recording in the current tab; Alt+W opens the side panel', async ({ context, ext, site }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const sw = await ext.sw();
  const panels = () => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType] })).length);
  expect(await panels()).toBe(0);

  await press(app, 'Alt_L+r');
  await expect.poll(() => marker(app, 'recording'), { timeout: 8000 }).toBe('on');
  // The shortcut opened the side panel too, which shows the live steps.
  await expect.poll(panels).toBe(1);
  await app.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(async () => ((await ext.message<{ steps: unknown[] } | null>('rec.state', {}))?.steps ?? []).length).toBe(1);
  await press(app, 'Alt_L+r');
  await expect.poll(() => marker(app, 'recording'), { timeout: 8000 }).not.toBe('on');
  const list = await ext.message<{ guides: { title: string; steps: number }[] }>('guide.list', {});
  expect(list.guides).toEqual([expect.objectContaining({ title: 'Untitled guide', steps: 1 })]);
  const last = await sw.evaluate(async () => (await chrome.storage.session.get('shortcut:last'))['shortcut:last']);
  expect(last).toMatchObject({ kind: 'stopped', title: 'Untitled guide', count: 1 });

  // A site Waymark is not allowed on: nothing records, and the panel is told why.
  const other = await context.newPage();
  await other.goto(`${site.other}/page3.html`);
  await press(other, 'Alt_L+r');
  await expect.poll(() => sw.evaluate(async () => ((await chrome.storage.session.get('shortcut:last'))['shortcut:last'] as { kind: string }).kind), { timeout: 8000 }).toBe('error');
  expect(await ext.message('rec.state', {})).toBeNull();

  // Alt+W is the toolbar button's command: it opens the side panel in a window without one.
  const url = `${site.main}/page2.html`;
  const [fresh] = await Promise.all([context.waitForEvent('page'), sw.evaluate((u) => chrome.windows.create({ url: u, focused: true }), url)]);
  await fresh.waitForLoadState();
  expect(await panels()).toBe(1);
  await press(fresh, 'Alt_L+w');
  await expect.poll(panels, { timeout: 8000 }).toBe(2);
});

test('the tooltip repeats the step and replays its voice', async ({ context, ext, site }) => {
  test.setTimeout(90_000);
  await ext.grant('http://127.0.0.1/*');
  const app = await openApp(context, `${site.main}/app/orders?static`);
  const guideId = await recordOrders(ext, app, 'Replay me');
  const tabId = await tabIdFor(ext, app);
  const sw = await ext.sw();
  // CI machines have no voices: one on-device voice and a spy (as in m4).
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((text: string) => void log.push(`speak:${text}`)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => undefined) as unknown as typeof chrome.tts.stop;
  });
  const spoken = () => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.slice());

  await app.bringToFront();
  await ext.message('run.start', { tabId, guideId });
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await expect.poll(spoken).toEqual(['speak:Click Import']);

  await tooltip(app).locator('[data-action="replay-voice"]').click();
  await expect.poll(spoken).toEqual(['speak:Click Import', 'speak:Click Import']);

  // Repeat: scrolled away (the tooltip goes with the target), a keyboard user presses Repeat
  // step; the step is found again, scrolled back into view, drawn and read again.
  await app.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await app.waitForTimeout(500);
  const draws = Number(await marker(app, 'draws'));
  await tooltip(app).locator('[data-action="repeat"]').focus();
  await app.keyboard.press('Enter');
  await expect.poll(() => marker(app, 'repeat')).toBe('1');
  // Drawn again (a new spotlight), not just still drawn.
  await expect.poll(async () => Number(await marker(app, 'draws'))).toBe(draws + 1);
  await expect.poll(() => marker(app, 'player')).toBe('drawn:0');
  await expect.poll(spoken).toHaveLength(3);
  await expect(app.getByRole('button', { name: 'Import', exact: true })).toBeInViewport();
  // Still the same step: the run did not move on.
  expect((await ext.message<{ stepIndex: number }>('run.state', { tabId })).stepIndex).toBe(0);

  // Muted: Replay voice is disabled and nothing is read.
  await tooltip(app).locator('[data-action="mute"]').click();
  await expect(tooltip(app).locator('[data-action="replay-voice"]')).toHaveAttribute('aria-disabled', 'true');
  await tooltip(app).locator('[data-action="replay-voice"]').dispatchEvent('click'); // focusable, but does nothing
  await app.waitForTimeout(500);
  await tooltip(app).locator('[data-action="repeat"]').click();
  await expect.poll(() => marker(app, 'repeat')).toBe('2');
  await app.waitForTimeout(500);
  expect(await spoken()).toHaveLength(3);
  // The mute toggle works again within the same step (it used to keep the state of its step).
  await tooltip(app).locator('[data-action="mute"]').click();
  await expect(tooltip(app).locator('[data-action="mute"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(tooltip(app).locator('[data-action="replay-voice"]')).toHaveAttribute('aria-disabled', 'false');
});
