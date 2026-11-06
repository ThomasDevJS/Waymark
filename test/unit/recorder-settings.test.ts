/** D153/D154: recording settings, and what a content script may see of them. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RECORDER_SETTINGS, recorderSettingsFor, RecorderSettingsSchema, type RecorderSettings } from '../../src/core/recorder/settings';

describe('recorder settings', () => {
  it('the hover outline is on by default, and a bad value falls back to on', () => {
    expect(DEFAULT_RECORDER_SETTINGS.hover).toBe(true);
    expect(RecorderSettingsSchema.parse({ hover: 'yes' }).hover).toBe(true);
    expect(RecorderSettingsSchema.parse({ hover: false }).hover).toBe(false);
  });

  it('a content script gets the hover switch and nothing else, even when more settings exist (D154)', () => {
    const later = { hover: false, secretFutureSetting: 'x' } as unknown as RecorderSettings;
    expect(recorderSettingsFor(later, 'content')).toEqual({ hover: false });
    expect(recorderSettingsFor(later, 'extension')).toBe(later);
  });
});
