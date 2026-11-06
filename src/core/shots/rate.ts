/**
 * Chrome allows about two captureVisibleTab calls per second per extension (D183). Captures go
 * through this queue: one at a time, at least `gapMs` apart. Recording never waits for it. When
 * steps come faster than that, at most `maxPending` wait; the oldest waiting one is dropped
 * (that step simply has no screenshot).
 *
 * The queue lives in the service worker's memory, unlike the rest of its state: losing it when
 * the worker stops only skips best-effort images, and a stored queue would cost a write per step.
 */
export interface CaptureQueueOptions {
  gapMs?: number;
  maxPending?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const CAPTURE_GAP_MS = 550;
export const MAX_PENDING = 3;

export type Dropped = { dropped: true };
export const DROPPED: Dropped = { dropped: true };

interface Job {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
}

export interface CaptureQueue {
  /** Runs `job` when its turn comes; resolves with its result, or DROPPED if it was skipped. */
  push<T>(job: () => Promise<T>): Promise<T | Dropped>;
  /** Waiting jobs (not counting one that runs). */
  pending(): number;
}

export function createCaptureQueue(opts: CaptureQueueOptions = {}): CaptureQueue {
  const gap = opts.gapMs ?? CAPTURE_GAP_MS;
  const max = Math.max(1, opts.maxPending ?? MAX_PENDING);
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waiting: Job[] = [];
  let running = false;
  let lastStart = -Infinity;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (waiting.length) {
        const wait = lastStart + gap - now();
        if (wait > 0) await sleep(wait);
        const job = waiting.shift();
        if (!job) break;
        lastStart = now();
        try {
          job.resolve(await job.run());
        } catch {
          // a failed capture never stops the queue
          job.resolve(DROPPED);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    push<T>(run: () => Promise<T>): Promise<T | Dropped> {
      return new Promise((resolve) => {
        waiting.push({ run, resolve: resolve as (v: unknown) => void });
        while (waiting.length > max) waiting.shift()!.resolve(DROPPED);
        void drain();
      });
    },
    pending: () => waiting.length,
  };
}

/**
 * Spaces the captureVisibleTab calls themselves (review fix, D183): a job first waits for the
 * page to hide Waymark, so spacing job starts alone can put two calls closer than Chrome allows.
 */
export function createCallSpacer(gapMs: number, now: () => number = () => Date.now(), sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let last = -Infinity;
  return async (): Promise<void> => {
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
}
