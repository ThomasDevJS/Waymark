/** The author's recording settings (D153), in storage.local. Read-modify-write goes through enqueue. */
import { enqueue } from '../core/storage/queue';
import { DEFAULT_RECORDER_SETTINGS, RecorderSettingsSchema, type RecorderSettings } from '../core/recorder/settings';

const KEY = 'recorderSettings';

export async function getRecorderSettings(): Promise<RecorderSettings> {
  const parsed = RecorderSettingsSchema.safeParse((await chrome.storage.local.get(KEY))[KEY] ?? {});
  return parsed.success ? parsed.data : DEFAULT_RECORDER_SETTINGS;
}

export function setRecorderSettings(patch: Partial<RecorderSettings>): Promise<RecorderSettings> {
  return enqueue(async () => {
    const next = RecorderSettingsSchema.parse({ ...(await getRecorderSettings()), ...patch });
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
}
