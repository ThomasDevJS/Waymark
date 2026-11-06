/**
 * When step screenshots are deleted (D185). Pure: the service worker reads the keys, the guides
 * and the trash, and deletes what these return.
 *
 * - A step's image goes when the step leaves the saved guide, or its element changes (Re-pick).
 * - A guide's images go when the guide is deleted and its Undo window is over (D100), when
 *   screenshots are turned off for it, and when an import or the team library replaces it.
 */
import type { Guide } from '../model/schema';

export interface ShotRef {
  guideId: string;
  stepId: string;
  /** targetHash of the step's element when the image was taken. */
  t?: string;
}

/** Keys in a fixed order, so the same target always gives the same text. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Which element an image shows: a hash of the step's target. An image whose step now points at
 * another element (Re-pick, saved or not) is not that step's image any more.
 */
export function targetHash(target: unknown): string {
  const s = stableJson(target ?? null);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** A guide's steps by id, with the hash of each step's element. */
export type StepHashes = ReadonlyMap<string, string>;

export function stepHashes(g: Pick<Guide, 'steps'>): Map<string, string> {
  return new Map(g.steps.map((s) => [s.id, targetHash(s.target)]));
}

/** True when the image still shows its step's element in this guide. */
export function shotFits(ref: ShotRef, steps: StepHashes | undefined): boolean {
  const h = steps?.get(ref.stepId);
  return h !== undefined && ref.t === h;
}

/** Guides with screenshots on: the list in storage.local, capped. */
export const SHOTS_ON_KEY = 'shots:guides';
export const MAX_SHOT_GUIDES = 10_000;

export function asIdList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_SHOT_GUIDES) : [];
}

export interface SweepContext {
  /** Stored guides with images, by id, with their steps' element hashes. */
  guides: ReadonlyMap<string, StepHashes>;
  /** Guides with screenshots on. */
  on: ReadonlySet<string>;
  /** Guides that are not stored but must keep their images: in the Undo trash, or being recorded. */
  keep: ReadonlySet<string>;
}

/**
 * Images to delete: their guide is gone (and not kept), turned off, no longer has the step, or
 * the step now points at another element.
 */
export function staleShots(refs: ShotRef[], ctx: SweepContext): ShotRef[] {
  return refs.filter((k) => !ctx.keep.has(k.guideId) && (!ctx.on.has(k.guideId) || !shotFits(k, ctx.guides.get(k.guideId))));
}

/** Guide ids to take off the "screenshots on" list: the guide is gone and not kept. */
export function staleFlags(on: readonly string[], exists: ReadonlySet<string>, keep: ReadonlySet<string>): string[] {
  return on.filter((id) => !exists.has(id) && !keep.has(id));
}
