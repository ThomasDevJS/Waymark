/**
 * Which granted sites are guide sites (D80). A team library's site may be granted only so the
 * service worker can fetch the pack (no CORS headers). Such a site is "fetch-only": it gets no
 * content script and the panel does not call it allowed, until the user allows it there.
 */
import { enqueue } from '../core/storage/queue';
import { originToMatchPattern } from '../core/url/url';

const FETCH_ONLY_KEY = 'fetchOnlyOrigins';

/** Match patterns of sites granted only for fetching the library. */
export async function fetchOnlyPatterns(): Promise<string[]> {
  const v = (await chrome.storage.local.get(FETCH_ONLY_KEY))[FETCH_ONLY_KEY];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Marks or clears a site (an origin) as fetch-only. */
export function setFetchOnly(origin: string, on: boolean): Promise<void> {
  const pattern = originToMatchPattern(origin);
  return enqueue(async () => {
    const list = new Set(await fetchOnlyPatterns());
    if (on) list.add(pattern);
    else list.delete(pattern);
    await chrome.storage.local.set({ [FETCH_ONLY_KEY]: [...list].sort() });
  });
}

/** Granted and not fetch-only: Waymark may run on this site. */
export async function siteAllowed(origin: string): Promise<boolean> {
  let pattern: string;
  try {
    pattern = originToMatchPattern(origin);
    if (!(await chrome.permissions.contains({ origins: [pattern] }))) return false;
  } catch {
    return false;
  }
  return !(await fetchOnlyPatterns()).includes(pattern);
}
