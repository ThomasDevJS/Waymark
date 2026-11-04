/** Which guides are offered on a page (SPEC: Discovery and hints; Data model, UrlRule). */
import type { Guide, UrlRule } from '../model/schema';
import { urlMatches } from '../url/url';

export interface Offerable {
  appOrigins: string[];
  matchUrls: UrlRule[];
}

/** A guide is offered on a URL whose origin is in appOrigins and whose path matches a matchUrls rule. */
export function guideMatchesUrl(g: Offerable, url: string): boolean {
  return g.matchUrls.some((rule) => urlMatches(rule, url, g.appOrigins));
}

export function guidesForUrl<G extends Offerable>(guides: G[], url: string): G[] {
  return guides.filter((g) => guideMatchesUrl(g, url));
}

/** Badge text: REC while recording (it takes precedence), else the count of guides for the page. */
export function badgeText(recording: boolean, count: number): string {
  if (recording) return 'REC';
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export type { Guide };
