/** Client-side guide search (SPEC: Discovery: title, description, tags and step titles; MiniSearch). */
import MiniSearch from 'minisearch';
import type { GuideIndexEntry } from '../storage/guides';
import { fold, matchPageGuides } from './page-search';

/** What search reads: an index entry (D49), never the full guide. */
export type Searchable = Pick<GuideIndexEntry, 'id' | 'title' | 'description' | 'tags' | 'stepTitles'>;

interface Doc {
  id: string;
  title: string;
  description: string;
  tags: string;
  steps: string;
}

export function buildSearch(guides: Searchable[]): MiniSearch<Doc> {
  const ms = new MiniSearch<Doc>({
    fields: ['title', 'description', 'tags', 'steps'],
    storeFields: ['id'],
    // Case- and accent-insensitive, like the ? menu (D172): "creme" finds "Crème".
    processTerm: (term) => fold(term) || null,
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2 },
  });
  ms.addAll(
    guides.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description ?? '',
      tags: g.tags.join(' '),
      steps: g.stepTitles,
    })),
  );
  return ms;
}

/** Guide ids matching a query, best first; every id for an empty query. */
export function searchGuides(ms: MiniSearch<Doc>, guides: { id: string }[], query: string): string[] {
  const q = query.trim();
  if (!q) return guides.map((g) => g.id);
  return ms.search(q).map((r) => String(r.id));
}

/**
 * The "For this page" filter in the panel (D170): the library's index, but every typed word must
 * match (as in the ? menu), and selected tags compare without case or accents (as the chips merge
 * them). Best match first; with no query, the page's order.
 */
export function searchPage<T extends Searchable>(ms: MiniSearch<Doc>, pageGuides: T[], query: string, tags: string[]): T[] {
  const q = query.trim();
  let out = pageGuides;
  if (q) {
    const byId = new Map(pageGuides.map((g) => [g.id, g]));
    out = ms
      .search(q, { combineWith: 'AND' })
      .map((r) => byId.get(String(r.id)))
      .filter((g): g is T => !!g);
  }
  return matchPageGuides(out, '', tags);
}
