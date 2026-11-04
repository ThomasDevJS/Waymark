/**
 * Frame nonce mapping (SPEC: Recorder, "Frames and shadow DOM"). A cross-origin frame cannot
 * compute its own path, so: the parent frame asks the service worker for a nonce for one of its
 * iframes, posts it into that iframe, and the child sends it back. The service worker then maps
 * the child's frameId to (parent frameId, iframe selector). Pure logic over a key-value store.
 */
export const NONCE_TTL_MS = 30_000;
/**
 * Pending nonces kept per tab. A page can make its iframes post "hello" in a loop, and each
 * hello asks for a nonce: without a cap they would fill chrome.storage.session (D47).
 */
export const MAX_PENDING_NONCES = 32;
/**
 * Mapped frames kept per tab. A page can create and remove iframes in a loop; frames that are
 * gone are never reported, so the oldest (lowest frameId: Chromium numbers frames in order of
 * creation) are dropped first (D47).
 */
export const MAX_MAPPED_FRAMES = 64;

export interface NonceEntry {
  tabId: number;
  parentFrameId: number;
  selector: string;
  expiresAt: number;
}

export interface FrameLink {
  parentFrameId: number;
  selector: string;
}

export type FrameMap = Record<string, FrameLink>;

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** All pending nonces of one tab live under one key, so they are swept and capped together. */
export const noncesKey = (tabId: number) => `nonces:${tabId}`;
export const framesKey = (tabId: number) => `frames:${tabId}`;

type NonceTable = Record<string, NonceEntry>;

/**
 * Issues a nonce for (tab, parent frame, iframe selector). Expired nonces are dropped and at most
 * MAX_PENDING_NONCES stay pending per tab (the oldest go first). Call from inside the write queue.
 */
export async function issueNonce(kv: KV, tabId: number, parentFrameId: number, selector: string, now = Date.now()): Promise<string> {
  const nonce = crypto.randomUUID();
  const table = (await kv.get<NonceTable>(noncesKey(tabId))) ?? {};
  const live = Object.entries(table)
    .filter(([, e]) => e.expiresAt >= now)
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    .slice(-(MAX_PENDING_NONCES - 1));
  const next: NonceTable = Object.fromEntries(live);
  next[nonce] = { tabId, parentFrameId, selector, expiresAt: now + NONCE_TTL_MS };
  await kv.set(noncesKey(tabId), next);
  return nonce;
}

/**
 * Verifies and consumes a nonce. Returns false for unknown, expired, foreign-tab or self claims.
 * Nonces are looked up in the claiming tab's own table, so another tab's nonce is unknown here.
 * Call from inside the write queue.
 */
export async function claimNonce(kv: KV, nonce: string, tabId: number, frameId: number, now = Date.now()): Promise<boolean> {
  const table = (await kv.get<NonceTable>(noncesKey(tabId))) ?? {};
  if (!Object.prototype.hasOwnProperty.call(table, nonce)) return false;
  const entry = table[nonce]!;
  delete table[nonce];
  await kv.set(noncesKey(tabId), table);
  if (entry.tabId !== tabId || entry.expiresAt < now || entry.parentFrameId === frameId || frameId === 0) return false;
  const map = (await kv.get<FrameMap>(framesKey(tabId))) ?? {};
  map[String(frameId)] = { parentFrameId: entry.parentFrameId, selector: entry.selector };
  const ids = Object.keys(map).map(Number).sort((a, b) => a - b);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_MAPPED_FRAMES))) delete map[String(id)];
  await kv.set(framesKey(tabId), map);
  return true;
}

/** iframe selectors from the top frame down to `frameId`; [] for the top frame; null when unknown. */
export function framePathFor(map: FrameMap, frameId: number): string[] | null {
  const path: string[] = [];
  let id = frameId;
  const seen = new Set<number>();
  while (id !== 0) {
    if (seen.has(id)) return null;
    seen.add(id);
    const link = map[String(id)];
    if (!link) return null;
    path.unshift(link.selector);
    id = link.parentFrameId;
  }
  return path;
}
