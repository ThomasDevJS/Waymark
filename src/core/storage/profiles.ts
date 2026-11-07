/**
 * Site profiles in storage.local (issue #97, D213): the author's own per site (`siteProfiles`)
 * and the team library's (`libraryProfiles`, replaced on every library refresh). Which applies
 * depends on the guide: a team guide uses the library's profile for that site, an own guide the
 * own one; each falls back to the other when its own is missing.
 */
import { SiteProfileSchema, urlOptionsOf, type SiteProfile } from '../model/profile';
import type { UrlOptions } from '../url/url';

export const LOCAL_PROFILES_KEY = 'siteProfiles';
export const LIBRARY_PROFILES_KEY = 'libraryProfiles';
/** Sites with a profile, per store: a cap for storage and for what a pack can carry. */
export const MAX_PROFILES = 200;

export type ProfileMap = Record<string, SiteProfile>;

export interface Profiles {
  local: ProfileMap;
  library: ProfileMap;
}

/** A stored map, validated: entries that don't parse are dropped. */
export function readProfileMap(raw: unknown): ProfileMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: ProfileMap = {};
  for (const [origin, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_PROFILES)) {
    const p = SiteProfileSchema.safeParse(v);
    if (p.success && p.data.origin === origin) out[origin] = p.data;
  }
  return out;
}

export async function loadProfiles(): Promise<Profiles> {
  const got = await chrome.storage.local.get([LOCAL_PROFILES_KEY, LIBRARY_PROFILES_KEY]);
  return { local: readProfileMap(got[LOCAL_PROFILES_KEY]), library: readProfileMap(got[LIBRARY_PROFILES_KEY]) };
}

export type GuideSource = 'local' | 'library';

/** The profile for a site and a guide's source: its own store first, then the other. */
export function profileFor(p: Profiles, origin: string | null | undefined, source: GuideSource = 'local'): SiteProfile | null {
  if (!origin) return null;
  const [first, second] = source === 'library' ? [p.library, p.local] : [p.local, p.library];
  return first[origin] ?? second[origin] ?? null;
}

/** URL options (hash routing, kept query keys) for a URL's site and a guide's source. */
export function urlOptionsFor(p: Profiles, url: string | null | undefined, source: GuideSource = 'local'): UrlOptions {
  let origin: string | null = null;
  try {
    origin = url ? new URL(url).origin : null;
  } catch {
    origin = null;
  }
  return urlOptionsOf(profileFor(p, origin, source));
}

export const NO_PROFILES: Profiles = { local: {}, library: {} };
