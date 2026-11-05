/**
 * HD voice in the service worker (D51), with chrome faked: when it speaks with the HD voice,
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
    tabs: { get: vi.fn(async (id: number) => ({ id, active: true, windowId: 1, url: 'https://app.test/orders' })), sendMessage: vi.fn(async () => undefined) },
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
    // The stop carries the speak's own time: it cancels that speak, never a newer step's.
    expect(stop.at).toBe(speaks()[0]!.at);
  });

  it("the HD voice, like the system voice, never reads a step on a site that is not the guide's (D48)", async () => {
    local.hdStatus = ready;
    chrome.tabs.get = vi.fn(async (id: number) => ({ id, active: true, windowId: 1, url: 'https://elsewhere.test/' })) as never;
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(speaks()).toEqual([]);
    expect(ttsSpeak).not.toHaveBeenCalled();
  });

  it('a cancelled HD speak (a newer step or a stop replaced it) says nothing: no system voice', async () => {
    local.hdStatus = ready;
    offscreenReply = async (m) => (m.type === 'hd.speak' ? { ok: false, error: 'cancelled' } : { ok: true });
    const { speakCurrentStep } = await import('../../src/background/voice');
    await speakCurrentStep(7, startRun(guide('en')));
    expect(ttsSpeak).not.toHaveBeenCalled();
    expect(sent.filter((m) => m.type === 'hd.stop')).toEqual([]);
  });

  it('a failed HD speak does not fall back once a newer step started: its stale text is never read', async () => {
    local.hdStatus = ready;
    let failFirst!: (r: unknown) => void;
    offscreenReply = (m) =>
      m.type !== 'hd.speak' ? Promise.resolve({ ok: true }) : (m as unknown as { text: string }).text === 'First step.' ? new Promise((r) => (failFirst = r)) : Promise.resolve({ ok: true });
    const { speakCurrentStep } = await import('../../src/background/voice');
    const run = startRun(guide('en'));
    const first = speakCurrentStep(7, run);
    await vi.waitFor(() => expect(speaks().length).toBe(1));
    // The learner moves on: step 2 speaks in HD.
    await speakCurrentStep(7, { ...run, stepIndex: 1, stepToken: 'next' });
    failFirst({ ok: false, error: 'wasm failed' });
    await first;
    expect(ttsSpeak).not.toHaveBeenCalled();
    // The stop for step 1 is older than step 2's speak, so the offscreen player ignores it.
    const stop = sent.filter((m) => m.type === 'hd.stop').at(-1)!;
    expect(stop.at as number).toBeLessThan(speaks()[1]!.at as number);
  });

  it('a failed HD speak does not fall back after Mute or Exit', async () => {
    local.hdStatus = ready;
    let fail!: (r: unknown) => void;
    offscreenReply = (m) => (m.type === 'hd.speak' ? new Promise((r) => (fail = r)) : Promise.resolve({ ok: true }));
    const { speakCurrentStep, stopSpeech } = await import('../../src/background/voice');
    const speaking = speakCurrentStep(7, startRun(guide('en')));
    await vi.waitFor(() => expect(speaks().length).toBe(1));
    stopSpeech(); // Exit (Mute also calls it)
    await new Promise((r) => setTimeout(r, 5));
    fail({ ok: false, error: 'wasm failed' });
    await speaking;
    expect(ttsSpeak).not.toHaveBeenCalled();
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

describe('built-in tutorials on the HD voice (D142)', () => {
  const ctx = {} as never;

  it('a tutorial step uses the HD voice once it is ready, with the next step to pre-generate', async () => {
    local.hdStatus = ready;
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx)).toEqual({ ok: true });
    expect(speaks()).toMatchObject([{ text: expect.stringMatching(/^Welcome to the tutorial page\./), next: expect.stringMatching(/^Click New invoice\./) }]);
    expect(ttsSpeak).not.toHaveBeenCalled();
  });

  it('without the HD voice a tutorial uses the system voice, as before (D129)', async () => {
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx)).toEqual({ ok: true });
    expect(speaks()).toEqual([]);
    expect(ttsSpeak).toHaveBeenCalledTimes(1);
  });

  it('a tutorial falls back to the system voice when the HD voice fails', async () => {
    local.hdStatus = ready;
    offscreenReply = async (m) => (m.type === 'hd.speak' ? { ok: false, error: 'wasm failed' } : { ok: true });
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx)).toEqual({ ok: true });
    expect(ttsSpeak.mock.calls[0]![0]).toMatch(/^Welcome to the tutorial page\./);
  });

  it('never while muted, and never with "Read each step aloud" off unless asked', async () => {
    local.hdStatus = ready;
    local.voiceSettings = { muted: true };
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1', explicit: true }, ctx)).toEqual({ ok: false });
    local.voiceSettings = { autoPlay: false };
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx)).toEqual({ ok: false });
    expect(speaks()).toEqual([]);
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1', explicit: true }, ctx)).toEqual({ ok: true });
    expect(speaks()).toHaveLength(1);
  });

  it('a failed HD tutorial step does not fall back after the tutorial stopped', async () => {
    local.hdStatus = ready;
    let fail!: (r: unknown) => void;
    offscreenReply = (m) => (m.type === 'hd.speak' ? new Promise((r) => (fail = r)) : Promise.resolve({ ok: true }));
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    const speaking = tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx);
    await vi.waitFor(() => expect(speaks().length).toBe(1));
    // The tutorial is marked while its HD audio is pending, so the practice page's Stop reaches it.
    expect(await tutorialHandlers['tutorial.stop']!({}, ctx)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 5));
    fail({ ok: false, error: 'wasm failed' });
    expect(await speaking).toEqual({ ok: false });
    expect(ttsSpeak).not.toHaveBeenCalled();
  });

  it('a tutorial step that nothing can read (HD off, no on-device voice) never stops a guide speaking elsewhere (review)', async () => {
    chrome.tts.getVoices = ((cb: (v: chrome.tts.TtsVoice[]) => void) => cb([])) as typeof chrome.tts.getVoices;
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx)).toEqual({ ok: false });
    expect(chrome.tts.stop).not.toHaveBeenCalled();
  });

  it('only bundled text: an unknown step reads nothing, on either voice', async () => {
    local.hdStatus = ready;
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'nope' }, ctx)).toEqual({ ok: false });
    expect(speaks()).toEqual([]);
    expect(ttsSpeak).not.toHaveBeenCalled();
  });
});

describe('opt-in and remove', () => {
  it('enable: records only the hosts this opt-in added, opens the document and starts the download', async () => {
    const { hdEnable } = await import('../../src/background/hd');
    const status = await hdEnable([HD_HOST_PATTERNS[0], 'https://evil.test/*']);
    expect(status.state).toBe('downloading');
    expect(local.hdReleaseHosts).toEqual([HD_HOST_PATTERNS[0]]);
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
    expect(local.hdReleaseHosts).toBeUndefined();
  });

  it('after the speed check the model is not left in memory: ready arms the idle close, slow and error close now', async () => {
    const { hdEnable, onHdReport } = await import('../../src/background/hd');
    await hdEnable([]);
    await onHdReport({ status: { ...ready } as never });
    expect(chrome.alarms.create).toHaveBeenCalledWith('hd-idle', expect.anything());
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    for (const state of ['slow', 'error'] as const) {
      local.hdStatus = { state: 'checking', loaded: 0, total: HD_TOTAL_BYTES };
      hasDoc = true;
      await onHdReport({ status: { ...ready, state } as never });
      expect(hasDoc).toBe(false);
    }
  });

  it('enable gives the hosts back when the document cannot be created (review)', async () => {
    chrome.offscreen.createDocument = vi.fn(async () => Promise.reject(new Error('no offscreen')));
    const { hdEnable } = await import('../../src/background/hd');
    await expect(hdEnable([...HD_HOST_PATTERNS])).rejects.toThrow('no offscreen');
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: [...HD_HOST_PATTERNS] });
    expect(local.hdReleaseHosts).toBeUndefined();
  });

  it('one download at a time: a second enable while downloading starts nothing', async () => {
    const { hdEnable } = await import('../../src/background/hd');
    await hdEnable([]);
    await hdEnable([]);
    expect(sent.filter((m) => m.type === 'hd.download').length).toBe(1);
  });

  it('the document exists before the status says downloading, so Settings never calls a starting download failed', async () => {
    let created!: () => void;
    chrome.offscreen.createDocument = vi.fn(() => new Promise<void>((r) => (created = () => ((hasDoc = true), r()))));
    const { hdEnable, hdStatusForSettings } = await import('../../src/background/hd');
    const enabling = hdEnable([HD_HOST_PATTERNS[0]]);
    await vi.waitFor(() => expect(created).toBeTypeOf('function'));
    expect((await hdStatusForSettings()).state).toBe('off');
    expect(chrome.permissions.remove).not.toHaveBeenCalled();
    created();
    await enabling;
    expect(local.hdStatus).toMatchObject({ state: 'downloading' });
  });

  it('the hosts to release survive a browser restart (session storage cleared): a lost download still releases them', async () => {
    const { hdEnable, hdStatusForSettings } = await import('../../src/background/hd');
    await hdEnable([...HD_HOST_PATTERNS]);
    session = {}; // browser restart
    hasDoc = false;
    expect((await hdStatusForSettings()).state).toBe('error');
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: [...HD_HOST_PATTERNS] });
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
