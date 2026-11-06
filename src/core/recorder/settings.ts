/** The author's recording settings (D153), in storage.local. Zod here; the content script never imports it. */
import { z } from 'zod';

export const RecorderSettingsSchema = z.object({
  /** While recording, outline what a click will record. On by default. */
  hover: z.boolean().catch(true).default(true),
});
export type RecorderSettings = z.infer<typeof RecorderSettingsSchema>;
export const DEFAULT_RECORDER_SETTINGS: RecorderSettings = RecorderSettingsSchema.parse({});

/** What a content script sees of the settings: the hover switch only, so a later setting can never reach a page (D154). */
export type ContentRecorderSettings = Pick<RecorderSettings, 'hover'>;
export function recorderSettingsFor(settings: RecorderSettings, kind: 'extension' | 'content'): RecorderSettings | ContentRecorderSettings {
  return kind === 'content' ? { hover: settings.hover } : settings;
}
