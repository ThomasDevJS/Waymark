/** Library URLs (SPEC: Sharing, "static HTTPS pack file"). */
import { MAX_PACK_BYTES } from './pack';
import { isDriveAddress } from './drive';

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
    if (!res.ok)
      throw new Error(
        isDriveAddress(url) && (res.status === 404 || res.status === 403)
          ? `Google Drive answered ${res.status}: the file is not there, or not shared. Check the link, and share the file as “Anyone with the link”.`
          : `The library answered ${res.status}.`,
      );
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
    const text = new TextDecoder().decode(all);
    // A web page instead of the file: a sign-in page, Drive's sharing or virus-scan page, an error
    // page that still answered 200 (D157). Said plainly instead of a JSON parse error.
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html') || text.trimStart().startsWith('<')) {
      throw new Error(
        isDriveAddress(url)
          ? 'Google Drive answered with a web page, not the file. In Drive, share the file as “Anyone with the link”, then Refresh.'
          : 'The address answered with a web page, not a Waymark guide file. Use the address of the .waymark.json file itself.',
      );
    }
    return text;
  } catch (e) {
    if (ac.signal.aborted) throw new Error('The library did not answer in time.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
