/**
 * Voiceover (SPEC: Voiceover and AI text): the browser's voices read each step. On-device
 * voices only by default: voices marked remote (such as Chrome's "Google …" voices) send the
 * text to a server, so they are used only when the user turns on Allow online voices.
 */
import { z } from 'zod';
import type { Step } from '../model/schema';
import { toPlainText } from '../text/markdown';

export const VoiceSettingsSchema = z.object({
  autoPlay: z.boolean().default(true),
  rate: z.number().min(0.5).max(2).default(1),
  allowOnlineVoices: z.boolean().default(false),
  muted: z.boolean().default(false),
  /** Chosen voice per language (primary subtag, e.g. "en"). */
  voices: z.record(z.string().max(35), z.string().max(200)).default({}),
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = VoiceSettingsSchema.parse({});

/** What is read for a step: its stored voice text, or the title plus the note. */
export function voiceTextFor(step: Step): string {
  const own = step.voiceText?.trim();
  if (own) return own.slice(0, 5000);
  const title = toPlainText(step.title).trim();
  const note = step.note ? toPlainText(step.note).trim() : '';
  if (!note) return title;
  return /[.!?:]$/.test(title) ? `${title} ${note}` : `${title}. ${note}`;
}

export interface VoiceLike {
  voiceName?: string;
  lang?: string;
  remote?: boolean;
}

export function primaryLang(lang: string | undefined): string {
  return (lang ?? 'en').split(/[-_]/)[0]!.toLowerCase();
}

/** Voices the user may use: on-device only unless online voices are allowed. */
export function usableVoices<V extends VoiceLike>(voices: V[], allowOnline: boolean): V[] {
  return voices.filter((v) => !!v.voiceName && (allowOnline || v.remote !== true));
}

/**
 * The voice for a guide's language: the user's choice if it is usable, else the first usable
 * voice for that language. Undefined means stay silent (never fall back to a remote voice).
 */
export function pickVoice<V extends VoiceLike>(voices: V[], lang: string, settings: Pick<VoiceSettings, 'allowOnlineVoices' | 'voices'>): V | undefined {
  const want = primaryLang(lang);
  const usable = usableVoices(voices, settings.allowOnlineVoices).filter((v) => primaryLang(v.lang) === want);
  const chosen = settings.voices[want];
  return usable.find((v) => v.voiceName === chosen) ?? usable[0];
}
