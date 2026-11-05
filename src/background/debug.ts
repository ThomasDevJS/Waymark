/**
 * Service worker side of the debug log (issue #33, D110–D112).
 *
 * - `dlog()` is what the service worker's own code calls. When the Settings switch is off it
 *   returns at once: no data is built (pass a function) and nothing is stored.
 * - Entries wait a moment in memory and are written in one batch, on a queue of their own: the
 *   write never waits behind, or delays, the main write queue that orders recording and runs
 *   (D67). The buffer is the only key it touches. An entry still waiting when the browser stops
 *   the service worker is lost; that is acceptable for a debug log.
 * - The switch is cached here and follows chrome.storage.onChanged; storage stays the source.
 * - Logging never throws into the caller.
 */
import type { Handlers, HandlerContext } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import {
  CONTENT_RATE_MAX,
  appendEntries,
  asBuffer,
  browserName,
  DEBUG_CAP,
  DEBUG_LOG_KEY,
  DEBUG_SETTING_KEY,
  emptyBuffer,
  entryTime,
  forgetTab,
  formatLog,
  type ContentEntry,
  type DebugBuffer,
  type DebugEntry,
  type DebugSetting,
  type DebugSource,
  type NewEntry,
} from '../core/debug/log';
import { currentStep, type Run } from '../core/player/run';

export const FLUSH_MS = 250;

let enabled: boolean | null = null;
let init: Promise<boolean> | null = null;
let pending: NewEntry[] = [];
/** Content entries dropped before they were written (a page sending faster than the rate). */
let pendingDropped = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let tail: Promise<unknown> = Promise.resolve();

/** The debug log's own write queue (never the main one). */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

export async function getDebugSetting(): Promise<DebugSetting> {
  try {
    const raw = (await chrome.storage.local.get(DEBUG_SETTING_KEY))[DEBUG_SETTING_KEY] as DebugSetting | undefined;
    return raw && typeof raw.on === 'boolean' ? raw : { on: false };
  } catch {
    return { on: false };
  }
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== 'local' || !(DEBUG_SETTING_KEY in changes)) return;
  const v = changes[DEBUG_SETTING_KEY]?.newValue as DebugSetting | undefined;
  setEnabled(!!v?.on);
}

function setEnabled(on: boolean) {
  enabled = on;
  if (!on) {
    pending = [];
    pendingDropped = 0;
  }
}

/** Reads the switch once per service worker start; later changes arrive through onChanged. */
export function debugReady(): Promise<boolean> {
  if (enabled !== null) return Promise.resolve(enabled);
  if (!init) {
    try {
      chrome.storage?.onChanged?.addListener(onStorageChanged);
    } catch {
      // no storage events (unit stubs)
    }
    init = getDebugSetting().then((s) => {
      // A change seen meanwhile through onChanged is newer than this read.
      if (enabled === null) setEnabled(s.on);
      if (enabled && pending.length) schedule();
      return enabled ?? false;
    });
  }
  return init;
}

function schedule() {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushDebug();
  }, FLUSH_MS);
}

/** Writes the waiting entries. Exported for tests and for Copy (which flushes first). */
export function flushDebug(): Promise<void> {
  return serial(async () => {
    if (!enabled || !pending.length) return;
    const batch = pending;
    const dropped = pendingDropped;
    pending = [];
    pendingDropped = 0;
    try {
      const buf = asBuffer((await chrome.storage.session.get(DEBUG_LOG_KEY))[DEBUG_LOG_KEY]);
      buf.dropped += dropped;
      appendEntries(buf, batch, Date.now());
      await chrome.storage.session.set({ [DEBUG_LOG_KEY]: buf });
    } catch {
      // storage full or gone: drop this batch
    }
  });
}

function push(e: NewEntry) {
  if (enabled === false) return;
  // Before the switch is known, entries wait (a few at most), then go or are dropped. When the
  // queue is full the new entry goes, never an older one: no sender can push others out.
  if (pending.length >= DEBUG_CAP) {
    if (e.content) pendingDropped++;
    return;
  }
  pending.push(e);
  if (enabled === null) void debugReady();
  else schedule();
}

export interface DlogWhere {
  tab?: number | null | undefined;
  frame?: number | null | undefined;
  /** The page's origin, for entries about a page (route changes, loads). */
  o?: string | null;
}

/**
 * Logs one service worker decision. `data` may be a function, called only when the log is on.
 * Never throws.
 */
export function dlog(src: DebugSource, ev: string, where: DlogWhere, data?: Record<string, unknown> | (() => Record<string, unknown>)): void {
  if (enabled === false) return;
  try {
    const d = typeof data === 'function' ? data() : data;
    push({ at: Date.now(), tab: where.tab ?? null, frame: where.frame ?? null, o: where.o ?? null, src, ev, d });
  } catch {
    // logging must never break the caller
  }
}

