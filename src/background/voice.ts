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

let lastSpeechTab: number | null = null;

export function stopSpeech(): void {
  if (ttsAvailable()) chrome.tts.stop();
  if (lastSpeechTab !== null) {
    const msg: ContentPush = { type: 'tts.stop' };
    chrome.tabs.sendMessage(lastSpeechTab, msg, { frameId: 0 }).catch(() => undefined);
  }
}

async function isFocusedTab(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return false;
    const win = await chrome.windows.get(tab.windowId);
    return win.focused;
  } catch {
    return false;
  }
}

async function speak(tabId: number, text: string, lang: string, settings: VoiceSettings): Promise<void> {
  if (!text) return;
  if (!ttsAvailable()) {
    // Fallback: the top frame speaks with speechSynthesis.
    lastSpeechTab = tabId;
    const msg: ContentPush = { type: 'tts.content', payload: { text, lang, rate: settings.rate } };
    chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => undefined);
    return;
  }
  const voice = pickVoice(await getVoices(), lang, settings);
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
  // One voice channel: only the focused tab speaks.
  if (!(await isFocusedTab(tabId))) return;
  await speak(tabId, voiceTextFor(step), run.guideSnapshot.lang, settings);
}

/** "Test voice" in the options page: a fixed sample, never user-supplied text. */
export async function speakSample(lang = 'en'): Promise<boolean> {
  const settings = await getVoiceSettings();
  if (!ttsAvailable()) return false;
  const voice = pickVoice(await getVoices(), lang, settings);
  if (!voice) return false;
  chrome.tts.stop();
  chrome.tts.speak('This is how Waymark will read your guides.', { voiceName: voice.voiceName, lang: voice.lang, rate: settings.rate, enqueue: false });
  return true;
}
