/**
 * Step results from real plays (issue #96, D211). The board decides once per run and step whether
 * the step was found (the winning frame's report) or not (the top frame gave up on the step's
 * page, and no frame has it: the not-found card). The result goes into `stats:<guideId>` in
 * storage.local, only while the stored guide's step still has the element the run played.
 */
import type { Handlers } from '../core/messaging/router';
import { GuideSchema, type Guide, type Step } from '../core/model/schema';
import { currentStep, type MatchBoard, type Run } from '../core/player/run';
import { enqueue } from '../core/storage/queue';
import { guideKey, listGuides } from '../core/storage/guides';
import { liveTrash, TRASH_KEY } from '../core/storage/trash';
import { targetHash } from '../core/shots/lifecycle';
import { urlMatches } from '../core/url/url';
import { pruneStats, readCounts, readStats, recordResult, STATS_INDEX_KEY, statsKey, stepReasons, withCount, type PlayResult } from '../core/stats/plays';

export interface Play {
  found: boolean;
  score: number;
  margin: number;
  strong: number;
}

/** A play to record, decided inside the write queue and recorded after it (recordPlay queues itself). */
export interface PendingPlay {
  guideId: string;
  step: Step;
  runId: string;
  play: Play;
}

/**
 * What a board change says about the current step's play, or null when it says nothing new.
 * `before` is the board before the change (same step token), `pageUrl` the top page's URL.
 */
export function decidePlay(run: Run, before: { winner: string | null; gave: boolean } | null, board: MatchBoard, pageUrl: string | undefined): PendingPlay | null {
  const step = currentStep(run);
  if (run.status !== 'running' || !step?.target || board.stepToken !== run.stepToken) return null;
  const base = { guideId: run.guideSnapshot.id, step, runId: run.startedAt };
  if (board.winner) {
    if (before?.winner === board.winner) return null;
    const w = Object.values(board.reports).find((x) => x.token === board.winner);
    // A report without the strong count (a content script from before D211) says nothing certain.
    if (!w || typeof w.strong !== 'number') return null;
    return { ...base, play: { found: true, score: w.score, margin: w.margin, strong: w.strong } };
  }
  // No frame has it and the top frame gave up: the card shows when the page is the step's. That
  // is new when the top frame just gave up, or when the frame that had it went away.
  if (!board.topGaveUp || (before?.gave && !before.winner)) return null;
  if (!pageUrl || !urlMatches(step.url, pageUrl, run.guideSnapshot.appOrigins)) return null;
  const top = board.reports['0'];
  return { ...base, play: { found: false, score: top?.score ?? 0, margin: 0, strong: 0 } };
}

/** Records one play of a step. Call outside the write queue (it queues itself); never throws. */
export async function recordPlay(p: PendingPlay | null): Promise<void> {
  if (!p?.step.target) return;
  const runStart = Date.parse(p.runId);
  if (!Number.isFinite(runStart)) return;
  const result: PlayResult = [runStart, p.play.found ? 1 : 0, Math.round(p.play.score), Math.round(p.play.margin), p.play.strong];
  try {
    await enqueue(async () => {
      const parsed = GuideSchema.safeParse((await chrome.storage.local.get(guideKey(p.guideId)))[guideKey(p.guideId)]);
      if (!parsed.success) return;
      const stored: Guide = parsed.data;
      // The run plays its own snapshot: once the guide's step has another element, its result says nothing.
      const now = stored.steps.find((s) => s.id === p.step.id);
      if (!now?.target || targetHash(now.target) !== targetHash(p.step.target)) return;
      const key = statsKey(p.guideId);
      const got = await chrome.storage.local.get([key, STATS_INDEX_KEY]);
      const next = pruneStats(recordResult(readStats(got[key]), now, result), stored);
      await chrome.storage.local.set({ [key]: next, [STATS_INDEX_KEY]: withCount(readCounts(got[STATS_INDEX_KEY]), p.guideId, next) });
    });
  } catch {
    // A hint only: a failed write must never hold up the run.
  }
}

/**
 * Removes the results of guides that are gone: neither stored nor in the Undo trash. Call inside
 * the write queue. The index lists every guide with results, so nothing is missed when a trash
 * entry was dropped by a later delete or restore (review of D211).
 */
export async function sweepStatsInQueue(now = Date.now()): Promise<void> {
  const counts = readCounts((await chrome.storage.local.get(STATS_INDEX_KEY))[STATS_INDEX_KEY]);
  const ids = Object.keys(counts);
  if (!ids.length) return;
  const keep = new Set([...(await listGuides()).map((g) => g.id), ...liveTrash((await chrome.storage.local.get(TRASH_KEY))[TRASH_KEY], now).map((e) => e.guide.id)]);
  const gone = ids.filter((id) => !keep.has(id));
  if (!gone.length) return;
  let next = counts;
  for (const id of gone) next = withCount(next, id, null);
  await chrome.storage.local.remove(gone.map(statsKey));
  await chrome.storage.local.set({ [STATS_INDEX_KEY]: next });
}

export const statsHandlers: Handlers = {
  'stats.summary': async ({ ids }) => {
    const index = readCounts((await chrome.storage.local.get(STATS_INDEX_KEY))[STATS_INDEX_KEY]);
    const counts: Record<string, number> = {};
    for (const id of ids) if (index[id]) counts[id] = index[id];
    return { counts };
  },
  'stats.guide': async ({ guideId }) => {
    const stats = readStats((await chrome.storage.local.get(statsKey(guideId)))[statsKey(guideId)]);
    const steps: Record<string, { t: string; reasons: ReturnType<typeof stepReasons> }> = {};
    for (const [id, e] of Object.entries(stats)) {
      const reasons = stepReasons(e);
      if (reasons.length) steps[id] = { t: e.t, reasons };
    }
    return { steps };
  },
};
