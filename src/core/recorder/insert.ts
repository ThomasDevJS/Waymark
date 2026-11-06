/**
 * Steps recorded into an existing guide (D202, #89): "Record steps here" in the editor records as
 * usual, and Stop puts the new steps into the saved guide at the chosen place, as a new version.
 * Pure: the service worker loads and saves.
 */
import { MAX_STEPS_PER_GUIDE, type Guide, type Step } from '../model/schema';
import { newId } from '../model/ids';

/** At most this many sites per guide (GuideSchema). */
const MAX_ORIGINS = 50;

/**
 * The guide with `steps` inserted before index `at` (clamped to 0…length), the recording's sites
 * added, and a new revision. Throws when the guide would go over the step limit.
 */
export function insertRecorded(guide: Guide, steps: Step[], at: number, origins: string[], now = Date.now()): Guide {
  if (guide.steps.length + steps.length > MAX_STEPS_PER_GUIDE) throw new Error(`A guide can have at most ${MAX_STEPS_PER_GUIDE} steps.`);
  const i = Math.max(0, Math.min(guide.steps.length, Math.trunc(at)));
  const taken = new Set(guide.steps.map((s) => s.id));
  // Step ids are unique within a guide; a clash (never expected) gets a fresh id.
  const fresh = steps.map((s) => (taken.has(s.id) ? { ...s, id: newId() } : s));
  const next = guide.steps.slice();
  next.splice(i, 0, ...fresh);
  const appOrigins = [...guide.appOrigins];
  for (const o of origins) if (!appOrigins.includes(o) && appOrigins.length < MAX_ORIGINS) appOrigins.push(o);
  return { ...guide, steps: next, appOrigins, version: guide.version + 1, revisionId: newId(), updatedAt: new Date(now).toISOString() };
}

/** What Stop does with a recording into a guide (D202), decided without touching storage. */
export type InsertStop =
  | { kind: 'insert'; guide: Guide; count: number; at: number }
  | { kind: 'aside'; title: string }
  | { kind: 'nothing' };

const ASIDE = ' (added steps)';

/**
 * Into the guide when it is still the version the recording started from and the steps fit;
 * otherwise the steps become a guide of their own (never lost, never overwriting another edit),
 * titled within the 500-character limit; with no steps recorded, nothing is written.
 * (A recorded step whose id clashed gets a new id in insertRecorded; its screenshot, keyed by the
 * old id, is then lost. Ids are random, so this is not expected to happen.)
 */
export function planInsertStop(cur: Guide | undefined, rec: { title: string; steps: Step[]; appOrigins: string[]; insert: { at: number; baseRevisionId: string } }, now = Date.now()): InsertStop {
  if (!rec.steps.length) return { kind: 'nothing' };
  const fits = !!cur && cur.steps.length + rec.steps.length <= MAX_STEPS_PER_GUIDE;
  if (cur && cur.source === 'local' && cur.revisionId === rec.insert.baseRevisionId && fits)
    return { kind: 'insert', guide: insertRecorded(cur, rec.steps, rec.insert.at, rec.appOrigins, now), count: rec.steps.length, at: rec.insert.at };
  return { kind: 'aside', title: `${rec.title.slice(0, 500 - ASIDE.length).trimEnd()}${ASIDE}` };
}
