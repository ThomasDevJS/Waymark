/** Learner settings for playing guides (D144). Zod lives here, not in shade.ts, which the content script imports. */
import { z } from 'zod';
import { LEARNER_SHADES } from './shade';

export const PlayerSettingsSchema = z.object({
  /** "guide": each guide's own shade (or the default). Otherwise this shade for every guide and tutorial. */
  shade: z.enum(LEARNER_SHADES).catch('guide').default('guide'),
});
export type PlayerSettings = z.infer<typeof PlayerSettingsSchema>;
export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = PlayerSettingsSchema.parse({});
