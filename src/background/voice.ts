/**
 * Service worker voice (SPEC: Voiceover). Speaks only the stored voice text of the current step
 * (never text a content script supplies), only in the focused tab, and stops on step change,
 * Back, Exit and mute. Where chrome.tts is missing, the top frame speaks with speechSynthesis.
 */
import type { ContentPush } from '../core/messaging/protocol';
import { currentStep, type Run } from '../core/player/run';
import { enqueue } from '../core/storage/queue';
import { DEFAULT_VOICE_SETTINGS, pickVoice, usableVoices, VoiceSettingsSchema, voiceTextFor, type VoiceSettings } from '../core/voice/voice';

const SETTINGS_KEY = 'voiceSettings';

export async function getVoiceSettings(): Promise<VoiceSettings> {
  const raw = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  const parsed = VoiceSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_VOICE_SETTINGS;
}

export function setVoiceSettings(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
  return enqueue(async () => {
    const next = VoiceSettingsSchema.parse({ ...(await getVoiceSettings()), ...patch });
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
}

export function ttsAvailable(): boolean {
  return typeof chrome.tts?.speak === 'function';
}

/** The browser's UI language (e.g. "en-GB"): picks the region when a guide gives none. */
function uiLang(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.language;
}

export function getVoices(): Promise<chrome.tts.TtsVoice[]> {
  if (!ttsAvailable()) return Promise.resolve([]);
  return new Promise((resolve) => chrome.tts.getVoices((v) => resolve(v ?? [])));
}

/** Voices for the picker: on-device ones, plus remote ones only when allowed. */
export async function listVoices(): Promise<{ voices: { voiceName: string; lang: string; remote: boolean }[]; available: boolean }> {
  const settings = await getVoiceSettings();
  const voices = usableVoices(await getVoices(), settings.allowOnlineVoices).map((v) => ({ voiceName: v.voiceName!, lang: v.lang ?? '', remote: v.remote === true }));
  return { voices, available: ttsAvailable() };
}

/** The tab speaking through the speechSynthesis fallback (in session storage: no memory state). */
const FALLBACK_TAB_KEY = 'ttsFallbackTab';

export function stopSpeech(): void {
  if (ttsAvailable()) chrome.tts.stop();
  void chrome.storage.session.get(FALLBACK_TAB_KEY).then((r) => {
    const tabId = r[FALLBACK_TAB_KEY] as number | undefined;
    if (tabId === undefined) return;
    const msg: ContentPush = { type: 'tts.stop' };
    chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => undefined);
  });
}

/** The active tab of the browser window the user last focused (the side panel lives there too). */
/** The tab, if it is the active tab of the last focused window; else null. */
async function focusedTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return null;
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win.id === tab.windowId ? tab : null;
  } catch {
    return null;
  }
}

/** True when the tab shows a page of one of the guide's sites. */
function onGuideSite(url: string | undefined, appOrigins: string[]): boolean {
  try {
    return !!url && appOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

async function speak(tabId: number, text: string, lang: string, settings: VoiceSettings): Promise<void> {
  if (!text) return;
  if (!ttsAvailable()) {
    // Fallback: the top frame speaks with speechSynthesis.
    await chrome.storage.session.set({ [FALLBACK_TAB_KEY]: tabId });
    const msg: ContentPush = { type: 'tts.content', payload: { text, lang, rate: settings.rate } };
    chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => undefined);
    return;
  }
  const voice = pickVoice(await getVoices(), lang, settings, uiLang());
  if (!voice) return; // no usable on-device voice: stay silent rather than send text to a server
  chrome.tts.speak(text, { voiceName: voice.voiceName, lang: voice.lang, rate: settings.rate, enqueue: false });
}

/** Speaks the run's current step once, when it becomes current. */
export async function speakCurrentStep(tabId: number, run: Run | null): Promise<void> {
  stopSpeech();
  if (!run || run.status !== 'running') return;
  const step = currentStep(run);
  if (!step) return;
  const settings = await getVoiceSettings();
  if (!settings.autoPlay || settings.muted) return;
  // One voice channel: only the focused tab speaks, and only on the guide's own sites: a
  // step is never read out (or sent to the speechSynthesis fallback) on another site (D47).
  const tab = await focusedTab(tabId);
  if (!tab || !onGuideSite(tab.url, run.guideSnapshot.appOrigins)) return;
  await speak(tabId, voiceTextFor(step), run.guideSnapshot.lang, settings);
}

/** "Test voice" in the options page: a fixed sample, never user-supplied text. */
export async function speakSample(lang = 'en'): Promise<boolean> {
  const settings = await getVoiceSettings();
  if (!ttsAvailable()) return false;
  const voice = pickVoice(await getVoices(), lang, settings, uiLang());
  if (!voice) return false;
  chrome.tts.stop();
  chrome.tts.speak('This is how Waymark will read your guides.', { voiceName: voice.voiceName, lang: voice.lang, rate: settings.rate, enqueue: false });
  return true;
}
