/**
 * Voice for the built-in tutorials (D129). The Practice page sends only a tutorial id and a step
 * id; the text comes from the bundled pack. It follows the same settings as guides: never while
 * muted, and only when "Read each step aloud" is on (or the learner pressed Replay voice).
 * `tutorial.stop` stops only a tutorial's own speech, never a guide's in another tab.
 */
import type { Handlers } from '../core/messaging/router';
import { tutorialVoiceText } from '../core/tutorials/tutorials';
import { getVoiceSettings, speakBundledText, stopSpeech, TUTORIAL_SPEECH_KEY } from './voice';

export const tutorialHandlers: Handlers = {
  'tutorial.speak': async ({ tutorialId, stepId, explicit }) => {
    const text = tutorialVoiceText(tutorialId, stepId);
    if (!text) return { ok: false };
    const settings = await getVoiceSettings();
    if (settings.muted || (!settings.autoPlay && !explicit)) return { ok: false };
    const ok = await speakBundledText(text, 'en', settings);
    if (ok) await chrome.storage.session.set({ [TUTORIAL_SPEECH_KEY]: true });
    return { ok };
  },
  'tutorial.stop': async () => {
    const r = await chrome.storage.session.get(TUTORIAL_SPEECH_KEY);
    if (!r[TUTORIAL_SPEECH_KEY]) return { ok: false };
    stopSpeech('tutorial ended');
    return { ok: true };
  },
};
