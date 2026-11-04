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

/** Names of the better voices: Edge's "… Online (Natural)", Windows natural, macOS Premium / Enhanced. */
const HIGH_QUALITY = /\b(natural|neural|enhanced|premium)\b/i;

export function isHighQuality(v: VoiceLike): boolean {
  return HIGH_QUALITY.test(v.voiceName ?? '');
}

/**
 * Lower is better. Remote natural voices come first (they are only usable once the user allows
 * online voices), then on-device natural ones, then other on-device voices, then other remote ones.
 */
function tier(v: VoiceLike): number {
  const hq = isHighQuality(v);
  const remote = v.remote === true;
  if (hq) return remote ? 0 : 1;
  return remote ? 3 : 2;
}

/** 0 when the voice's region matches the wanted one (e.g. en-US for an en-US guide), else 1. */
function regionRank(v: VoiceLike, region: string | undefined): number {
  if (!region) return 0;
  const parts = (v.lang ?? '').split(/[-_]/);
  return parts[1]?.toLowerCase() === region ? 0 : 1;
}

function regionOf(lang: string | undefined): string | undefined {
  return lang?.split(/[-_]/)[1]?.toLowerCase();
}

/**
 * Usable voices for a language, best first: natural-sounding names, then local over remote,
 * then the guide's (or else the browser's) region, then the order the browser lists them in,
 * which puts the OS default voice first. The sort is stable.
 */
export function rankVoices<V extends VoiceLike>(voices: V[], lang: string, allowOnline: boolean, uiLang?: string): V[] {
  const want = primaryLang(lang);
  const uiRegion = primaryLang(uiLang) === want ? regionOf(uiLang) : undefined;
  const region = regionOf(lang) ?? uiRegion;
  return usableVoices(voices, allowOnline)
    .filter((v) => primaryLang(v.lang) === want)
    .map((v, i) => ({ v, i }))
    .sort((a, b) => tier(a.v) - tier(b.v) || regionRank(a.v, region) - regionRank(b.v, region) || a.i - b.i)
    .map((x) => x.v);
}

/**
 * The voice for a guide's language: the user's choice if it is usable, else the best-ranked
 * usable voice for that language. Undefined means stay silent (never fall back to a remote voice).
 */
export function pickVoice<V extends VoiceLike>(
  voices: V[],
  lang: string,
  settings: Pick<VoiceSettings, 'allowOnlineVoices' | 'voices'>,
  uiLang?: string,
): V | undefined {
  const ranked = rankVoices(voices, lang, settings.allowOnlineVoices, uiLang);
  const chosen = settings.voices[primaryLang(lang)];
  return ranked.find((v) => v.voiceName === chosen) ?? ranked[0];
}
