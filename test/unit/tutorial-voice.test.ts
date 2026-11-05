/** Tutorial voice in the service worker (D129): bundled text only, the guide settings, and Stop that never cuts off a guide. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let local: Record<string, unknown>;
let session: Record<string, unknown>;
const speak = vi.fn();
const stop = vi.fn();

beforeEach(() => {
  local = {};
  session = {};
  speak.mockClear();
  stop.mockClear();
  vi.stubGlobal('chrome', {
    tts: { getVoices: (cb: (v: chrome.tts.TtsVoice[]) => void) => cb([{ voiceName: 'Test Voice', lang: 'en-US', remote: false }]), speak, stop },
    storage: {
      local: { get: vi.fn(async (k: string) => ({ [k]: local[k] })), set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(local, o)) },
      session: { get: vi.fn(async (k: string) => ({ [k]: session[k] })), set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(session, o)) },
    },
    tabs: { sendMessage: vi.fn(async () => undefined) },
  });
});

const ctx = {} as never;

describe('tutorial.speak / tutorial.stop', () => {
  it('reads the bundled step text with the guide voice; nothing for an unknown step', async () => {
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-2' }, ctx)).toEqual({ ok: true });
    expect(speak.mock.calls[0]![0]).toBe('Click New invoice. The bright frame shows where to act. Click it yourself: the guide moves on when you do.');
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'nope' }, ctx)).toEqual({ ok: false });
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('is silent while muted, and with "Read each step aloud" off unless asked (Replay voice)', async () => {
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    local.voiceSettings = { muted: true };
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1', explicit: true }, ctx)).toEqual({ ok: false });
    local.voiceSettings = { autoPlay: false };
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx)).toEqual({ ok: false });
    expect(await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1', explicit: true }, ctx)).toEqual({ ok: true });
  });

  it('Stop stops a tutorial’s own speech, but not a guide that started speaking since (review)', async () => {
    const { tutorialHandlers } = await import('../../src/background/tutorials');
    const { stopSpeech } = await import('../../src/background/voice');
    await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx);
    stop.mockClear();
    expect(await tutorialHandlers['tutorial.stop']!({}, ctx)).toEqual({ ok: true });
    expect(stop).toHaveBeenCalled();
    // A guide in another tab speaks (every guide step stops speech first): the practice page's Stop must not cut it off.
    await tutorialHandlers['tutorial.speak']!({ tutorialId: 'tour', stepId: 'tour-1' }, ctx);
    stopSpeech();
    await Promise.resolve();
    stop.mockClear();
    expect(await tutorialHandlers['tutorial.stop']!({}, ctx)).toEqual({ ok: false });
    expect(stop).not.toHaveBeenCalled();
  });
});
