/**
 * Step results from real plays on this device (issue #96, D211). Per guide, per step: the last
 * results of the step's element, so the editor and the library can warn about steps that may
 * break. Numbers, ids and dates only: no names, page text or URLs. Pure: the service worker
 * stores it (storage.local, `stats:<guideId>`), the panel reads it.
 */
import { STRONG } from '../matcher/signals';
import { UNIQUE_MARGIN } from '../matcher/signals';
import type { Guide, Step } from '../model/schema';
import { targetHash } from '../shots/lifecycle';

/** Results kept per step. */
export const MAX_RESULTS = 20;
/** "Not found in N of the last RECENT plays". */
export const RECENT = 5;
/** Misses among the recent plays that make a step flagged. */
export const MISSES_TO_FLAG = 2;
/** A found element less than this many points ahead of the runner-up is "barely ahead" (accepted from UNIQUE_MARGIN). */
export const LOW_MARGIN = UNIQUE_MARGIN + 10;

/** One play of one step: [minutes since epoch, found 1 / not found 0, score, margin, strong signals matched]. */
export type PlayResult = [number, 0 | 1, number, number, number];

export interface StepStats {
  /** The hash of the step's element the results are about: another element starts empty. */
  t: string;
  /** The step token of the last result: a run reports a step once, however often frames repeat. */
  k: string;
  /** 1 when the step's element is repeated (`instance: 'any'`): margins say nothing there. */
  a?: 1;
  r: PlayResult[];
}

export type GuideStats = Record<string, StepStats>;

export const statsKey = (guideId: string) => `stats:${guideId}`;
/** Flagged steps per guide, kept with every write of a guide's results: the library reads this one small key. */
export const STATS_INDEX_KEY = 'statsIndex';

/** The index with one guide's count set (0 or no results: the guide leaves it). */
export function withCount(index: Record<string, number>, guideId: string, stats: GuideStats | null): Record<string, number> {
  const out = { ...index };
  const n = stats ? flaggedSteps(stats) : 0;
  if (n) out[guideId] = n;
  else delete out[guideId];
  return out;
}

export function readCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isInteger(e[1]) && e[1] > 0));
}

/** The strong signals among those a match used (same STRONG set as the matcher). */
export function strongCount(matched: readonly string[]): number {
  return matched.filter((k) => STRONG.has(k as never)).length;
}

/**
 * The matcher's fast path found the element by a unique `data-guide-id` or test id: hooks the app
 * keeps on purpose, the sturdiest way to find it. The matcher reports only `testId` for it, so it
 * counts as this many strong signals (the report's bound), never as fragile (D211).
 */
export const FAST_PATH_STRONG = 10;

/** The strength of a found match: its strong signals, or FAST_PATH_STRONG for the fast path. Test step and plays share it. */
export function matchStrength(r: { matched: readonly string[]; via?: string }): number {
  return r.via === 'fast-path' ? FAST_PATH_STRONG : strongCount(r.matched);
}

/** Found by one strong signal or none: a small change to the app can break it. Test step and plays share this rule. */
export function isFragile(strong: number): boolean {
  return strong <= 1;
}

/**
 * Adds one result for a step (or replaces the result of the same step token: one per play). A
 * step whose element changed starts over. Returns the stats to store.
 */
export function recordResult(stats: GuideStats, step: Pick<Step, 'id' | 'target'>, stepToken: string, result: PlayResult): GuideStats {
  const t = targetHash(step.target);
  const old = stats[step.id];
  const entry: StepStats = old && old.t === t ? { ...old, r: old.r.slice() } : { t, k: '', r: [] };
  if (step.target?.instance === 'any') entry.a = 1;
  if (entry.k === stepToken && entry.r.length) entry.r[entry.r.length - 1] = result;
  else entry.r.push(result);
  entry.k = stepToken;
  if (entry.r.length > MAX_RESULTS) entry.r = entry.r.slice(-MAX_RESULTS);
  return { ...stats, [step.id]: entry };
}

/** The stats that still describe the guide: steps gone, or with another element, are dropped. */
export function pruneStats(stats: GuideStats, guide: Pick<Guide, 'steps'>): GuideStats {
  const out: GuideStats = {};
  for (const s of guide.steps) {
    const e = stats[s.id];
    if (e && s.target && e.t === targetHash(s.target)) out[s.id] = e;
  }
  return out;
}

export type Reason = { kind: 'not-found'; misses: number; of: number } | { kind: 'one-signal' } | { kind: 'low-margin' };

/** Why a step may break, from its results; none when it has no results. */
export function stepReasons(entry: StepStats | undefined): Reason[] {
  if (!entry?.r.length) return [];
  const out: Reason[] = [];
  const recent = entry.r.slice(-RECENT);
  const misses = recent.filter((r) => r[1] === 0).length;
  if (misses >= MISSES_TO_FLAG) out.push({ kind: 'not-found', misses, of: recent.length });
  const lastFound = [...entry.r].reverse().find((r) => r[1] === 1);
  if (lastFound) {
    if (isFragile(lastFound[4])) out.push({ kind: 'one-signal' });
    else if (!entry.a && lastFound[3] < LOW_MARGIN) out.push({ kind: 'low-margin' });
  }
  return out;
}

export function reasonText(r: Reason): string {
  if (r.kind === 'not-found') return `Not found in ${r.misses} of the last ${r.of} plays`;
  if (r.kind === 'one-signal') return 'Found by one signal only';
  return 'Barely ahead of a look-alike';
}

/** Steps of a guide that may break. */
export function flaggedSteps(stats: GuideStats | undefined): number {
  return stats ? Object.values(stats).filter((e) => stepReasons(e).length > 0).length : 0;
}

/** Bounds a stored value: anything malformed is dropped (storage is trusted, but older or broken data must not crash the panel). */
export function readStats(raw: unknown): GuideStats {
  if (!raw || typeof raw !== 'object') return {};
  const out: GuideStats = {};
  for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
    const v = e as Partial<StepStats>;
    if (typeof v?.t !== 'string' || typeof v.k !== 'string' || !Array.isArray(v.r)) continue;
    const r = v.r.filter((x): x is PlayResult => Array.isArray(x) && x.length === 5 && x.every((n) => typeof n === 'number' && Number.isFinite(n))).slice(-MAX_RESULTS);
    out[id] = { t: v.t, k: v.k, r, ...(v.a === 1 ? { a: 1 as const } : {}) };
  }
  return out;
}

/** Minutes since the epoch: the date of a play, without the second it happened. */
export const playMinute = (now = Date.now()) => Math.floor(now / 60_000);
