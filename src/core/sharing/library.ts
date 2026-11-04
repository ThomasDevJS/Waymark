/** Library URLs (SPEC: Sharing, "static HTTPS pack file"). */

/** https only; plain http only for local development hosts. */
export function libraryUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}
