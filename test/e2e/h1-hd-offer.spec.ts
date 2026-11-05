/**
 * The HD voice offer on the Practice page (D140–D143), with the test build's stub engine (CI
 * never downloads the model). The tutorial plays at once with the system voice; Download asks
 * for the two hosts from the click on this extension page, downloads in the background, gives
 * the hosts back, and the next step is read with the HD voice. Asked once.
 */
import { execFileSync } from 'node:child_process';
import { canGrant, expect, KEYS_SCRIPT, marker, test } from './fixtures';
import type { Page, Worker } from '@playwright/test';

const overlay = (p: Page, action: string) => p.locator(`waymark-overlay [data-action="${action}"]`);
const CAPABLE = { uiLang: 'en-US', cores: 8, memoryGb: 8 };

async function stubVoices(sw: Worker) {
  await sw.evaluate(() => {
    const log: string[] = [];
    (self as unknown as { __tts: string[] }).__tts = log;
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }])) as typeof chrome.tts.getVoices;
    chrome.tts.speak = ((text: string) => void log.push(text)) as unknown as typeof chrome.tts.speak;
    chrome.tts.stop = (() => undefined) as unknown as typeof chrome.tts.stop;
  });
}

test('Practice page: the offer shows as the tutorial starts, which plays at once; Download switches the next step to the HD voice', async ({ context, extensionId, sw }) => {
  test.skip(!canGrant, 'needs a display to accept the permission dialog');
  await sw.evaluate((env) => chrome.storage.local.set({ 'test:hdStub': true, 'test:hdOfferEnv': env }), CAPABLE);
  await stubVoices(sw);
  const ttsLog = () => sw.evaluate(() => (self as unknown as { __tts: string[] }).__tts.slice());
  const hdLog = () => sw.evaluate(async () => ((await chrome.storage.session.get('test:hdPlayed'))['test:hdPlayed'] as string[] | undefined) ?? []);

  const practice = await context.newPage();
  await practice.goto(`chrome-extension://${extensionId}/practice.html?tutorial=tour`);
  // Not blocked: step 1 is drawn and read with the system voice while the offer is on screen.
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
  const offer = practice.getByTestId('hd-offer');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('Tutorials sound much better with the HD voice.');
  await expect(offer).toContainText('about 170 MB');
  await expect.poll(ttsLog).toContainEqual(expect.stringMatching(/^Welcome to the tutorial page\./));
  // The offer doesn't take focus from the guide.
  expect(await practice.evaluate(() => document.activeElement?.closest('[data-testid="hd-offer"]') ?? null)).toBeNull();

  // The sample plays a bundled file: nothing is requested or downloaded.
  await offer.getByTestId('hd-offer-sample').click();
  await expect(offer.getByTestId('hd-offer-sample')).toHaveAttribute('aria-pressed', 'true');
  expect(await sw.evaluate(async () => (await chrome.permissions.getAll()).origins ?? [])).not.toContain('https://huggingface.co/*');
  expect(await sw.evaluate(async () => (await chrome.storage.local.get('hdStatus'))['hdStatus'] ?? null)).toBeNull();

  // Download: the click on this extension page asks for the two hosts (accepted in Chrome's dialog).
  await practice.bringToFront();
  await offer.getByTestId('hd-offer-download').click();
  await practice.waitForTimeout(1200);
  execFileSync('python3', [KEYS_SCRIPT, 'Tab,Return']);
  await expect(offer.getByTestId('hd-offer-status')).toHaveText('The HD voice is on. The next step uses it.', { timeout: 15_000 });
  // The tutorial kept going meanwhile; the hosts are given back.
  expect(await marker(practice, 'practice')).toBe('drawn:0');
  const perms = await sw.evaluate(async () => (await chrome.permissions.getAll()).origins ?? []);
  expect(perms).not.toContain('https://huggingface.co/*');
  expect(perms).not.toContain('https://raw.githubusercontent.com/*');

  // The next step is read with the HD voice, not the system voice.
  const before = (await ttsLog()).length;
  await overlay(practice, 'next').click();
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:1');
  await expect.poll(hdLog).toEqual([expect.stringMatching(/^Click New invoice\./)]);
  expect((await ttsLog()).length).toBe(before);

  // Asked once: the answer is remembered, and the card is gone after Close and on the next visit.
  expect(await sw.evaluate(async () => (await chrome.storage.local.get('ui:hdOffer'))['ui:hdOffer'])).toBe('download');
  await offer.getByTestId('hd-offer-close').click();
  await expect(practice.getByTestId('hd-offer')).toHaveCount(0);
  await practice.goto(`chrome-extension://${extensionId}/practice.html?tutorial=tour`);
  await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
  await expect(practice.getByTestId('hd-offer')).toHaveCount(0);
});

test('Practice page: "Not now" is remembered; a non-English browser or a small device never sees the offer', async ({ context, extensionId, sw }) => {
  await sw.evaluate((env) => chrome.storage.local.set({ 'test:hdStub': true, 'test:hdOfferEnv': env }), { ...CAPABLE, uiLang: 'fr-FR' });
  await stubVoices(sw);
  const practice = await context.newPage();
  const open = async () => {
    await practice.goto(`chrome-extension://${extensionId}/practice.html?tutorial=tour`);
    await expect.poll(() => marker(practice, 'practice')).toBe('drawn:0');
    await practice.waitForTimeout(300); // the offer reads its gate after the first draw
  };
  await open();
  await expect(practice.getByTestId('hd-offer')).toHaveCount(0);
  await sw.evaluate((env) => chrome.storage.local.set({ 'test:hdOfferEnv': env }), { ...CAPABLE, cores: 2 });
  await open();
  await expect(practice.getByTestId('hd-offer')).toHaveCount(0);

  await sw.evaluate((env) => chrome.storage.local.set({ 'test:hdOfferEnv': env }), CAPABLE);
  await open();
  await expect(practice.getByTestId('hd-offer')).toBeVisible();
  await practice.getByTestId('hd-offer-later').click();
  await expect(practice.getByTestId('hd-offer')).toHaveCount(0);
  // Focus goes back to the tutorial's Stop button, not to the page.
  await expect(practice.getByTestId('practice-stop')).toBeFocused();
  expect(await sw.evaluate(async () => (await chrome.storage.local.get('ui:hdOffer'))['ui:hdOffer'])).toBe('later');
  await open();
  await expect(practice.getByTestId('hd-offer')).toHaveCount(0);
  // Nothing was downloaded; the switch stays in Settings.
  expect(await sw.evaluate(async () => (await chrome.storage.local.get('hdStatus'))['hdStatus'] ?? null)).toBeNull();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByTestId('hd-enable')).toBeVisible();
});