/** Is the log on now? (Cheap after the first call.) */
export function debugOn(): boolean {
  return enabled === true;
}

async function readBuffer(): Promise<DebugBuffer> {
  return asBuffer((await chrome.storage.session.get(DEBUG_LOG_KEY))[DEBUG_LOG_KEY]);
}

async function browserLine(): Promise<string> {
  const nav = (typeof navigator === 'undefined' ? undefined : navigator) as (Navigator & { userAgentData?: { brands?: { brand: string; version: string }[]; getHighEntropyValues?: (h: string[]) => Promise<{ fullVersionList?: { brand: string; version: string }[] }> } }) | undefined;
  let brands = nav?.userAgentData?.brands ?? null;
  try {
    const full = await nav?.userAgentData?.getHighEntropyValues?.(['fullVersionList']);
    if (full?.fullVersionList?.length) brands = full.fullVersionList;
  } catch {
    // low-entropy brands only
  }
  let os = '';
  try {
    os = (await chrome.runtime.getPlatformInfo()).os;
  } catch {
    os = '';
  }
  return `Browser: ${browserName(nav?.userAgent ?? '', brands)}${os ? ` (${os})` : ''}`;
}

function onOff(b: boolean | undefined): string {
  return b ? 'on' : 'off';
}

/**
 * The settings that change what Waymark does, as on/off facts. No URLs, no site names: the team
 * library is "on" or "off", sites are a count.
 */
async function settingsLines(): Promise<string[]> {
  const local = await chrome.storage.local.get(['voiceSettings', 'library', 'hdStatus']).catch(() => ({}) as Record<string, unknown>);
  const v = (local as Record<string, unknown>).voiceSettings as { autoPlay?: boolean; muted?: boolean; rate?: number; allowOnlineVoices?: boolean; voices?: Record<string, string> } | undefined;
  const lib = (local as Record<string, unknown>).library as { url?: string | null } | undefined;
  const hd = (local as Record<string, unknown>).hdStatus as { state?: string } | undefined;
  let sites = 0;
  try {
    sites = ((await chrome.permissions.getAll()).origins ?? []).length;
  } catch {
    sites = 0;
  }
  return [
    `Voice: read aloud ${onOff(v?.autoPlay ?? true)}, muted ${onOff(v?.muted)}, speed ${(v?.rate ?? 1).toFixed(1)}, online voices ${onOff(v?.allowOnlineVoices)}, chosen voices ${Object.keys(v?.voices ?? {}).length}, HD voice ${hd?.state ?? 'off'}`,
    `Team library: ${lib?.url ? 'subscribed' : 'none'}; site permissions: ${sites}`,
  ];
}

/** What is running at copy time: the recording and each run (step numbers and status only). */
async function stateLines(): Promise<string[]> {
  const all = await chrome.storage.session.get(null).catch(() => ({}) as Record<string, unknown>);
  const rec = (all as Record<string, unknown>).recording as { tabIds?: number[]; steps?: unknown[]; status?: string } | undefined;
  const runs: string[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('run:')) continue;
    const r = v as Run;
    const step = currentStep(r);
    runs.push(`tab ${k.slice(4)}: step ${r.stepIndex + 1} of ${r.guideSnapshot?.steps?.length ?? '?'} (${step?.kind ?? '-'}), ${r.status}`);
  }
  return [
    `Recording: ${rec ? `${rec.status ?? 'on'} in tab ${(rec.tabIds ?? []).join(', ')}, ${rec.steps?.length ?? 0} steps` : 'none'}`,
    `Runs: ${runs.length ? runs.join('; ') : 'none'}`,
  ];
}

function header(buf: DebugBuffer, entries: DebugEntry[], extra: string[]): string[] {
  return [
    'Waymark debug log',
    `Version: ${chrome.runtime.getManifest().version}`,
    ...extra,
    `Entries: ${entries.length} (the newest ${DEBUG_CAP} are kept), newest last; dropped by the rate limit: ${buf.dropped}`,
    'Times are UTC. Addresses are the site and path only. Typed values are never logged.',
  ];
}

/** The whole log for Settings → Problems → Copy debug log. */
export async function debugText(): Promise<string> {
  await flushDebug();
  const buf = await readBuffer();
  const setting = await getDebugSetting();
  const extra = [
    await browserLine(),
    `Debug log: ${setting.on ? `on since ${setting.since ?? '?'}` : 'off'}`,
    ...(await settingsLines()),
    ...(await stateLines()),
  ];
  return formatLog(header(buf, buf.entries, extra), buf.entries);
}

