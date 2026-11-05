/** HD voice (D47): policy, the offscreen player, the offscreen sender check, and text splitting. */
import { describe, expect, it, vi } from 'vitest';
import { HD_FILES, HD_HOST_PATTERNS, HD_OFF, HD_TOTAL_BYTES, hdSpeed, tooSlow, useHd, type HdStatus } from '../../src/core/voice/hd';
import { grantedSitePatterns } from '../../src/core/permissions/registration';
import type { Audio, HdEngine } from '../../src/offscreen/engine';
import { CHECK_SENTENCE, HdPlayer, type AudioSink } from '../../src/offscreen/player';
import { fromServiceWorker, OffscreenRequestSchema, OFFSCREEN_TARGET } from '../../src/offscreen/protocol';
import { splitSentences } from '../../src/offscreen/text';

const ready: HdStatus = { state: 'ready', loaded: HD_TOTAL_BYTES, total: HD_TOTAL_BYTES };

describe('HD policy', () => {
  it('uses the HD voice only when ready and for English guides', () => {
    expect(useHd(ready, 'en')).toBe(true);
    expect(useHd(ready, 'en-GB')).toBe(true);
    expect(useHd(ready, 'de')).toBe(false);
    for (const state of ['off', 'downloading', 'checking', 'slow', 'error'] as const) expect(useHd({ ...ready, state }, 'en')).toBe(false);
  });
  it('calls a device too slow above 1.5× real time', () => {
    expect(tooSlow(3000, 4)).toBe(false);
    expect(tooSlow(6000, 4)).toBe(false);
    expect(tooSlow(6100, 4)).toBe(true);
    expect(tooSlow(100, 0)).toBe(true);
  });
  it('keeps the speed in the range the model handles', () => {
    expect(hdSpeed(1)).toBe(1);
    expect(hdSpeed(2)).toBe(1.5);
    expect(hdSpeed(0.5)).toBe(0.7);
  });
  it('downloads only pinned files from the two official hosts, each with a hash', () => {
    for (const f of HD_FILES) {
      expect(f.url).toMatch(/^https:\/\/(huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/[0-9a-f]{40}\/|raw\.githubusercontent\.com\/hexgrad\/misaki\/[0-9a-f]{40}\/)/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(HD_HOST_PATTERNS.some((p) => f.url.startsWith(p.slice(0, -1)))).toBe(true);
    }
    expect(Math.round(HD_TOTAL_BYTES / 1e6)).toBe(170);
  });
  it('never registers the content script on the download hosts', () => {
    expect(grantedSitePatterns(['https://huggingface.co/*', 'https://raw.githubusercontent.com/*', 'https://app.test/*'])).toEqual(['https://app.test/*']);
  });
});

function fakeEngine(over: Partial<HdEngine> = {}) {
  const synthCalls: string[] = [];
  let busy = 0;
  let maxBusy = 0;
  const engine: HdEngine = {
    download: vi.fn(async (p: (l: number, t: number) => void) => {
      for (let i = 1; i <= 200; i++) p((HD_TOTAL_BYTES * i) / 200, HD_TOTAL_BYTES);
    }),
    load: vi.fn(async () => undefined),
    synth: vi.fn(async (text: string): Promise<Audio> => {
      synthCalls.push(text);
      busy++;
      maxBusy = Math.max(maxBusy, busy);
      await new Promise((r) => setTimeout(r, 5));
      busy--;
      return { samples: new Float32Array(24000), sampleRate: 24000 }; // 1 s of audio
    }),
    remove: vi.fn(async () => undefined),
    ...over,
  };
  return { engine, synthCalls, maxBusy: () => maxBusy };
}

function fakeSink() {
  const played: string[] = [];
  let stops = 0;
  const sink: AudioSink = { play: (_a, text) => void played.push(text), stop: () => void stops++ };
  return { sink, played, stops: () => stops };
}

describe('HD player', () => {
  it('download: reports progress about every 1%, then checks speed and reports ready with the RTF', async () => {
    const { engine } = fakeEngine();
    const reports: HdStatus[] = [];
    let t = 0;
    const player = new HdPlayer(engine, fakeSink().sink, (s) => reports.push(s), () => (t += 400));
    const final = await player.download();
    expect(final.state).toBe('ready');
    expect(final.rtf).toBe(0.4);
    const progress = reports.filter((r) => r.state === 'downloading');
    expect(progress.length).toBeGreaterThan(50);
    expect(progress.length).toBeLessThanOrEqual(101);
    expect(reports.at(-2)?.state).toBe('checking');
    expect(engine.synth).toHaveBeenCalledWith(CHECK_SENTENCE, 1);
    // A warm-up inference runs first; only the second one is timed.
    expect((engine.synth as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['Hello.', CHECK_SENTENCE]);
  });
  it('download: a slow device reports slow; a failure reports error with the message', async () => {
    let t = 0;
    const slow = new HdPlayer(fakeEngine().engine, fakeSink().sink, () => undefined, () => (t += 2000));
    expect((await slow.download()).state).toBe('slow');
    const failing = fakeEngine({ download: async () => Promise.reject(new Error('onnx/model_fp16.onnx failed its integrity check')) });
    const r = await new HdPlayer(failing.engine, fakeSink().sink, () => undefined).download();
    expect(r).toMatchObject({ state: 'error', message: 'onnx/model_fp16.onnx failed its integrity check' });
  });
  it('plays a step, pre-generates the next one, and plays that one from the cache', async () => {
    const { engine, synthCalls, maxBusy } = fakeEngine();
    const { sink, played } = fakeSink();
    const player = new HdPlayer(engine, sink, () => undefined);
    expect(await player.speak('t1', 'Step one.', 1, 'Step two.', 1)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(synthCalls).toEqual(['Step one.', 'Step two.']);
    expect(await player.speak('t2', 'Step two.', 1, null, 2)).toEqual({ ok: true });
    expect(synthCalls).toEqual(['Step one.', 'Step two.']); // no second generation
    expect(played).toEqual(['Step one.', 'Step two.']);
    expect(maxBusy()).toBe(1); // one inference at a time
  });
  it('a newer speak cancels one still generating; it never plays late', async () => {
    const { engine } = fakeEngine();
    const { sink, played } = fakeSink();
    const player = new HdPlayer(engine, sink, () => undefined);
    const first = player.speak('t1', 'Old step.', 1, null, 1);
    const second = player.speak('t2', 'New step.', 1, null, 2);
    expect(await first).toEqual({ ok: false, error: 'cancelled' });
    expect(await second).toEqual({ ok: true });
    expect(played).toEqual(['New step.']);
  });
  it('a stop sent before a speak, arriving after it, does not cancel the new step', async () => {
    const { engine } = fakeEngine();
    const { sink, played } = fakeSink();
    const player = new HdPlayer(engine, sink, () => undefined);
    const speaking = player.speak('t2', 'New step.', 1, null, 20);
    player.stop(10); // older than the speak
    expect(await speaking).toEqual({ ok: true });
    expect(played).toEqual(['New step.']);
    const next = player.speak('t3', 'Third.', 1, null, 30);
    player.stop(40); // newer: cancels
    expect(await next).toEqual({ ok: false, error: 'cancelled' });
  });
  it('a speak older than the newest one is ignored', async () => {
    const { engine } = fakeEngine();
    const { sink, played } = fakeSink();
    const player = new HdPlayer(engine, sink, () => undefined);
    await player.speak('t2', 'New.', 1, null, 20);
    expect(await player.speak('t1', 'Old.', 1, null, 10)).toEqual({ ok: false, error: 'cancelled' });
    expect(played).toEqual(['New.']);
  });
  it('an engine failure answers with an error (the service worker then uses the system voice), and later speaks retry', async () => {
    let fail = true;
    const { engine } = fakeEngine({ load: async () => (fail ? Promise.reject(new Error('wasm failed')) : undefined) });
    const player = new HdPlayer(engine, fakeSink().sink, () => undefined);
    expect(await player.speak('t1', 'Hi.', 1, null, 1)).toEqual({ ok: false, error: 'wasm failed' });
    fail = false;
    expect(await player.speak('t2', 'Hi.', 1, null, 2)).toEqual({ ok: true });
  });
  it('two opt-ins at once share one download', async () => {
    const { engine } = fakeEngine();
    const player = new HdPlayer(engine, fakeSink().sink, () => undefined);
    const [a, b] = await Promise.all([player.download(), player.download()]);
    expect(a).toEqual(b);
    expect(engine.download).toHaveBeenCalledTimes(1);
    await player.download(); // a later one runs again (a re-check)
    expect(engine.download).toHaveBeenCalledTimes(2);
  });
  it('text with no readable words makes no audio: that is a failure, so the system voice can try', async () => {
    const { engine } = fakeEngine({ synth: async () => ({ samples: new Float32Array(0), sampleRate: 24000 }) });
    const { sink, played } = fakeSink();
    const player = new HdPlayer(engine, sink, () => undefined);
    expect(await player.speak('t1', '漢字', 1, null, 1)).toEqual({ ok: false, error: 'no audio' });
    expect(played).toEqual([]);
  });
  it('a stop with the same time as a speak cancels that speak (the service worker cancelling its own late speak)', async () => {
    const { engine } = fakeEngine();
    const { sink, played } = fakeSink();
    const player = new HdPlayer(engine, sink, () => undefined);
    const speaking = player.speak('t1', 'Late.', 1, null, 5);
    player.stop(5);
    expect(await speaking).toEqual({ ok: false, error: 'cancelled' });
    expect(played).toEqual([]);
  });
  it('remove deletes the cache, forgets clips and reports off', async () => {
    const { engine, synthCalls } = fakeEngine();
    const reports: HdStatus[] = [];
    const player = new HdPlayer(engine, fakeSink().sink, (s) => reports.push(s));
    await player.speak('t1', 'Hi.', 1, null, 1);
    await player.remove();
    expect(engine.remove).toHaveBeenCalled();
    expect(reports.at(-1)).toEqual(HD_OFF);
    await player.speak('t2', 'Hi.', 1, null, 2);
    expect(synthCalls).toEqual(['Hi.', 'Hi.']);
  });
});

describe('offscreen messages', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const worker = `chrome-extension://${id}/background.js`;
  it('come only from the service worker: not a content script, not another extension page', () => {
    expect(fromServiceWorker({ id, url: worker }, id, worker)).toBe(true);
    expect(fromServiceWorker({ id, url: worker, tab: { id: 1 } }, id, worker)).toBe(false);
    expect(fromServiceWorker({ id, url: `chrome-extension://${id}/options.html` }, id, worker)).toBe(false);
    expect(fromServiceWorker({ id: 'other', url: worker }, id, worker)).toBe(false);
  });
  it('are validated', () => {
    expect(OffscreenRequestSchema.safeParse({ target: OFFSCREEN_TARGET, type: 'hd.speak', engine: 'kokoro', token: 't', text: 'Hi', speed: 1, next: null, at: 1 }).success).toBe(true);
    expect(OffscreenRequestSchema.safeParse({ target: OFFSCREEN_TARGET, type: 'hd.speak', engine: 'kokoro', token: 't', text: '', speed: 1, next: null, at: 1 }).success).toBe(false);
    expect(OffscreenRequestSchema.safeParse({ target: OFFSCREEN_TARGET, type: 'hd.speak', engine: 'gpl', token: 't', text: 'Hi', speed: 1, next: null, at: 1 }).success).toBe(false);
    expect(OffscreenRequestSchema.safeParse({ target: 'other', type: 'hd.stop', at: 1 }).success).toBe(false);
  });
});

describe('sentence split', () => {
  it('splits sentences, and long ones at commas or spaces under the model limit', () => {
    expect(splitSentences('One. Two!  Three?')).toEqual(['One.', 'Two!', 'Three?']);
    const long = Array.from({ length: 80 }, (_, i) => `item ${i}`).join(', ') + '.';
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 300)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long);
    expect(splitSentences('x'.repeat(700)).every((p) => p.length <= 300)).toBe(true);
  });
});
