import { describe, expect, it } from 'vitest';
import { bestSpeechVoice, isHighQuality, pickVoice, rankVoices, usableVoices, voiceTextFor } from '../../src/core/voice/voice';
import { DEFAULT_VOICE_SETTINGS } from '../../src/core/voice/settings';
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

// Real-world names: Edge on Windows, Chrome on macOS, Windows SAPI, Chrome's Google voices.
const realistic = [
  { voiceName: 'Microsoft David - English (United States)', lang: 'en-US', remote: false },
  { voiceName: 'Google US English', lang: 'en-US', remote: true },
  { voiceName: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', remote: true },
  { voiceName: 'Samantha', lang: 'en-US', remote: false },
  { voiceName: 'Ava (Premium)', lang: 'en-US', remote: false },
  { voiceName: 'Zoe (Enhanced)', lang: 'en-GB', remote: false },
  { voiceName: 'en-US-JennyNeural', lang: 'en-US', remote: false }, // a third-party engine's CamelCase name
  { voiceName: 'Anna', lang: 'de-DE', remote: false },
];
const names = (v: { voiceName?: string }[]) => v.map((x) => x.voiceName);

describe('voice ranking', () => {
  it('detects natural-sounding voices by name', () => {
    expect(isHighQuality({ voiceName: 'Ava (Premium)' })).toBe(true);
    expect(isHighQuality({ voiceName: 'Microsoft Aria Online (Natural) - English (United States)' })).toBe(true);
    expect(isHighQuality({ voiceName: 'Some Neural Voice' })).toBe(true);
    expect(isHighQuality({ voiceName: 'Samantha' })).toBe(false);
    expect(isHighQuality({ voiceName: 'Unnaturally' })).toBe(false); // whole words only
    expect(isHighQuality({ voiceName: 'en-US-AriaNeural' })).toBe(true); // CamelCase
    expect(isHighQuality({ voiceName: 'NaturalVoices' })).toBe(false);
  });
  it('ranks natural names first, then local over remote, then the list order (the OS default first)', () => {
    expect(names(rankVoices(realistic, 'en-US', false))).toEqual([
      'Ava (Premium)',
      'en-US-JennyNeural',
      'Zoe (Enhanced)', // natural, but the wrong region for an en-US guide
      'Microsoft David - English (United States)',
      'Samantha',
    ]);
  });
  it('puts Edge "Online (Natural)" voices first, but only once online voices are allowed', () => {
    expect(names(rankVoices(realistic, 'en', true)).slice(0, 2)).toEqual(['Microsoft Aria Online (Natural) - English (United States)', 'Ava (Premium)']);
    expect(names(rankVoices(realistic, 'en', true)).at(-1)).toBe('Google US English'); // plain remote voices come last
    expect(names(rankVoices(realistic, 'en', false))).not.toContain('Microsoft Aria Online (Natural) - English (United States)');
  });
  it("uses the browser's region when the guide's lang has none", () => {
    const two = [
      { voiceName: 'Daniel (Enhanced)', lang: 'en-GB', remote: false },
      { voiceName: 'Ava (Premium)', lang: 'en-US', remote: false },
    ];
    expect(pickVoice(two, 'en', DEFAULT_VOICE_SETTINGS, 'en-US')?.voiceName).toBe('Ava (Premium)');
    expect(pickVoice(two, 'en', DEFAULT_VOICE_SETTINGS, 'en-GB')?.voiceName).toBe('Daniel (Enhanced)');
    expect(pickVoice(two, 'en', DEFAULT_VOICE_SETTINGS, 'de-DE')?.voiceName).toBe('Daniel (Enhanced)'); // other language: list order
  });
  it("keeps the user's own choice over the best-ranked voice", () => {
    expect(pickVoice(realistic, 'en', { ...DEFAULT_VOICE_SETTINGS, voices: { en: 'Samantha' } })?.voiceName).toBe('Samantha');
    expect(pickVoice(realistic, 'en', DEFAULT_VOICE_SETTINGS)?.voiceName).toBe('Ava (Premium)');
    expect(pickVoice(realistic, 'de', DEFAULT_VOICE_SETTINGS)?.voiceName).toBe('Anna');
  });
  it('never uses a saved online voice while online voices are off', () => {
    const saved = { ...DEFAULT_VOICE_SETTINGS, voices: { en: 'Microsoft Aria Online (Natural) - English (United States)' } };
    expect(pickVoice(realistic, 'en', saved)?.remote).toBe(false);
    expect(pickVoice(realistic, 'en', { ...saved, allowOnlineVoices: true })?.voiceName).toBe('Microsoft Aria Online (Natural) - English (United States)');
  });
  it('reads lang tags with underscores, any case and script subtags; skips voices without a lang', () => {
    const odd = [
      { voiceName: 'No lang', remote: false },
      { voiceName: 'A', lang: 'EN_gb', remote: false },
      { voiceName: 'B', lang: 'en_US', remote: false },
      { voiceName: 'Hans', lang: 'zh-Hans-CN', remote: false },
      { voiceName: 'Hant', lang: 'zh-Hant-TW', remote: false },
    ];
    expect(names(rankVoices(odd, 'en-us', false))).toEqual(['B', 'A']);
    expect(names(rankVoices(odd, 'zh-TW', false))).toEqual(['Hant', 'Hans']);
    expect(names(rankVoices(odd, 'zh', false, 'zh-Hant-TW'))).toEqual(['Hant', 'Hans']);
  });
  it('ranks speechSynthesis voices the same way for the fallback, on-device only', () => {
    const synth = [
      { name: 'Google US English', lang: 'en-US', localService: false },
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Ava (Premium)', lang: 'en-US', localService: true },
    ];
    expect(bestSpeechVoice(synth, 'en')?.name).toBe('Ava (Premium)');
    expect(bestSpeechVoice([synth[0]!], 'en')).toBeUndefined();
  });
});
