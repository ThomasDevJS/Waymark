/**
 * Guide repository (SPEC: Data model, "Storage"): one key per guide plus an index, all writes
 * through the service worker's queue so a guide and the index never disagree.
 */
import { GuideSchema, type Guide } from '../model/schema';
import { enqueue } from './queue';

export interface GuideIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
  appOrigins: string[];
  steps: number;
}

export const INDEX_KEY = 'guides:index';
export const guideKey = (id: string) => `guide:${id}`;

export function saveGuide(guide: Guide): Promise<void> {
  const parsed = GuideSchema.parse(guide);
  return enqueue(() => writeGuide(parsed));
}

/** Validates and writes a guide plus its index entry. Call only from inside a queued task. */
export async function writeGuide(guide: Guide): Promise<void> {
  const parsed = GuideSchema.parse(guide);
  {
    const index = ((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] as GuideIndexEntry[] | undefined) ?? [];
    const entry: GuideIndexEntry = { id: parsed.id, title: parsed.title, updatedAt: parsed.updatedAt, appOrigins: parsed.appOrigins, steps: parsed.steps.length };
    const next = [...index.filter((e) => e.id !== parsed.id), entry];
    await chrome.storage.local.set({ [guideKey(parsed.id)]: parsed, [INDEX_KEY]: next });
  }
}

export async function listGuides(): Promise<GuideIndexEntry[]> {
  return ((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] as GuideIndexEntry[] | undefined) ?? [];
}
