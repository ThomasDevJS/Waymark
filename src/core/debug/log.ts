/**
 * Debug log (issue #33, D110–D112): a ring buffer of what the recorder, matcher and player
 * decided, kept in chrome.storage.session while the Settings switch is on, and copied as plain
 * text for a chat. Pure: no chrome.* calls, so the cap, eviction, rate limit and redaction are
 * unit-tested.
 *
 * Privacy rules (docs/PRIVACY.md): no typed values, no page text beyond what the guide itself
 * stores (step titles), signal names and scores only, URLs as origin + normalized path without
 * query or fragment, session-only.
 */
import { z } from 'zod';
import { normalizePath } from '../url/url';

/** About 2,000 entries for all tabs together; the oldest go first. */
export const DEBUG_CAP = 2000;
/** A content script may add at most this many entries per tab per window... */
export const CONTENT_RATE_MAX = 100;
/** ...of this length (ms). Extra entries are dropped and counted. */
export const CONTENT_RATE_WINDOW_MS = 1000;
/** At most this many entries per `debug.log` message. */
export const MAX_BATCH = 50;
export const MAX_STRING = 200;
export const MAX_KEYS = 16;
export const MAX_LIST = 20;
/** A content script's own time is used when it is this close to the service worker's clock (D67). */
export const CLOCK_SKEW_MS = 10_000;

/** Storage key (chrome.storage.session) of the buffer, and (chrome.storage.local) of the switch. */
export const DEBUG_LOG_KEY = 'debugLog';
export const DEBUG_SETTING_KEY = 'debugSetting';

export const DEBUG_SOURCES = ['rec', 'match', 'play', 'voice', 'run', 'frame', 'page'] as const;
export type DebugSource = (typeof DEBUG_SOURCES)[number];

export type DebugValue = string | number | boolean | null | string[];
export type DebugData = Record<string, DebugValue>;

export interface DebugEntry {
  /** Sequence number, increasing; breaks ties between entries with the same time. */
  n: number;
  /** When it happened (ms since epoch). */
  at: number;
  tab: number | null;
  frame: number | null;
  /**
   * The origin of the page the entry is about: the sending frame's origin for content entries,
   * the page's origin for page loads, null for run and voice entries.
   */
  o: string | null;
  src: DebugSource;
  ev: string;
  /** Data as ordered pairs: chrome.storage sorts object keys, and the order is part of the line. */
  d?: [string, DebugValue][];
}

export interface DebugBuffer {
  seq: number;
  entries: DebugEntry[];
  /** Content entries dropped by the rate limit, for all tabs. */
  dropped: number;
  /** Rate-limit windows per tab: window start and entries in it. */
  rate: Record<string, { w: number; n: number }>;
}

export interface DebugSetting {
  on: boolean;
  /** When it was last turned on (ISO time). */
  since?: string;
}

export function emptyBuffer(): DebugBuffer {
  return { seq: 0, entries: [], dropped: 0, rate: {} };
}

/** A buffer read from storage, or a new one when it is missing or malformed. */
export function asBuffer(raw: unknown): DebugBuffer {
  const b = raw as Partial<DebugBuffer> | undefined;
  if (!b || typeof b !== 'object' || !Array.isArray(b.entries)) return emptyBuffer();
  return {
    seq: typeof b.seq === 'number' ? b.seq : 0,
    entries: b.entries.slice(-DEBUG_CAP),
    dropped: typeof b.dropped === 'number' ? b.dropped : 0,
    rate: b.rate && typeof b.rate === 'object' ? b.rate : {},
  };
}

const EVENT = /^[a-z][a-z0-9.-]{0,39}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;

/**
 * Keys that never reach the log, whoever sends them: typed values and the parts of a URL that
 * carry data. The content code never logs these; this is the second line.
 */
const DENIED_KEYS = new Set(['value', 'values', 'typed', 'password', 'query', 'search', 'hash', 'fragment', 'href', 'html', 'innerText', 'textContent']);

const valueSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.string().max(500)).max(100)]);

/** One entry from a content script (`debug.log`). Tab, frame and origin come from the sender. */
export const ContentEntrySchema = z.object({
  /** The page's time of the event (ms since epoch). */
  t: z.number(),
  src: z.enum(['rec', 'match', 'play', 'voice', 'frame']),
  ev: z.string().regex(EVENT),
  d: z
    .record(z.string().max(24), valueSchema)
    .refine((o) => Object.keys(o).length <= MAX_KEYS, `at most ${MAX_KEYS} keys`)
    .optional(),
});
export type ContentEntry = z.infer<typeof ContentEntrySchema>;

/** Origin and normalized path, without query or fragment; key-like and data-like segments become `:id`. */
export function redactUrl(href: string | undefined | null): string {
  if (!href) return '';
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return '(not a URL)';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `(${u.protocol.replace(/:$/, '')} page)`;
  return u.origin + normalizePath(u.pathname);
}

function clip(s: string, max = MAX_STRING): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * The data that may be stored: allowed keys, short strings, finite numbers, short lists. A `url`
 * or `path` is redacted to origin + normalized path.
 */
