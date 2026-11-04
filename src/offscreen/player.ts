/**
 * The HD voice player in the offscreen document (D47). It owns the engine, generates audio
 * one request at a time (the model runs one inference at a time), keeps the last few clips so
 * the next step, generated while the current one plays, starts at once, and plays one clip at a
 * time. Everything it is told to say comes from the service worker.
 */
import { HD_OFF, HD_TOTAL_BYTES, tooSlow, type HdStatus } from '../core/voice/hd';
import type { Audio, HdEngine } from './engine';
import type { SpeakReply } from './protocol';

export interface AudioSink {
  /** `text` is for test logs only. */
  play(audio: Audio, text: string): void;
  stop(): void;
}

/** A fixed sentence, about as long as a step, for the speed check after the download. */
export const CHECK_SENTENCE = 'Click Save to store the invoice, then open the Orders page.';
const KEEP_CLIPS = 4;

export class HdPlayer {
  private loaded: Promise<void> | null = null;
  private clips = new Map<string, Promise<Audio>>();
  private queue: Promise<unknown> = Promise.resolve();
  private token: string | null = null;
  /** When the newest speak was sent; older stops are ignored. */
  private lastSpeak = -Infinity;

  constructor(
    private readonly engine: HdEngine,
    private readonly sink: AudioSink,
    private readonly report: (status: HdStatus) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Opt-in: download and verify the model, load it, then measure this device's speed once. */
  async download(): Promise<HdStatus> {
    try {
      let last = 0;
      await this.engine.download((loaded, total) => {
        // Report about every 1% so the progress bar moves without flooding messages.
        if (loaded - last < total / 100 && loaded < total) return;
        last = loaded;
        this.report({ state: 'downloading', loaded, total });
      });
      this.report({ state: 'checking', loaded: HD_TOTAL_BYTES, total: HD_TOTAL_BYTES });
      await this.ensureLoaded();
      const t0 = this.now();
      const audio = await this.generate(CHECK_SENTENCE, 1);
      const ms = this.now() - t0;
      const seconds = audio.samples.length / audio.sampleRate;
      const rtf = seconds > 0 ? Math.round((ms / (seconds * 1000)) * 100) / 100 : 99;
      const status: HdStatus = tooSlow(ms, seconds)
        ? { state: 'slow', loaded: HD_TOTAL_BYTES, total: HD_TOTAL_BYTES, rtf }
        : { state: 'ready', loaded: HD_TOTAL_BYTES, total: HD_TOTAL_BYTES, rtf };
      this.report(status);
      return status;
    } catch (e) {
      const status: HdStatus = { ...HD_OFF, state: 'error', message: errorText(e) };
      this.report(status);
      return status;
    }
  }

  /**
   * Speaks one step. Answers when playback starts, or with an error so the service worker can
   * use the system voice. A newer speak or a stop cancels this one, even while it generates.
   */
  async speak(token: string, text: string, speed: number, next: string | null, at = Infinity): Promise<SpeakReply> {
    if (at < this.lastSpeak) return { ok: false, error: 'cancelled' };
    this.lastSpeak = at;
    this.token = token;
    this.sink.stop();
    try {
      await this.ensureLoaded();
      const audio = await this.clip(text, speed);
      if (this.token !== token) return { ok: false, error: 'cancelled' };
      this.sink.play(audio, text);
      if (next) this.prefetch(next, speed);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  }

  prefetch(text: string, speed: number): void {
    void this.ensureLoaded()
      .then(() => this.clip(text, speed))
      .catch(() => undefined);
  }

  /** Stops playback, unless a newer speak was sent after this stop. */
  stop(at = Infinity): void {
    if (at < this.lastSpeak) return;
    this.token = null;
    this.sink.stop();
  }

  async remove(): Promise<void> {
    this.stop();
    this.clips.clear();
    this.loaded = null;
    await this.engine.remove();
    this.report(HD_OFF);
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = this.engine.load();
      this.loaded.catch(() => (this.loaded = null)); // try again next time
    }
    return this.loaded;
  }

  /** A cached or queued clip for this text, else a new one at the end of the queue. */
  private clip(text: string, speed: number): Promise<Audio> {
    const key = `${speed}|${text}`;
    const have = this.clips.get(key);
    if (have) {
      // Most recently used last.
      this.clips.delete(key);
      this.clips.set(key, have);
      return have;
    }
    const made = this.generate(text, speed);
    made.catch(() => this.clips.delete(key));
    this.clips.set(key, made);
    while (this.clips.size > KEEP_CLIPS) this.clips.delete(this.clips.keys().next().value!);
    return made;
  }

  /** Runs one inference at a time. */
  private generate(text: string, speed: number): Promise<Audio> {
    const run = this.queue.then(() => this.engine.synth(text, speed));
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}