/**
 * The not-found card's Copy log: only the sender tab's entries since its current run started,
 * about its own site (or about the run itself), and no settings (content scripts get none,
 * docs/SECURITY.md). Null when there is nothing this page may have.
 */
export async function debugTextForTab(tabId: number, origin: string, run: Run | null): Promise<string | null> {
  if (!(await debugReady()) || !run || !run.guideSnapshot.appOrigins.includes(origin)) return null;
  await flushDebug();
  const buf = await readBuffer();
  const since = Date.parse(run.startedAt);
  const mine = buf.entries.filter((e) => e.tab === tabId && e.at >= since - 1000 && (e.o === null || e.o === origin));
  const extra = [await browserLine(), 'From the page’s Copy log: this tab since the guide started. Settings → Problems → Copy debug log has everything.'];
  return formatLog(header(buf, mine, extra), mine);
}

export async function setDebug(on: boolean): Promise<DebugSetting> {
  // Off takes effect at once, before the storage write: nothing is collected in between.
  if (!on) setEnabled(false);
  const prev = await getDebugSetting();
  const next: DebugSetting = on ? { on: true, since: prev.on && prev.since ? prev.since : new Date().toISOString() } : { on: false };
  await chrome.storage.local.set({ [DEBUG_SETTING_KEY]: next });
  setEnabled(on);
  // Every content script learns at once (others learn from their next route report).
  try {
    const tabs = await chrome.tabs.query({});
    const msg: ContentPush = { type: 'debug.changed', payload: { on } };
    for (const t of tabs) if (t.id !== undefined) chrome.tabs.sendMessage(t.id, msg).catch(() => undefined);
  } catch {
    // no tabs
  }
  if (on) dlog('run', 'debug.on', {}, { version: chrome.runtime.getManifest().version });
  return next;
}

/**
 * Empties the log. Entries still waiting in a page, or on their way, carry an earlier time and
 * are dropped when they arrive (`clearedAt`).
 */
export async function clearDebug(): Promise<void> {
  pending = [];
  pendingDropped = 0;
  const clearedAt = Date.now();
  await serial(() => chrome.storage.session.set({ [DEBUG_LOG_KEY]: { ...emptyBuffer(), clearedAt } }));
}

/** Entries from a content script, for its own tab and frame (sender, never payload). */
export async function addContentEntries(entries: ContentEntry[], ctx: HandlerContext): Promise<boolean> {
  if (ctx.tabId === undefined || !(await debugReady())) return false;
  const now = Date.now();
  const origin = ctx.sender.origin ?? null;
  // The per-tab rate applies here too, before the entries wait for the next write: a page sending
  // many batches between two writes cannot crowd out the other tabs' entries (review of D110).
  let waiting = pending.filter((p) => p.content && p.tab === ctx.tabId).length;
  for (const e of entries) {
    if (waiting >= CONTENT_RATE_MAX) {
      pendingDropped++;
      continue;
    }
    waiting++;
    push({ at: entryTime(e.t, now), tab: ctx.tabId, frame: ctx.frameId ?? null, o: origin, src: e.src, ev: e.ev, d: e.d, content: true });
  }
  return true;
}

export async function onDebugTabRemoved(tabId: number): Promise<void> {
  if (!(await debugReady())) return;
  await serial(async () => {
    const raw = (await chrome.storage.session.get(DEBUG_LOG_KEY))[DEBUG_LOG_KEY];
    if (!raw) return;
    const buf = asBuffer(raw);
    forgetTab(buf, tabId);
    await chrome.storage.session.set({ [DEBUG_LOG_KEY]: buf });
  });
}

/** Entry count for Settings. */
export async function debugStatus(): Promise<{ on: boolean; since: string | null; count: number }> {
  await flushDebug();
  const s = await getDebugSetting();
  const buf = await readBuffer();
  return { on: s.on, since: s.since ?? null, count: buf.entries.length };
}

export const debugHandlers: Handlers = {
  'debug.get': () => debugStatus(),
  'debug.set': async ({ on }) => {
    await setDebug(on);
    return debugStatus();
  },
  'debug.text': async () => ({ text: await debugText() }),
  'debug.clear': async () => {
    await clearDebug();
    return debugStatus();
  },
  'debug.log': async ({ entries }, ctx) => ({ ok: await addContentEntries(entries, ctx) }),
};

/** Test-only: resets the module's cache between unit tests. */
export function _resetDebugForTests(): void {
  enabled = null;
  init = null;
  pending = [];
  pendingDropped = 0;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  tail = Promise.resolve();
}
