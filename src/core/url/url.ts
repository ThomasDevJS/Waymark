import type { UrlRule } from '../model/schema';
import { isDataLike } from '../fingerprint/filters';

export interface UrlOptions {
  hashRouting?: boolean;
  keepQueryKeys?: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Numeric, UUID, hex and other key-like path segments become parameters. */
export function isKeyLikeSegment(seg: string): boolean {
  let s = seg;
  try {
    s = decodeURIComponent(seg);
  } catch {
    // keep raw
  }
  if (!s) return false;
  if (/^\d+$/.test(s)) return true;
  if (UUID.test(s)) return true;
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(s) && /\d/.test(s)) return true; // ULID
  if (/^[0-9a-f]{8,}$/i.test(s) && /\d/.test(s)) return true; // hex / object ids
  const digits = (s.match(/\d/g) ?? []).length;
  if (digits >= 2 && /[a-z]/i.test(s) && !/^v\d+$/i.test(s) && s.length >= 6) return true; // a8F3kL92, order-12
  if (/\d{3,}/.test(s)) return true; // slug-12345
  if (isDataLike(s)) return true; // emails, dates...
  return false;
}

/** `/orders/123/edit` -> `/orders/:id/edit`. Trailing slash removed (except root). */
export function normalizePath(pathname: string): string {
  const segs = pathname.split('/').map((seg) => (isKeyLikeSegment(seg) ? ':id' : seg));
  let out = segs.join('/');
  if (!out.startsWith('/')) out = '/' + out;
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/** The routed path of a URL: pathname, or the `#/…` part for hash-routed apps. Query keys kept only when listed. */
export function routedPath(url: URL, opts: UrlOptions = {}): string {
  let path = url.pathname;
  let search = url.search;
  if (opts.hashRouting && url.hash.startsWith('#/')) {
    const hash = url.hash.slice(1);
    const q = hash.indexOf('?');
    path = q >= 0 ? hash.slice(0, q) : hash;
    search = q >= 0 ? hash.slice(q) : '';
  }
  let out = normalizePath(path);
  const keep = opts.keepQueryKeys ?? [];
  if (keep.length) {
    const params = new URLSearchParams(search);
    const kept = keep
      .filter((k) => params.has(k))
      .map((k) => {
        const v = params.get(k) ?? '';
        return `${encodeURIComponent(k)}=${isKeyLikeSegment(v) ? ':id' : encodeURIComponent(v)}`;
      });
    if (kept.length) out += '?' + kept.join('&');
  }
  return out;
}

/** Step URL rule for the page a step was recorded on. */
export function stepUrlRule(href: string, opts: UrlOptions = {}): UrlRule {
  return { kind: 'pattern', value: routedPath(new URL(href), opts) };
}

function splitQuery(v: string): [string, string] {
  const i = v.indexOf('?');
  return i >= 0 ? [v.slice(0, i), v.slice(i + 1)] : [v, ''];
}

/** Path matching for one rule. `:name` segments match any single segment. */
export function matchPath(rule: UrlRule, path: string): boolean {
  const [rulePath, ruleQuery] = splitQuery(rule.value);
  const [actualPath, actualQuery] = splitQuery(path);
  if (rule.kind === 'prefix') {
    if (!actualPath.startsWith(rulePath)) return false;
  } else {
    const a = rulePath.split('/');
    const b = actualPath.split('/');
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const r = a[i]!;
      if (r.startsWith(':')) {
        if (!b[i]) return false;
        continue;
      }
      if (r !== b[i]) return false;
    }
  }
  if (ruleQuery) {
    const want = new URLSearchParams(ruleQuery);
    const have = new URLSearchParams(actualQuery);
    for (const [k, v] of want) {
      if (!have.has(k)) return false;
      if (v !== ':id' && have.get(k) !== v) return false;
    }
  }
  return true;
}

/** A URL matches when its origin is in appOrigins AND its path matches the rule. */
export function urlMatches(rule: UrlRule, href: string, appOrigins: string[], opts: UrlOptions = {}): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (!appOrigins.includes(url.origin)) return false;
  return matchPath(rule, routedPath(url, opts));
}

/** Normalized link path for a fingerprint: path only for same-origin links, origin + path otherwise. */
export function linkPath(href: string, base: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const path = normalizePath(url.pathname);
  return url.origin === new URL(base).origin ? path : url.origin + path;
}

/** Match pattern covering a whole origin, as used by chrome.permissions and registerContentScripts. */
export function originToMatchPattern(origin: string): string {
  const u = new URL(origin);
  return `${u.protocol}//${u.hostname}/*`;
}
