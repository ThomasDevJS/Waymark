/**
 * Tag filter chips in the library (D102). Pure, so the panel and unit tests share it.
 */
import type { GuideIndexEntry } from '../storage/guides';

/** Chips shown at most; the rest are still found by search. */
export const MAX_TAG_CHIPS = 30;

/** Tags by how many guides use them (then by name), case-insensitively merged under the first spelling seen. */
export function tagChips(entries: Pick<GuideIndexEntry, 'tags'>[]): { tag: string; count: number }[] {
  const by = new Map<string, { tag: string; count: number }>();
  for (const e of entries) {
    const seen = new Set<string>();
    for (const raw of e.tags) {
      const tag = raw.trim();
      const k = tag.toLocaleLowerCase();
      if (!tag || seen.has(k)) continue;
      seen.add(k);
      const cur = by.get(k);
      if (cur) cur.count++;
      else by.set(k, { tag, count: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, MAX_TAG_CHIPS);
}

/** Guides that carry every selected tag (case-insensitive). No selection keeps all. */
export function withTags<T extends Pick<GuideIndexEntry, 'tags'>>(entries: T[], selected: string[]): T[] {
  if (!selected.length) return entries;
  const want = selected.map((t) => t.toLocaleLowerCase());
  return entries.filter((e) => {
    const has = new Set(e.tags.map((t) => t.trim().toLocaleLowerCase()));
    return want.every((t) => has.has(t));
  });
}

/** Tags typed as "billing, onboarding": trimmed, de-duplicated, within the guide schema's limits. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(',')) {
    const t = part.trim().slice(0, 100);
    const k = t.toLocaleLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 50);
}

/** The "Start from step" choices, from the index's step titles (one per line, possibly cut short). */
export function stepChoices(entry: Pick<GuideIndexEntry, 'steps' | 'stepTitles'>): { index: number; label: string }[] {
  const titles = entry.stepTitles ? entry.stepTitles.split('\n') : [];
  return Array.from({ length: entry.steps }, (_, i) => ({ index: i, label: `${i + 1}. ${titles[i]?.trim() || `Step ${i + 1}`}` }));
}
