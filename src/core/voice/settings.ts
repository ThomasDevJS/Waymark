/**
 * Voice settings (SPEC: Voiceover). Kept apart from voice.ts, which the content script imports
 * (bestSpeechVoice): this module uses Zod, which the content script should not carry.
 */
import { z } from 'zod';

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
