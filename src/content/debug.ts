/**
 * Content side of the debug log (D110). Off until the service worker says it is on (the reply to
 * the page's route report, or a `debug.changed` push). While off, `dlog` returns at once and never
 * calls its data function, so the recorder and player do no extra work.
 *
 * Entries are sent in batches (at most 50, every 300 ms) through `debug.log`, which the service
 * worker accepts only for this tab and frame, rate-limited. Logging never throws.
 */
import { send } from '../core/messaging/client';
import type { ContentPush } from '../core/messaging/protocol';
import { MAX_BATCH, sanitizeData, type ContentEntry } from '../core/debug/log';
import { testMark } from './test-hooks';

export const SEND_MS = 300;
/** Entries waiting to be sent; past this the oldest go (the service worker is not answering). */
const MAX_WAITING = 500;

type Src = ContentEntry['src'];
type Data = Record<string, unknown>;

let on = false;
let waiting: ContentEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function debugOn(): boolean {
  return on;
}

export function setDebug(next: boolean): void {
  if (on === next) return;
  on = next;
  testMark('debug', next ? 'on' : 'off');
  if (!next) {
    waiting = [];
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
}

/** Sends what is waiting now (also before Copy log, so the copy has the latest entries). */
export function flushDebug(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!waiting.length) return Promise.resolve();
  const batches: ContentEntry[][] = [];
  while (waiting.length) batches.push(waiting.splice(0, MAX_BATCH));
  return Promise.all(batches.map((entries) => send('debug.log', { entries }).catch(() => undefined))).then(() => undefined);
}

/**
 * Logs a decision of this frame. `data` is a function (or plain object) of signal names, scores,
 * tags and the guide's own text: never typed values or page text. Never throws.
 */
export function dlog(src: Src, ev: string, data?: Data | (() => Data)): void {
  if (!on) return;
  try {
    // The same clean-up as the service worker's: a value the schema would refuse would cost the batch.
    const d = sanitizeData(typeof data === 'function' ? data() : data);
    const entry: ContentEntry = { t: Date.now(), src, ev, ...(d ? { d } : {}) };
    waiting.push(entry);
    if (waiting.length > MAX_WAITING) waiting.splice(0, waiting.length - MAX_WAITING);
    if (waiting.length >= MAX_BATCH) void flushDebug();
    else if (timer === null) timer = setTimeout(() => void flushDebug(), SEND_MS);
  } catch {
    // logging must never break the recorder or the player
  }
}

/** Listens for the switch; returns the disposer. */
export function startDebugClient(): () => void {
  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const m = msg as ContentPush;
    if (m?.type === 'debug.changed' && typeof m.payload?.on === 'boolean') setDebug(m.payload.on);
  };
  const onHide = () => void flushDebug();
  chrome.runtime.onMessage.addListener(onMessage);
  addEventListener('pagehide', onHide);
  return () => {
    removeEventListener('pagehide', onHide);
    setDebug(false);
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // context gone
    }
  };
}
