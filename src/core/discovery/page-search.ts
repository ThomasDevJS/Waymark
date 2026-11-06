/**
 * Search among the guides for one page (issue #69, D170–D172): the threshold, the caps on what
 * `guide.forPage` sends, and the small matcher the on-page `?` menu runs in the content script.
 * Pure and free of Zod and `chrome.*`, because the content script imports it.
 */

/** The search box appears from this many guides for the page, in the menu and in the panel (D170). */
export const PAGE_SEARCH_FROM = 6;
/** Caps on `guide.forPage` (D171): guides per page, title length, tags per guide and tag length. */
export const MAX_FOR_PAGE = 100;
export const MAX_FOR_PAGE_TITLE = 500;
export const MAX_FOR_PAGE_TAGS = 10;
export const MAX_FOR_PAGE_TAG = 60;
/** Tag chips shown under a page's search box (D170). */
export const MAX_PAGE_CHIPS = 3;

export interface PageGuide {
  id: string;
  title: string;
  tags: string[];
}

/** Letters that don't decompose into a base letter and a mark. */
const EXTRA: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Case- and accent-insensitive form: "Crème BRÛLÉE" → "creme brulee". */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => EXTRA[c] ?? c);
}

/** Folded words: runs of letters and digits. */
export function words(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The capped entry `guide.forPage` sends for one guide: trimmed, non-empty, de-duplicated tags. */
export function forPageEntry(g: PageGuide): PageGuide {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of g.tags) {
    const t = raw.trim().slice(0, MAX_FOR_PAGE_TAG);
    const k = fold(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    tags.push(t);
    if (tags.length >= MAX_FOR_PAGE_TAGS) break;
  }
  return { id: g.id, title: g.title.slice(0, MAX_FOR_PAGE_TITLE), tags };
}

/**
 * Guides whose title words or tags start with every typed word, and that carry every selected
 * tag; the order is kept. "inv acme" finds "Send an invoice" tagged "ACME". An empty query and
 * no tags keep every guide.
 */
export function matchPageGuides<T extends PageGuide>(guides: T[], query: string, selectedTags: string[] = []): T[] {
  const terms = words(query);
  const want = selectedTags.map(fold);
  if (!terms.length && !want.length) return guides;
  return guides.filter((g) => {
    const tagKeys = new Set(g.tags.map((t) => fold(t.trim())));
    if (!want.every((t) => tagKeys.has(t))) return false;
    const have = [...words(g.title), ...g.tags.flatMap(words)];
    return terms.every((t) => have.some((w) => w.startsWith(t)));
  });
}

/**
 * The most common tags among a page's guides, at most `max`, merged case- and accent-insensitively
 * under the first spelling seen. A tag every guide carries is left out: it would filter nothing.
 */
export function pageTagChips(guides: Pick<PageGuide, 'tags'>[], max = MAX_PAGE_CHIPS): string[] {
  const by = new Map<string, { tag: string; count: number }>();
  for (const g of guides) {
    const seen = new Set<string>();
    for (const raw of g.tags) {
      const tag = raw.trim();
      const k = fold(tag);
      if (!tag || seen.has(k)) continue;
      seen.add(k);
      const cur = by.get(k);
      if (cur) cur.count++;
      else by.set(k, { tag, count: 1 });
    }
  }
  return [...by.values()]
    .filter((c) => c.count < guides.length)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, max)
    .map((c) => c.tag);
}
