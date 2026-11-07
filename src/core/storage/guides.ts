/**
 * Guide repository (SPEC: Data model, "Storage"): one key per guide plus an index, all writes
 * through the service worker's queue so a guide and the index never disagree.
 */
import { GuideSchema, type Guide, type UrlRule } from '../model/schema';
import { toPlainText } from '../text/markdown';
import { enqueue } from './queue';
import { liveTrash, TRASH_KEY } from './trash';
import { pruneStats, readCounts, readStats, STATS_INDEX_KEY, statsKey, withCount } from '../stats/plays';

/**
 * One line per guide: everything the badge, "For this page", the side panel list and search,
 * and the import rules need, so none of them reads full guides (D49). A few hundred guides of
 * 50 steps are about 20 MB; their index is well under 1 MB.
 */
export interface GuideIndexEntry {
  id: string;
  revisionId: string;
  forkedFrom?: { guideId: string; revisionId: string };
  title: string;
  description?: string;
  tags: string[];
  startUrl: string;
  updatedAt: string;
  appOrigins: string[];
  /** Pages where the guide is offered (badge, "For this page", launcher). */
  matchUrls: UrlRule[];
  source: 'local' | 'library';
  steps: number;
  /** Step titles as plain text, one per line, for search (capped). */
  stepTitles: string;
}

/** Index caps (D49): search text per step and per guide, and the description kept for search. */
export const MAX_STEP_TITLE = 80;
export const MAX_STEP_TITLES = 20_000;
export const MAX_INDEX_DESCRIPTION = 1000;
export const MAX_INDEX_TAGS = 20;

export const INDEX_KEY = 'guides:index';
export const guideKey = (id: string) => `guide:${id}`;

export function indexEntry(g: Guide): GuideIndexEntry {
  const e: GuideIndexEntry = {
    id: g.id,
    revisionId: g.revisionId,
    title: g.title,
    tags: g.tags.slice(0, MAX_INDEX_TAGS),
    startUrl: g.startUrl,
    updatedAt: g.updatedAt,
    appOrigins: g.appOrigins,
    matchUrls: g.matchUrls,
    source: g.source,
    steps: g.steps.length,
    // Each title is cut, not the joined text, so a long guide keeps every step searchable.
    // One line per step: a title typed with line breaks must not shift the lines after it (D101).
    stepTitles: g.steps.map((s) => toPlainText(s.title).replace(/\s+/g, ' ').trim().slice(0, MAX_STEP_TITLE)).join('\n').slice(0, MAX_STEP_TITLES),
  };
  if (g.forkedFrom) e.forkedFrom = g.forkedFrom;
  if (g.description) e.description = g.description.slice(0, MAX_INDEX_DESCRIPTION);
  return e;
}

/**
 * The stored index. An index written by an older version (no `revisionId`) is rebuilt from the
 * stored guides on first read, even if the rebuild at install or update was missed. This does
 * not go through the write queue, because callers may already be inside it; it happens once.
 */
async function readIndex(): Promise<GuideIndexEntry[]> {
  const raw = ((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] as Partial<GuideIndexEntry>[] | undefined) ?? [];
  if (raw.every((e) => typeof e.revisionId === 'string' && typeof e.stepTitles === 'string')) return raw as GuideIndexEntry[];
  const index = (await allGuides()).map(indexEntry);
  await chrome.storage.local.set({ [INDEX_KEY]: index });
  return index;
}

/** Validates and writes a guide plus its index entry. Call only from inside a queued task. */
export async function writeGuide(guide: Guide): Promise<void> {
  await writeGuides([guide], []);
}

/**
 * Writes several guides and removes others in one storage write, with the index. Validates all
 * guides first, so a bad one changes nothing. Call only from inside a queued task.
 */
export async function writeGuides(guides: Guide[], removeIds: string[]): Promise<void> {
  const parsed = guides.map((g) => GuideSchema.parse(g));
  const index = await readIndex();
  const touched = new Set([...parsed.map((g) => g.id), ...removeIds]);
  const next = [...index.filter((e) => !touched.has(e.id)), ...parsed.map(indexEntry)];
  const set: Record<string, unknown> = { [INDEX_KEY]: next };
  for (const g of parsed) set[guideKey(g.id)] = g;
  // Play results (D211) follow the guide: a deleted step, or a step with another element (Re-pick,
  // a fix from the player, an import or library refresh), starts over. A removed guide's results
  // stay while it is in the Undo trash and go with it (purgeTrash); otherwise they go now.
  const statKeys = parsed.map((g) => statsKey(g.id));
  const gone: string[] = [];
  if (removeIds.length) {
    const inTrash = new Set(liveTrash((await chrome.storage.local.get(TRASH_KEY))[TRASH_KEY], Date.now()).map((e) => e.guide.id));
    gone.push(...removeIds.filter((id) => !inTrash.has(id)));
  }
  const drop: string[] = [];
  if (statKeys.length || gone.length) {
    const stats = await chrome.storage.local.get([...statKeys, STATS_INDEX_KEY]);
    const before = readCounts(stats[STATS_INDEX_KEY]);
    let counts = before;
    for (const g of parsed) {
      const raw = stats[statsKey(g.id)];
      if (raw === undefined) continue;
      const read = readStats(raw);
      const kept = pruneStats(read, g);
      const stored = Object.keys(raw as object).length;
      // Rewritten only when a step lost its results: a library refresh of unchanged guides writes nothing.
      if (!Object.keys(kept).length) drop.push(statsKey(g.id));
      else if (Object.keys(kept).length !== stored || Object.keys(read).length !== stored) set[statsKey(g.id)] = kept;
      counts = withCount(counts, g.id, kept);
    }
    for (const id of gone) {
      drop.push(statsKey(id));
      counts = withCount(counts, id, null);
    }
    if (JSON.stringify(counts) !== JSON.stringify(before)) set[STATS_INDEX_KEY] = counts;
  }
  if (removeIds.length || drop.length) await chrome.storage.local.remove([...removeIds.map(guideKey), ...drop]);
  await chrome.storage.local.set(set);
}

export async function listGuides(): Promise<GuideIndexEntry[]> {
  return readIndex();
}

/** Full guides by id, validated; missing or invalid ids are left out. */
export async function getGuides(ids: string[]): Promise<Guide[]> {
  const keys = ids.map(guideKey);
  const got = await chrome.storage.local.get(keys);
  const out: Guide[] = [];
  for (const k of keys) {
    const p = GuideSchema.safeParse(got[k]);
    if (p.success) out.push(p.data);
  }
  return out;
}

/** Every stored guide, validated. Slow with many guides: only the index rebuild uses it (D49). */
export async function allGuides(): Promise<Guide[]> {
  const all = await chrome.storage.local.get(null);
  const out: Guide[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('guide:')) continue;
    const p = GuideSchema.safeParse(v);
    if (p.success) out.push(p.data);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Rebuilds the index from the stored guides (older installs had a smaller index). */
export function rebuildIndex(): Promise<void> {
  return enqueue(async () => {
    const guides = await allGuides();
    await chrome.storage.local.set({ [INDEX_KEY]: guides.map(indexEntry) });
  });
}
