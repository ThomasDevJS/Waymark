/**
 * Find candidates on this page (issue #97, D213): `data-*` attributes whose values look like
 * stable hooks (not generated, not data such as an email or an amount), with how many elements
 * have them and whether every value is used once. The values go to the panel to be shown, never
 * stored; a profile keeps attribute names only.
 */
import type { AttrCandidate } from '../messaging/protocol';
import { isDataLikeAttr, isGeneratedToken } from './filters';
import { DEFAULT_TEST_ID_ATTRS, GUIDE_ID_ATTR } from './selectors';
import { ATTR_NAME } from '../model/profile';

/** Elements looked at: enough for any real page, bounded for a huge one. */
export const SCAN_LIMIT = 5000;
const SKIP = new Set([...DEFAULT_TEST_ID_ATTRS, GUIDE_ID_ATTR]);

export function scanAttributes(doc: Document, limit = SCAN_LIMIT): AttrCandidate[] {
  const seen = new Map<string, { elements: number; values: Map<string, number>; generated: number }>();
  const all = doc.querySelectorAll('*');
  const n = Math.min(all.length, limit);
  for (let i = 0; i < n; i++) {
    const el = all[i]!;
    for (const a of Array.from(el.attributes)) {
      const name = a.name;
      // Waymark's own markers and the attributes it already uses are left out.
      if (!name.startsWith('data-') || name.startsWith('data-waymark') || SKIP.has(name) || !ATTR_NAME.test(name)) continue;
      const v = a.value.trim();
      if (!v || v.length > 100) continue;
      let e = seen.get(name);
      if (!e) seen.set(name, (e = { elements: 0, values: new Map(), generated: 0 }));
      e.elements++;
      if (isGeneratedToken(v) || isDataLikeAttr(v)) e.generated++;
      else e.values.set(v, (e.values.get(v) ?? 0) + 1);
    }
  }
  const out: AttrCandidate[] = [];
  for (const [attr, e] of seen) {
    // Stable-looking values, on at least two elements, each value used once: a hook that tells
    // elements apart. A shared value (data-variant="primary") is no hook (review of D213).
    const unique = [...e.values.values()].every((c) => c === 1);
    if (e.elements < 2 || e.generated > e.elements / 5 || e.values.size < 2 || !unique) continue;
    out.push({ attr, elements: e.elements, unique, samples: [...e.values.keys()].slice(0, 3) });
  }
  return out.sort((a, b) => b.elements - a.elements).slice(0, 30);
}
