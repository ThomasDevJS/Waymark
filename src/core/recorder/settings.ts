/** The author's recording settings (D153), in storage.local. Zod here; the content script never imports it. */
import { z } from 'zod';

export const RecorderSettingsSchema = z.object({
  /** While recording, outline what a click will record. On by default. */
  hover: z.boolean().catch(true).default(true),
});
export type RecorderSettings = z.infer<typeof RecorderSettingsSchema>;
export const DEFAULT_RECORDER_SETTINGS: RecorderSettings = RecorderSettingsSchema.parse({});
