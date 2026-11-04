/** Client-side guide search (SPEC: Discovery: title, description, tags and step titles; MiniSearch). */
import MiniSearch from 'minisearch';
import type { Guide } from '../model/schema';
import { toPlainText } from '../text/markdown';

interface Doc {
  id: string;
  title: string;
  description: string;
  tags: string;
  steps: string;
}

export function buildSearch(guides: Guide[]): MiniSearch<Doc> {
  const ms = new MiniSearch<Doc>({
    fields: ['title', 'description', 'tags', 'steps'],
    storeFields: ['id'],
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2 },
  });
  ms.addAll(
    guides.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description ?? '',
      tags: g.tags.join(' '),
      steps: g.steps.map((s) => toPlainText(s.title)).join(' \n '),
    })),
  );
  return ms;
}

/** Guide ids matching a query, best first; every id for an empty query. */
export function searchGuides(ms: MiniSearch<Doc>, guides: Guide[], query: string): string[] {
  const q = query.trim();
  if (!q) return guides.map((g) => g.id);
  return ms.search(q).map((r) => String(r.id));
}
