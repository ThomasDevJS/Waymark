import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_SETTINGS, pickVoice, usableVoices, voiceTextFor } from '../../src/core/voice/voice';
import type { Step } from '../../src/core/model/schema';

const step = (extra: Partial<Step> = {}): Step => ({ id: 's', kind: 'click', title: 'Click **Save**', url: { kind: 'pattern', value: '/' }, advance: 'action', ...extra });
const voices = [
  { voiceName: 'Google US English', lang: 'en-US', remote: true },
  { voiceName: 'Local Alice', lang: 'en-GB', remote: false },
  { voiceName: 'Local Bob', lang: 'en-US', remote: false },
  { voiceName: 'Lokal Fritz', lang: 'de-DE', remote: false },
];

describe('voice text', () => {
  it('reads the stored voice text, else the title plus the note, as plain text', () => {
    expect(voiceTextFor(step({ voiceText: 'Press save now.' }))).toBe('Press save now.');
    expect(voiceTextFor(step())).toBe('Click Save');
    expect(voiceTextFor(step({ note: 'It is the *blue* one.' }))).toBe('Click Save. It is the blue one.');
    expect(voiceTextFor(step({ voiceText: '   ', note: 'x' }))).toBe('Click Save. x');
  });
});

describe('voice choice', () => {
  it('uses on-device voices only by default; remote ones only when allowed', () => {
    expect(usableVoices(voices, false).map((v) => v.voiceName)).not.toContain('Google US English');
    expect(usableVoices(voices, true).map((v) => v.voiceName)).toContain('Google US English');
  });
  it("picks the user's voice for the guide's language, else the first usable one; silent when none", () => {
    expect(pickVoice(voices, 'en', DEFAULT_VOICE_SETTINGS)?.voiceName).toBe('Local Alice');
    expect(pickVoice(voices, 'en-US', { ...DEFAULT_VOICE_SETTINGS, voices: { en: 'Local Bob' } })?.voiceName).toBe('Local Bob');
    // a remote choice is ignored while online voices are off
    expect(pickVoice(voices, 'en', { ...DEFAULT_VOICE_SETTINGS, voices: { en: 'Google US English' } })?.voiceName).toBe('Local Alice');
    expect(pickVoice(voices, 'de', DEFAULT_VOICE_SETTINGS)?.voiceName).toBe('Lokal Fritz');
    expect(pickVoice(voices, 'fr', DEFAULT_VOICE_SETTINGS)).toBeUndefined();
    expect(pickVoice([voices[0]!], 'en', DEFAULT_VOICE_SETTINGS)).toBeUndefined(); // never falls back to a remote voice
  });
});
