/**
 * What the how-to preview (D195) shows: the reviewed guides (the export review's removals
 * applied) and the screenshots that fit their steps. The side panel opens the page with the guide
 * ids, the removals and the file name in its address; nothing else is passed, and nothing leaves
 * the extension. The page reads the guides through the service worker and the images from the
 * extension's own IndexedDB, as the export review did.
 */
import type { Guide } from '../../core/model/schema';
import { applyRemovals } from '../../core/sharing/review';
import { shotFits, stepHashes } from '../../core/shots/lifecycle';
import { shotsOf, type ShotRecord } from '../../core/shots/store';
import { send } from '../../core/messaging/client';

export const MAX_PREVIEW_GUIDES = 200;
const MAX_DROP = 20_000;

export interface PreviewQuery {
  ids: string[];
  /** Review keys the author removed in the side panel (descriptions, notes). */
  drop: string[];
  name: string;
}

/** The preview page's address for an export (an extension page, never web accessible). */
export function previewPath(q: PreviewQuery): string {
  const p = new URLSearchParams({ g: q.ids.join(','), name: q.name });
  if (q.drop.length) p.set('drop', JSON.stringify(q.drop));
  return `howto.html?${p.toString()}`;
}

export function parsePreviewQuery(search: string): PreviewQuery {
  const p = new URLSearchParams(search);
  const ids = (p.get('g') ?? '')
    .split(',')
    .filter((x) => /^[\w-]{1,64}$/.test(x))
    .slice(0, MAX_PREVIEW_GUIDES);
  let drop: string[] = [];
  try {
    const raw: unknown = JSON.parse(p.get('drop') ?? '[]');
    if (Array.isArray(raw)) drop = raw.filter((x): x is string => typeof x === 'string' && x.length <= 300).slice(0, MAX_DROP);
  } catch {
    drop = [];
  }
  return { ids, drop, name: (p.get('name') ?? 'guides').slice(0, 200) };
}

/** Screenshots of steps still in their guide that still show the step's element (D185). */
export function fittingShots(guides: Pick<Guide, 'id' | 'steps'>[], shots: ShotRecord[]): ShotRecord[] {
  const steps = new Map(guides.map((g) => [g.id, stepHashes(g)]));
  return shots.filter((x) => shotFits(x, steps.get(x.guideId)));
}

export interface PreviewData {
  guides: Guide[];
  shots: ShotRecord[];
  /** Guides with screenshots on: their steps without one get a hint on how to add it. */
  shotsOn: Set<string>;
  name: string;
}

/** Loads the preview's data. Guides that are gone are left out. */
export async function loadPreview(q: PreviewQuery): Promise<PreviewData> {
  const guides: Guide[] = [];
  const shots: ShotRecord[] = [];
  const shotsOn = new Set<string>();
  for (const id of q.ids) {
    const g = await send('guide.get', { id }).catch(() => null);
    if (!g) continue;
    guides.push(g);
    // Only guides with screenshots on, and only images that still fit their step (D188).
    const status = await send('shots.get', { guideId: id }).catch(() => ({ on: false, stepIds: [] as string[], old: [] as string[] }));
    if (!status.on) continue;
    shotsOn.add(id);
    const ids = new Set(status.stepIds);
    shots.push(...(await shotsOf(id).catch(() => [] as ShotRecord[])).filter((x) => ids.has(x.stepId)));
  }
  return { guides: applyRemovals(guides, new Set(q.drop)), shots: fittingShots(guides, shots), shotsOn, name: q.name };
}
