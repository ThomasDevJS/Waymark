/** Library URLs (SPEC: Sharing, "static HTTPS pack file"). */
import { MAX_PACK_BYTES } from './pack';

/** https only; plain http only for local development hosts. */
export function libraryUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

/** A library that does not answer within this time fails the refresh (D48). */
export const LIBRARY_TIMEOUT_MS = 30_000;

/**
 * Fetches the library pack as text. The library server is untrusted (D48): the answer is read
 * in chunks and abandoned as soon as it passes the 5 MB pack cap, the whole fetch is limited
 * in time, and a redirect must still land on an allowed URL (https, or http on localhost).
 */
export async function fetchLibraryText(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = LIBRARY_TIMEOUT_MS): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', signal: ac.signal });
    if (res.url && !libraryUrlAllowed(res.url)) throw new Error('The library redirected to an address that is not https://.');
    if (!res.ok) throw new Error(`The library answered ${res.status}.`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_PACK_BYTES) throw new Error('This pack is larger than 5 MB.');
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PACK_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error('This pack is larger than 5 MB.');
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return new TextDecoder().decode(all);
  } catch (e) {
    if (ac.signal.aborted) throw new Error('The library did not answer in time.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
