/** Which guides are offered on a page (SPEC: Discovery and hints; Data model, UrlRule). */
import type { Guide, UrlRule } from '../model/schema';
import { urlMatches } from '../url/url';
import { NO_PROFILES, urlOptionsFor, type Profiles } from '../storage/profiles';

export interface Offerable {
  appOrigins: string[];
  matchUrls: UrlRule[];
  /** Picks the site profile whose URL options apply (D213); own guides when absent. */
  source?: 'local' | 'library';
}

/**
 * A guide is offered on a URL whose origin is in appOrigins and whose path matches a matchUrls
 * rule, read with the site's profile (hash routing, kept query keys, D213).
 */
export function guideMatchesUrl(g: Offerable, url: string, profiles: Profiles = NO_PROFILES): boolean {
  const opts = urlOptionsFor(profiles, url, g.source);
  return g.matchUrls.some((rule) => urlMatches(rule, url, g.appOrigins, opts));
}

export function guidesForUrl<G extends Offerable>(guides: G[], url: string, profiles: Profiles = NO_PROFILES): G[] {
  return guides.filter((g) => guideMatchesUrl(g, url, profiles));
}

/** Badge text: REC while recording (it takes precedence), else the count of guides for the page. */
export function badgeText(recording: boolean, count: number): string {
  if (recording) return 'REC';
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export type { Guide };
