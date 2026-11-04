/**
 * HD voice in the service worker (D47), with chrome faked: when it speaks with the HD voice,
 * when it falls back to chrome.tts, what it sends the offscreen document, and opt-in / remove.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guide, Step } from '../../src/core/model/schema';
import { startRun } from '../../src/core/player/run';
import { HD_HOST_PATTERNS, HD_TOTAL_BYTES, HD_WAIT_MS } from '../../src/core/voice/hd';

const step = (id: string, voiceText: string): Step => ({ id, kind: 'click', title: id, url: { kind: 'pattern', value: '/' }, advance: 'action', voiceText });
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
  steps: [step('a', 'First step.'), step('b', 'Second step.')],
  version: 1,
  source: 'local',
  updatedAt: '',
});

let local: Record<string, unknown>;
let session: Record<string, unknown>;
let hasDoc: boolean;
let offscreenReply: (msg: { type: string }) => Promise<unknown>;
const sent: { type: string; [k: string]: unknown }[] = [];
const ttsSpeak = vi.fn();

function fakeChrome() {
  const area = (store: () => Record<string, unknown>) => ({
    get: vi.fn(async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).map((x) => [x, store()[x]]))),
    set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store(), o)),
    remove: vi.fn(async (k: string) => void delete store()[k]),
  });
  return {
    tts: { getVoices: (cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Samantha', lang: 'en-US', remote: false }]), speak: ttsSpeak, stop: vi.fn() },
    storage: { local: area(() => local), session: area(() => session) },
    tabs: { get: vi.fn(async (id: number) => ({ id, active: true, windowId: 1 })), sendMessage: vi.fn(async () => undefined) },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
    offscreen: {
      Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK', WORKERS: 'WORKERS' },
      hasDocument: vi.fn(async () => hasDoc),
      createDocument: vi.fn(async () => void (hasDoc = true)),
      closeDocument: vi.fn(async () => void (hasDoc = false)),
    },
    runtime: {
      sendMessage: vi.fn(async (m: { type: string }) => {
        sent.push(m);
        return offscreenReply(m);
      }),
    },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
    permissions: { remove: vi.fn(async () => true) },
  };
}

const ready = { state: 'ready', loaded: HD_TOTAL_BYTES, total: HD_TOTAL_BYTES };

beforeEach(() => {
  local = {};
  session = {};
  hasDoc = false;
  sent.length = 0;
  ttsSpeak.mockClear();
  offscreenReply = async () => ({ ok: true });
  vi.stubGlobal('chrome', fakeChrome());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const speaks = () => sent.filter((m) => m.type === 'hd.speak');

describe('speaking a step', () => {
  it('uses the HD voice when it is ready and the guide is English, sending the next step to pre-generate', async () => {
    local.hdStatus = ready;
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en-US')));
    expect(speaks()).toMatchObject([{ target: 'waymark-offscreen', text: 'First step.', next: 'Second step.', speed: 1 }]);
    expect(ttsSpeak).not.toHaveBeenCalled();
    expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(expect.objectContaining({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK', 'WORKERS'] }));
    expect(chrome.alarms.create).toHaveBeenCalledWith('hd-idle', expect.anything());
  });

  it('uses the system voice when HD voice is off, not ready, too slow, or the guide is not English', async () => {
    const { speakCurrentStep } = await import('../../src/background/voice');
    for (const [status, lang] of [
      [undefined, 'en'],
      [{ ...ready, state: 'downloading' }, 'en'],
      [{ ...ready, state: 'slow' }, 'en'],
      [ready, 'de'],
    ] as const) {
      local.hdStatus = status;
      ttsSpeak.mockClear();
      await speakCurrentStep(7, startRun(guide(lang)));
      expect(speaks()).toEqual([]);
    }
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it('falls back to the system voice when the HD engine fails, and cancels the HD audio', async () => {
    local.hdStatus = ready;
    offscreenReply = async (m) => (m.type === 'hd.speak' ? { ok: false, error: 'wasm failed' } : { ok: true });
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(ttsSpeak).toHaveBeenCalledWith('First step.', expect.objectContaining({ voiceName: 'Samantha' }));
    expect(sent.at(-1)?.type).toBe('hd.stop');
  });

  it('falls back to the system voice when HD audio is not ready in time', async () => {
    local.hdStatus = ready;
    offscreenReply = (m) => (m.type === 'hd.speak' ? new Promise(() => undefined) : Promise.resolve({ ok: true }));
    vi.useFakeTimers();
    const { speakCurrentStep } = await import('../../src/background/voice');
    const done = speakCurrentStep(7, startRun(guide('en')));
    await vi.advanceTimersByTimeAsync(HD_WAIT_MS + 10);
    await done;
    expect(ttsSpeak).toHaveBeenCalledWith('First step.', expect.anything());
    const stop = sent.at(-1)!;
    expect(stop.type).toBe('hd.stop');
    expect(stop.at as number).toBeGreaterThan(speaks()[0]!.at as number); // newer than the speak, so it cancels it
  });

  it('falls back when the offscreen document cannot be created', async () => {
    local.hdStatus = ready;
    chrome.offscreen.createDocument = vi.fn(async () => Promise.reject(new Error('no offscreen')));
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(ttsSpeak).toHaveBeenCalled();
  });

  it('stops HD audio on stop, with a timestamp so a later step is not cancelled', async () => {
    hasDoc = true;
    const { stopSpeech } = await import('../../src/background/voice');
    stopSpeech();
    await vi.waitFor(() => expect(sent.map((m) => m.type)).toEqual(['hd.stop']));
    expect(typeof sent[0]!.at).toBe('number');
  });
});

describe('opt-in and remove', () => {
  it('enable: records only the hosts this opt-in added, opens the document and starts the download', async () => {
    const { hdEnable } = await import('../../src/background/hd');
    const status = await hdEnable([HD_HOST_PATTERNS[0], 'https://evil.test/*']);
    expect(status.state).toBe('downloading');
    expect(session.hdReleaseHosts).toEqual([HD_HOST_PATTERNS[0]]);
    expect(sent).toMatchObject([{ type: 'hd.download', engine: 'kokoro' }]);
  });

  it('a final report stores the status and releases the download hosts; progress keeps them', async () => {
    const { hdEnable, onHdReport } = await import('../../src/background/hd');
    await hdEnable([...HD_HOST_PATTERNS]);
    await onHdReport({ status: { state: 'downloading', loaded: 10, total: HD_TOTAL_BYTES } });
    expect(chrome.permissions.remove).not.toHaveBeenCalled();
    await onHdReport({ status: { ...ready, rtf: 0.8 } as never });
    expect(local.hdStatus).toMatchObject({ state: 'ready', rtf: 0.8 });
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: [...HD_HOST_PATTERNS] });
    expect(session.hdReleaseHosts).toBeUndefined();
  });

  it('a late progress report does not undo Remove', async () => {
    const { hdEnable, hdRemove, onHdReport } = await import('../../src/background/hd');
    await hdEnable([]);
    await hdRemove();
    await onHdReport({ status: { state: 'downloading', loaded: 99, total: HD_TOTAL_BYTES } });
    expect(local.hdStatus).toMatchObject({ state: 'off' });
  });

  it('remove deletes the model in the document, closes it and releases hosts', async () => {
    const { hdEnable, hdRemove } = await import('../../src/background/hd');
    await hdEnable([HD_HOST_PATTERNS[1]]);
    await hdRemove();
    expect(sent.map((m) => m.type)).toEqual(['hd.download', 'hd.remove']);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: [HD_HOST_PATTERNS[1]] });
    expect(local.hdStatus).toMatchObject({ state: 'off' });
  });

  it('a download whose document is gone (browser closed) shows as an error in Settings', async () => {
    local.hdStatus = { state: 'downloading', loaded: 5, total: HD_TOTAL_BYTES };
    const { hdStatusForSettings } = await import('../../src/background/hd');
    expect(await hdStatusForSettings()).toMatchObject({ state: 'error' });
  });

  it('the idle alarm closes the document, but not during a download', async () => {
    const { onHdIdle } = await import('../../src/background/hd');
    hasDoc = true;
    local.hdStatus = { state: 'checking', loaded: 0, total: HD_TOTAL_BYTES };
    await onHdIdle();
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    local.hdStatus = ready;
    await onHdIdle();
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
  });
});
