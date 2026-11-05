/** The learner's player settings (D144), in storage.local. Read-modify-write goes through enqueue. */
import { enqueue } from '../core/storage/queue';
import { DEFAULT_PLAYER_SETTINGS, PlayerSettingsSchema, type PlayerSettings } from '../core/player/settings';

const KEY = 'playerSettings';

export async function getPlayerSettings(): Promise<PlayerSettings> {
  const parsed = PlayerSettingsSchema.safeParse((await chrome.storage.local.get(KEY))[KEY] ?? {});
  return parsed.success ? parsed.data : DEFAULT_PLAYER_SETTINGS;
}

export function setPlayerSettings(patch: Partial<PlayerSettings>): Promise<PlayerSettings> {
  return enqueue(async () => {
    const next = PlayerSettingsSchema.parse({ ...(await getPlayerSettings()), ...patch });
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
}
