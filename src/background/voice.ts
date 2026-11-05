/**
 * Service worker voice (SPEC: Voiceover). Speaks only the stored voice text of the current step
 * (never text a content script supplies), only in the focused tab, and stops on step change,
 * Back, Exit and mute. Where chrome.tts is missing, the top frame speaks with speechSynthesis.
 */
import type { ContentPush } from '../core/messaging/protocol';
import { currentStep, type Run } from '../core/player/run';
import { enqueue } from '../core/storage/queue';
import { getHdStatus, hdSpeak, hdStop } from './hd';
import { clock } from '../offscreen/protocol';
import { hdSpeed, useHd } from '../core/voice/hd';
import { pickVoice, usableVoices, voiceTextFor } from '../core/voice/voice';
import { DEFAULT_VOICE_SETTINGS, VoiceSettingsSchema, type VoiceSettings } from '../core/voice/settings';
import { dlog } from './debug';

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

/**
 * When the newest speech started or was stopped (session storage). A step whose HD audio
 * failed falls back to the system voice only while it is still the newest: never after a
 * newer step, Mute or Exit (D51).
 */
const SPEECH_AT_KEY = 'speechAt';
/** Set while a tutorial step is being read; `tutorial.stop` stops speech only then (D129). */
export const TUTORIAL_SPEECH_KEY = 'speech:tutorial';

/** Stops all speech. `why` goes to the debug log (D110); internal restarts pass none. */
export function stopSpeech(why?: string): void {
  if (why) dlog('voice', 'voice.stop', {}, { why });
  if (ttsAvailable()) chrome.tts.stop();
  hdStop();
  // Whatever speaks next is not a tutorial's, unless the tutorial handler marks it again (D129).
  void chrome.storage.session.set({ [SPEECH_AT_KEY]: clock(), [TUTORIAL_SPEECH_KEY]: false });
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
    dlog('voice', 'voice.start', { tab: tabId }, { engine: 'page speechSynthesis', lang });
    const msg: ContentPush = { type: 'tts.content', payload: { text, lang, rate: settings.rate } };
    chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => undefined);
    return;
  }
  const voice = pickVoice(await getVoices(), lang, settings, uiLang());
  if (!voice) {
    dlog('voice', 'voice.silent', { tab: tabId }, { why: 'no usable on-device voice for this language', lang });
    return; // no usable on-device voice: stay silent rather than send text to a server
  }
  dlog('voice', 'voice.start', { tab: tabId }, { engine: 'tts', lang, remote: voice.remote === true });
  chrome.tts.speak(text, { voiceName: voice.voiceName, lang: voice.lang, rate: settings.rate, enqueue: false });
}

/**
 * Speaks the run's current step once, when it becomes current. `explicit` is the learner asking
 * for it (Replay voice, D106): it speaks even with "Read each step aloud" off, but never muted.
 */
export async function speakCurrentStep(tabId: number, run: Run | null, explicit = false): Promise<void> {
  stopSpeech();
  if (!run || run.status !== 'running') return;
  const step = currentStep(run);
  if (!step) return;
  const settings = await getVoiceSettings();
  const silent = (why: string) => dlog('voice', 'voice.silent', { tab: tabId }, { step: run.stepIndex + 1, why });
  if (settings.muted) return silent('muted');
  if (!settings.autoPlay && !explicit) return silent('Read each step aloud is off');
  // One voice channel: only the focused tab speaks, and only on the guide's own sites: a
  // step is never read out (or sent to the speechSynthesis fallback) on another site (D48).
  const tab = await focusedTab(tabId);
  if (!tab) return silent('not the active tab of the focused window');
  if (!onGuideSite(tab.url, run.guideSnapshot.appOrigins)) return silent('the tab is not on one of the guide’s sites');
  const text = voiceTextFor(step);
  if (!text) return silent('the step has no text to read');
  const lang = run.guideSnapshot.lang;
  if (text && useHd(await getHdStatus(), lang)) {
    // The next step's text is generated while this one plays, so it starts at once.
    const nextStep = run.guideSnapshot.steps[run.stepIndex + 1];
    const next = nextStep ? voiceTextFor(nextStep) || null : null;
    const at = clock();
    await chrome.storage.session.set({ [SPEECH_AT_KEY]: at });
    dlog('voice', 'voice.start', { tab: tabId }, { engine: 'hd', step: run.stepIndex + 1, lang });
    const outcome = await hdSpeak(run.stepToken, text, hdSpeed(settings.rate), next, at);
    dlog('voice', 'voice.hd', { tab: tabId }, { outcome });
    if (outcome !== 'failed') return;
    // Fall back only if nothing newer happened meanwhile and the learner didn't mute.
    const latest = (await chrome.storage.session.get(SPEECH_AT_KEY))[SPEECH_AT_KEY];
    const now = await getVoiceSettings();
    if (latest !== at || now.muted || (!now.autoPlay && !explicit)) return silent('HD voice failed, and a newer step, Mute or Exit came first');
    dlog('voice', 'voice.fallback', { tab: tabId }, { why: 'HD voice failed: the system voice reads it' });
  }
  await speak(tabId, text, lang, settings);
}

const SAMPLE = 'This is how Waymark will read your guides.';

/** "Test HD voice" in the options page. */
export async function speakHdSample(): Promise<boolean> {
  const settings = await getVoiceSettings();
  if (!useHd(await getHdStatus(), 'en')) return false;
  stopSpeech();
  return (await hdSpeak(`sample-${Date.now()}`, SAMPLE, hdSpeed(settings.rate), null)) === 'played';
}

/**
 * Reads bundled text (a built-in tutorial step, D129) with the voice guides use. Never page or
 * user text: callers look the text up in the bundled pack. System voice only (no HD, no fallback
 * to a page's speechSynthesis: the Practice page is an extension page).
 */
export async function speakBundledText(text: string, lang: string, settings: VoiceSettings): Promise<boolean> {
  if (!ttsAvailable() || !text) return false;
  const voice = pickVoice(await getVoices(), lang, settings, uiLang());
  if (!voice) return false;
  stopSpeech();
  chrome.tts.speak(text.slice(0, 5000), { voiceName: voice.voiceName, lang: voice.lang, rate: settings.rate, enqueue: false });
  return true;
}

/** "Test voice" in the options page: a fixed sample, never user-supplied text. */
export async function speakSample(lang = 'en'): Promise<boolean> {
  const settings = await getVoiceSettings();
  if (!ttsAvailable()) return false;
  const voice = pickVoice(await getVoices(), lang, settings, uiLang());
  if (!voice) return false;
  chrome.tts.stop();
  chrome.tts.speak(SAMPLE, { voiceName: voice.voiceName, lang: voice.lang, rate: settings.rate, enqueue: false });
  return true;
}
