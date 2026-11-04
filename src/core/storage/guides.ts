/**
 * Guide repository (SPEC: Data model, "Storage"): one key per guide plus an index, all writes
 * through the service worker's queue so a guide and the index never disagree.
 */
import { GuideSchema, type Guide, type UrlRule } from '../model/schema';
import { enqueue } from './queue';

export interface GuideIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
  appOrigins: string[];
  /** Pages where the guide is offered (badge, "For this page", launcher). */
  matchUrls: UrlRule[];
  source: 'local' | 'library';
  steps: number;
}

export const INDEX_KEY = 'guides:index';
export const guideKey = (id: string) => `guide:${id}`;

function entryOf(g: Guide): GuideIndexEntry {
  return { id: g.id, title: g.title, updatedAt: g.updatedAt, appOrigins: g.appOrigins, matchUrls: g.matchUrls, source: g.source, steps: g.steps.length };
}

async function readIndex(): Promise<GuideIndexEntry[]> {
  return ((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] as GuideIndexEntry[] | undefined) ?? [];
}

export function saveGuide(guide: Guide): Promise<void> {
  const parsed = GuideSchema.parse(guide);
  return enqueue(() => writeGuide(parsed));
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
  const next = [...index.filter((e) => !touched.has(e.id)), ...parsed.map(entryOf)];
  const set: Record<string, unknown> = { [INDEX_KEY]: next };
  for (const g of parsed) set[guideKey(g.id)] = g;
  if (removeIds.length) await chrome.storage.local.remove(removeIds.map(guideKey));
  await chrome.storage.local.set(set);
}

export async function listGuides(): Promise<GuideIndexEntry[]> {
  return readIndex();
}

/** Every stored guide (the side panel searches them; a few hundred guides are a few MB). */
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
    await chrome.storage.local.set({ [INDEX_KEY]: guides.map(entryOf) });
  });
}
