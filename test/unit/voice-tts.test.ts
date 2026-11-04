/**
 * The service worker's voice path with chrome.tts spied on: fake voice lists stand in for the
 * machine's voices, and we check which voice chrome.tts.speak is asked to use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guide, Step } from '../../src/core/model/schema';
import { startRun } from '../../src/core/player/run';

type Voice = chrome.tts.TtsVoice;

const step: Step = { id: 's1', kind: 'click', title: 'Click **Save**', url: { kind: 'pattern', value: '/' }, advance: 'action', voiceText: 'Press Save.' };
const guide = (lang: string): Guide => ({
  id: 'g1',
  schemaVersion: 1,
  revisionId: 'r1',
  title: 'Demo',
  lang,
  tags: [],
  appOrigins: ['https://app.test'],
  startUrl: 'https://app.test/',
  matchUrls: [{ kind: 'pattern', value: '/' }],
  steps: [step],
  version: 1,
  source: 'local',
  updatedAt: '',
});

let voices: Voice[];
let local: Record<string, unknown>;
let tabUrl = 'https://app.test/x';
const getVoices = vi.fn((cb: (v: Voice[]) => void) => cb(voices));
const speak = vi.fn();
const stop = vi.fn();

function fakeChrome() {
  return {
    tts: { getVoices, speak, stop },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: local[k] })),
        set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(local, o)),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
    },
    tabs: { get: vi.fn(async (id: number) => ({ id, active: true, windowId: 1, url: tabUrl })), sendMessage: vi.fn(async () => undefined) },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
  };
}

const spokenWith = () => speak.mock.calls.map(([text, opts]) => ({ text: text as string, voiceName: (opts as chrome.tts.TtsOptions).voiceName }));

beforeEach(() => {
  voices = [];
  local = {};
  getVoices.mockClear();
  speak.mockClear();
  stop.mockClear();
  tabUrl = 'https://app.test/x';
  vi.stubGlobal('chrome', fakeChrome());
});
afterEach(() => vi.unstubAllGlobals());

const windowsEdge: Voice[] = [
  { voiceName: 'Microsoft David - English (United States)', lang: 'en-US', remote: false },
  { voiceName: 'Microsoft Zira - English (United States)', lang: 'en-US', remote: false },
  { voiceName: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', remote: true },
  { voiceName: 'Microsoft Jenny Online (Natural) - English (United States)', lang: 'en-US', remote: true },
];
const mac: Voice[] = [
  { voiceName: 'Samantha', lang: 'en-US', remote: false },
  { voiceName: 'Google US English', lang: 'en-US', remote: true },
  { voiceName: 'Ava (Premium)', lang: 'en-US', remote: false },
];

describe('chrome.tts voice choice', () => {
  it('speaks a step with the best on-device voice, not the first one listed', async () => {
    voices = mac;
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(getVoices).toHaveBeenCalled();
    expect(spokenWith()).toEqual([{ text: 'Press Save.', voiceName: 'Ava (Premium)' }]);
  });

  it('on Windows with online voices off, uses the first on-device voice (the OS order)', async () => {
    voices = windowsEdge;
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(spokenWith()[0]?.voiceName).toBe('Microsoft David - English (United States)');
  });

  it('ignores a saved online voice while online voices are off', async () => {
    voices = windowsEdge;
    local.voiceSettings = { voices: { en: 'Microsoft Aria Online (Natural) - English (United States)' } };
    const { speakSample } = await import('../../src/background/voice');
    expect(await speakSample('en')).toBe(true);
    expect(spokenWith()[0]?.voiceName).toBe('Microsoft David - English (United States)');
  });

  it('does not treat a voice without a lang as English (the options page drops it too)', async () => {
    voices = [{ voiceName: 'Engine (Natural)', remote: false }, { voiceName: 'Samantha', lang: 'en-US', remote: false }];
    const { speakSample, listVoices } = await import('../../src/background/voice');
    expect(await speakSample('en')).toBe(true);
    expect(spokenWith()[0]?.voiceName).toBe('Samantha');
    expect((await listVoices()).voices.find((v) => v.voiceName === 'Engine (Natural)')?.lang).toBe('');
  });

  it('uses an Edge "Online (Natural)" voice first once online voices are allowed', async () => {
    voices = windowsEdge;
    local.voiceSettings = { allowOnlineVoices: true };
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en-US')));
    expect(spokenWith()[0]?.voiceName).toBe('Microsoft Aria Online (Natural) - English (United States)');
  });

  it("keeps the user's own voice choice", async () => {
    voices = mac;
    local.voiceSettings = { voices: { en: 'Samantha' } };
    const { speakSample } = await import('../../src/background/voice');
    expect(await speakSample('en')).toBe(true);
    expect(spokenWith()[0]?.voiceName).toBe('Samantha');
  });

  it('picks a macOS Premium voice for the sample, never the remote Google voice', async () => {
    voices = mac;
    const { speakSample } = await import('../../src/background/voice');
    expect(await speakSample('en')).toBe(true);
    expect(spokenWith()[0]?.voiceName).toBe('Ava (Premium)');
  });

  it('stays silent when only remote voices exist and online voices are off', async () => {
    voices = [{ voiceName: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', remote: true }];
    const { speakCurrentStep, speakSample, listVoices } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(await speakSample('en')).toBe(false);
    expect(speak).not.toHaveBeenCalled();
    expect((await listVoices()).voices).toEqual([]);
  });
});

describe('D48: a step is spoken only on its own sites', () => {
  it('stays silent when the tab shows another site', async () => {
    voices = mac;
    tabUrl = 'https://other.example/';
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(speak).not.toHaveBeenCalled();
    tabUrl = 'https://app.test/x';
    await speakCurrentStep(7, startRun(guide('en')));
    expect(speak).toHaveBeenCalledTimes(1);
  });
});