export function sanitizeData(d: Record<string, unknown> | undefined): DebugData | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const out: DebugData = {};
  let n = 0;
  for (const [k, v] of Object.entries(d)) {
    if (n >= MAX_KEYS) break;
    if (!KEY.test(k) || DENIED_KEYS.has(k)) continue;
    let val: DebugValue | undefined;
    if (v === null || typeof v === 'boolean') val = v;
    else if (typeof v === 'number') val = Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    else if (typeof v === 'string') {
      if (k === 'url') val = redactUrl(v);
      else if (k === 'path') val = v.startsWith('/') ? normalizePath(v.split(/[?#]/)[0]!) : clip(v);
      else val = clip(v);
    } else if (Array.isArray(v)) val = v.slice(0, MAX_LIST).map((x) => clip(String(x), 60));
    if (val === undefined) continue;
    out[k] = val;
    n++;
  }
  return n ? out : undefined;
}

export interface NewEntry {
  at: number;
  tab: number | null;
  frame: number | null;
  o: string | null;
  src: DebugSource;
  ev: string;
  d?: Record<string, unknown> | undefined;
  /** From a content script: subject to the per-tab rate limit. */
  content?: boolean;
}

/**
 * Appends entries to the ring, newest last, evicting the oldest past `cap`. Content entries over
 * the per-tab rate are dropped and counted. Mutates and returns the buffer.
 */
export function appendEntries(buf: DebugBuffer, items: NewEntry[], now: number, cap = DEBUG_CAP): DebugBuffer {
  for (const it of items) {
    if (it.content && it.tab !== null) {
      const key = String(it.tab);
      const r = buf.rate[key];
      if (!r || now - r.w >= CONTENT_RATE_WINDOW_MS || now < r.w) buf.rate[key] = { w: now, n: 1 };
      else if (r.n >= CONTENT_RATE_MAX) {
        buf.dropped++;
        continue;
      } else r.n++;
    }
    if (!EVENT.test(it.ev)) continue;
    const d = sanitizeData(it.d);
    const e: DebugEntry = { n: ++buf.seq, at: it.at, tab: it.tab, frame: it.frame, o: it.o, src: it.src, ev: it.ev };
    if (d) e.d = Object.entries(d);
    buf.entries.push(e);
  }
  if (buf.entries.length > cap) buf.entries.splice(0, buf.entries.length - cap);
  return buf;
}

/** The content script's event time, if it is plausible; else the service worker's (D67). */
export function entryTime(pageTime: number, now: number): number {
  return Number.isFinite(pageTime) && Math.abs(pageTime - now) <= CLOCK_SKEW_MS ? pageTime : now;
}

/** Forgets a closed tab's rate-limit window (its entries stay until evicted or cleared). */
export function forgetTab(buf: DebugBuffer, tabId: number): void {
  delete buf.rate[String(tabId)];
}

function fmtValue(v: DebugValue): string {
  if (Array.isArray(v)) return v.length ? v.join(',') : '-';
  if (v === null) return '-';
  if (typeof v === 'string') return v === '' ? '""' : /[\s"=]/.test(v) ? JSON.stringify(v) : v;
  return String(v);
}

/** `12:03:04.512 tab 12 f0 match found score=82 …` (UTC time of day). */
export function formatEntry(e: DebugEntry): string {
  const time = new Date(e.at).toISOString().slice(11, 23);
  const where = `${e.tab === null ? 'tab -' : `tab ${e.tab}`} f${e.frame ?? '-'}`;
  const data = Array.isArray(e.d) ? e.d.map(([k, v]) => `${k}=${fmtValue(v)}`) : [];
  return [time, where, e.src.padEnd(5), e.ev, ...data].join(' ');
}

/** Entries oldest first (newest last), by time, then by arrival. */
export function sortEntries(entries: DebugEntry[]): DebugEntry[] {
  return [...entries].sort((a, b) => a.at - b.at || a.n - b.n);
}

/** The plain-text log: header lines, a separator, then one line per entry, newest last. */
export function formatLog(header: string[], entries: DebugEntry[]): string {
  const lines = sortEntries(entries).map(formatEntry);
  return [...header, '---', ...(lines.length ? lines : ['(no entries)'])].join('\n') + '\n';
}

/** "Chrome 142.0.7444.59" from user-agent data, or from the user-agent string. */
export function browserName(
  ua: string,
  brands?: { brand: string; version: string }[] | null,
): string {
  const real = (brands ?? []).filter((b) => !/not.?a.?brand/i.test(b.brand));
  const named = real.find((b) => b.brand !== 'Chromium') ?? real[0];
  const edge = /Edg\/([\d.]+)/.exec(ua);
  const opera = /OPR\/([\d.]+)/.exec(ua);
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (edge) return `Microsoft Edge ${edge[1]}`;
  if (opera) return `Opera ${opera[1]}`;
  const version = chrome?.[1] ?? named?.version ?? '?';
  if (named) return `${named.brand} ${named.version.includes('.') ? named.version : version}`;
  return chrome ? `Chromium-based ${version}` : clip(ua, 120);
}
