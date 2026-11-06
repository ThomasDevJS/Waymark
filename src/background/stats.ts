/**
 * Step results from real plays (issue #96, D211). `run.match` decides once per step token whether
 * the step was found (the winning frame's report) or not (the top frame gave up on the step's
 * page: the not-found card). The result goes into `stats:<guideId>` in storage.local, only while
 * the stored guide's step still has the element the run played.
 */
import type { Handlers } from '../core/messaging/router';
import { GuideSchema, type Guide, type Step } from '../core/model/schema';
import { enqueue } from '../core/storage/queue';
import { guideKey } from '../core/storage/guides';
import { targetHash } from '../core/shots/lifecycle';
import { playMinute, pruneStats, readCounts, readStats, recordResult, STATS_INDEX_KEY, statsKey, stepReasons, withCount, type PlayResult } from '../core/stats/plays';

export interface Play {
  found: boolean;
  score: number;
  margin: number;
  strong: number;
}

/** Records one play of a step. Call outside the write queue (it queues itself). */
export async function recordPlay(guideId: string, step: Step, stepToken: string, play: Play): Promise<void> {
  if (!step.target) return;
  const result: PlayResult = [playMinute(), play.found ? 1 : 0, Math.round(play.score), Math.round(play.margin), play.strong];
  await enqueue(async () => {
    const parsed = GuideSchema.safeParse((await chrome.storage.local.get(guideKey(guideId)))[guideKey(guideId)]);
    if (!parsed.success) return;
    const stored: Guide = parsed.data;
    // The run plays its own snapshot: once the guide's step has another element, its result says nothing.
    const now = stored.steps.find((s) => s.id === step.id);
    if (!now?.target || targetHash(now.target) !== targetHash(step.target)) return;
    const key = statsKey(guideId);
    const got = await chrome.storage.local.get([key, STATS_INDEX_KEY]);
    const next = pruneStats(recordResult(readStats(got[key]), now, stepToken, result), stored);
    await chrome.storage.local.set({ [key]: next, [STATS_INDEX_KEY]: withCount(readCounts(got[STATS_INDEX_KEY]), guideId, next) });
  });
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
