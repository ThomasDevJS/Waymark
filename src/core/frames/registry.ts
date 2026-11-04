/**
 * Frame nonce mapping (SPEC: Recorder, "Frames and shadow DOM"). A cross-origin frame cannot
 * compute its own path, so: the parent frame asks the service worker for a nonce for one of its
 * iframes, posts it into that iframe, and the child sends it back. The service worker then maps
 * the child's frameId to (parent frameId, iframe selector). Pure logic over a key-value store.
 */
export const NONCE_TTL_MS = 30_000;

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

const nonceKey = (n: string) => `nonce:${n}`;
export const framesKey = (tabId: number) => `frames:${tabId}`;

export async function issueNonce(kv: KV, tabId: number, parentFrameId: number, selector: string, now = Date.now()): Promise<string> {
  const nonce = crypto.randomUUID();
  const entry: NonceEntry = { tabId, parentFrameId, selector, expiresAt: now + NONCE_TTL_MS };
  await kv.set(nonceKey(nonce), entry);
  return nonce;
}

/** Verifies and consumes a nonce. Returns false for unknown, expired, foreign-tab or self claims. */
export async function claimNonce(kv: KV, nonce: string, tabId: number, frameId: number, now = Date.now()): Promise<boolean> {
  const entry = await kv.get<NonceEntry>(nonceKey(nonce));
  if (!entry) return false;
  await kv.remove(nonceKey(nonce));
  if (entry.tabId !== tabId || entry.expiresAt < now || entry.parentFrameId === frameId || frameId === 0) return false;
  const map = (await kv.get<FrameMap>(framesKey(tabId))) ?? {};
  map[String(frameId)] = { parentFrameId: entry.parentFrameId, selector: entry.selector };
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
