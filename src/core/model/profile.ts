import { z } from 'zod';

/**
 * Per-site profile (SPEC: Element targeting, "Per-site profiles"; UI and loading: issue #97, D213).
 * Attribute names and patterns only, never values from a page. Every list is capped, so a profile
 * from a pack or a team library stays small and cheap to apply.
 */
export const MAX_STABLE_ATTRIBUTES = 10;
export const MAX_IGNORE_PATTERNS = 20;
export const MAX_KEEP_QUERY_KEYS = 20;
export const MAX_PATTERN_LENGTH = 100;

/** An attribute name a page could use as a stable hook: `data-qa`, `data-test-id`, `aria-controls`. */
export const ATTR_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/;
/**
 * An ignore pattern: a wildcard (`*` = any run of characters), optionally for one attribute
 * (`id=gen-*`). Never a regular expression: a page's tokens are matched in linear-ish time, so a
 * pattern can't hang the page (catastrophic backtracking). Printable characters only.
 */
export const IGNORE_PATTERN = /^(?:[a-z][a-z0-9_.:-]{0,63}=)?[^\s=]{1,100}$/;
export const QUERY_KEY = /^[A-Za-z0-9_.[\]-]{1,64}$/;

export const SiteProfileSchema = z.object({
  origin: z.string().max(500),
  stableAttributes: z.array(z.string().regex(ATTR_NAME)).max(MAX_STABLE_ATTRIBUTES).default([]),
  ignorePatterns: z.array(z.string().max(MAX_PATTERN_LENGTH + 65).regex(IGNORE_PATTERN)).max(MAX_IGNORE_PATTERNS).default([]),
  hashRouting: z.boolean().default(false),
  keepQueryKeys: z.array(z.string().regex(QUERY_KEY)).max(MAX_KEEP_QUERY_KEYS).default([]),
});
export type SiteProfile = z.infer<typeof SiteProfileSchema>;

/** A compiled ignore pattern: tests a token, for one attribute or for all. */
export interface TokenMatcher {
  attr?: string;
  test(token: string): boolean;
}

export interface ProfileOptions {
  stableAttributes?: string[];
  ignorePatterns?: TokenMatcher[];
  hashRouting?: boolean;
  keepQueryKeys?: string[];
}

/**
 * Wildcard match, `*` = any run of characters, whole token, case-sensitive. The classic greedy
 * algorithm with one backtrack point: at most O(token × pattern) steps, never exponential.
 */
export function wildcardMatch(pattern: string, s: string): boolean {
  let p = 0;
  let i = 0;
  let star = -1;
  let mark = 0;
  while (i < s.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === s[i]) {
      p++;
      i++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = i;
    } else if (star >= 0) {
      p = star + 1;
      i = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/** `id=gen-*` → for the `id` attribute only; `gen-*` → for every token. */
export function compilePattern(src: string): TokenMatcher | null {
  if (!IGNORE_PATTERN.test(src) || src.length > MAX_PATTERN_LENGTH + 65) return null;
  const eq = src.indexOf('=');
  const attr = eq > 0 ? src.slice(0, eq) : undefined;
  const glob = eq > 0 ? src.slice(eq + 1) : src;
  // A pattern of stars alone would ignore every token: refused.
  if (!glob.replace(/\*/g, '')) return null;
  return { ...(attr ? { attr } : {}), test: (t: string) => wildcardMatch(glob, t) };
}

/** Why a profile field is refused, in plain words for the panel; null when it is fine. */
export function profileProblem(p: Pick<SiteProfile, 'stableAttributes' | 'ignorePatterns' | 'keepQueryKeys'>): string | null {
  if (p.stableAttributes.length > MAX_STABLE_ATTRIBUTES) return `At most ${MAX_STABLE_ATTRIBUTES} stable attributes.`;
  const badAttr = p.stableAttributes.find((a) => !ATTR_NAME.test(a));
  if (badAttr !== undefined) return `“${badAttr}” is not an attribute name. Use lowercase letters, digits and - _ . : (for example data-qa).`;
  if (p.ignorePatterns.length > MAX_IGNORE_PATTERNS) return `At most ${MAX_IGNORE_PATTERNS} ignore patterns.`;
  const badPattern = p.ignorePatterns.find((x) => !compilePattern(x));
  if (badPattern !== undefined) return `“${badPattern}” is not a pattern Waymark can use. Write text with * for any characters, optionally after an attribute name and = (for example id=gen-*).`;
  if (p.keepQueryKeys.length > MAX_KEEP_QUERY_KEYS) return `At most ${MAX_KEEP_QUERY_KEYS} query keys.`;
  const badKey = p.keepQueryKeys.find((k) => !QUERY_KEY.test(k));
  if (badKey !== undefined) return `“${badKey}” is not a query key.`;
  return null;
}

export function compileProfile(p: SiteProfile | null | undefined): ProfileOptions {
  if (!p) return {};
  const ignorePatterns = p.ignorePatterns.map(compilePattern).filter((m): m is TokenMatcher => m !== null);
  return {
    stableAttributes: p.stableAttributes,
    ignorePatterns,
    hashRouting: p.hashRouting,
    keepQueryKeys: p.keepQueryKeys,
  };
}

/** The URL options of a profile (hash routing, kept query keys), for step URL rules and matching. */
export function urlOptionsOf(p: Pick<SiteProfile, 'hashRouting' | 'keepQueryKeys'> | null | undefined): { hashRouting?: boolean; keepQueryKeys?: string[] } {
  if (!p) return {};
  return { ...(p.hashRouting ? { hashRouting: true } : {}), ...(p.keepQueryKeys.length ? { keepQueryKeys: p.keepQueryKeys } : {}) };
}

/** True when two profiles apply the same way (order of entries aside). */
export function sameProfile(a: SiteProfile, b: SiteProfile): boolean {
  const s = (x: string[]) => JSON.stringify([...x].sort());
  return a.hashRouting === b.hashRouting && s(a.stableAttributes) === s(b.stableAttributes) && s(a.ignorePatterns) === s(b.ignorePatterns) && s(a.keepQueryKeys) === s(b.keepQueryKeys);
}

/** A profile with nothing in it changes nothing: it is not stored or carried. */
export function isEmptyProfile(p: SiteProfile): boolean {
  return !p.hashRouting && !p.stableAttributes.length && !p.ignorePatterns.length && !p.keepQueryKeys.length;
}
