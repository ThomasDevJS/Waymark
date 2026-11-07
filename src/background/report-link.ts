/**
 * Broken-step report links (issue #98, D212). A learner's copied report has a link per problem:
 * the reported page with `waymark=<guideId>&waymark-step=<N>`. Opened by the author, the launcher
 * (and the side panel) offers: Fix step N (their own guide: the run starts at N and the player's
 * pick from D210 opens), Start from step N (a team guide), Start from step 1 (that step is gone),
 * or says the guide isn't in their library. Nothing else reaches the page: a guide id, its title.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import { GuideSchema, type Guide } from '../core/model/schema';
import { guideKey } from '../core/storage/guides';
import { boardHooks, getRun, runKey, startRunInTab, type StartResult } from './runs';
import { enqueue } from '../core/storage/queue';
import { currentStep, type MatchBoard } from '../core/player/run';
import { beginFix } from './fix';

/** What a report link offers. */
export type LinkOffer = 'fix' | 'start' | 'no-step';

/** The offer for a guide and a 1-based step number from a link. */
export function linkOffer(g: Pick<Guide, 'source' | 'steps'>, step: number): { offer: LinkOffer; stepIndex: number } {
  const s = g.steps[step - 1];
  if (!s) return { offer: 'no-step', stepIndex: 0 };
  // A step without an element (a note) has nothing to pick: the author plays it from there.
  return { offer: g.source === 'local' && s.target ? 'fix' : 'start', stepIndex: step - 1 };
}

/** The panel shows the same offer while this tab's page is open (chrome.storage.session, trusted contexts only). */
export const linkOfferKey = (tabId: number) => `linkOffer:${tabId}`;

export interface LinkOfferRecord {
  guideId: string;
  title: string;
  offer: LinkOffer;
  stepIndex: number;
  /** The step number the link asked for (1-based). */
  step: number;
  /** The page's site: the panel hides the offer once the tab shows another site. */
  origin: string;
  at: number;
}

async function loadGuide(id: string): Promise<Guide | null> {
  const parsed = GuideSchema.safeParse((await chrome.storage.local.get(guideKey(id)))[guideKey(id)]);
  return parsed.success ? parsed.data : null;
}

async function tabOrigin(tabId: number): Promise<string | null> {
  try {
    const url = (await chrome.tabs.get(tabId)).url;
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export type FixFromLinkResult = StartResult & { fixing?: 'when-found' };

/** True while the tab still shows one of the guide's sites (checked again inside the queue: the tab may have moved on). */
async function tabOnSites(tabId: number, origins: string[]): Promise<boolean> {
  const o = await tabOrigin(tabId);
  return !!o && origins.includes(o);
}

/**
 * Starts the run at step `stepIndex` of the author's own guide, on one of its sites. The player's
 * pick opens once a frame finds the step's element; when none does, the not-found card shows
 * with its own Pick the right element, and the author decides (issue #98: nothing is guessed).
 */
export async function fixFromLink(tabId: number, guideId: string, stepIndex: number): Promise<FixFromLinkResult> {
  const g = await loadGuide(guideId);
  if (!g || !(await tabOnSites(tabId, g.appOrigins))) throw new Error('This guide isn’t in your library.');
  if (g.source !== 'local') throw new Error('Team guides are read-only. Use Duplicate in the list to edit your own copy.');
  const step = g.steps[stepIndex];
  if (!step?.target) throw new Error('That step no longer exists in your copy.');
  const r = await startRunInTab(tabId, guideId, false, stepIndex, (run) => (run.fixWhenFound = run.stepToken));
  return r.status === 'started' ? { ...r, fixing: 'when-found' } : r;
}

/** After a board change: a run waiting for its step's element (Fix step N) opens the pick, or gives up on the card. */
boardHooks.push(async (tabId) => {
  const due = await enqueue(async () => {
    const run = await getRun(tabId);
    if (!run?.fixWhenFound) return null;
    const board = (await chrome.storage.session.get(`match:${tabId}`))[`match:${tabId}`] as MatchBoard | undefined;
    const current = run.fixWhenFound === run.stepToken && board?.stepToken === run.stepToken;
    if (current && !board?.winner && !board?.topGaveUp) return null; // still searching
    delete run.fixWhenFound;
    await chrome.storage.session.set({ [runKey(tabId)]: run });
    const step = currentStep(run);
    return current && board?.winner && step ? { stepId: step.id, origins: run.guideSnapshot.appOrigins } : null;
  });
  if (due) await beginFix(tabId, due.stepId, () => tabOnSites(tabId, due.origins));
});

export const reportLinkHandlers: Handlers = {
  // The launcher's Fix step N: the sender's own tab, top frame, a guide of the sender's site.
  'launcher.fix': async ({ guideId, stepIndex }, ctx: HandlerContext) => {
    if (ctx.tabId === undefined || ctx.frameId !== 0 || !ctx.sender.origin) throw new Error('Guide not available here.');
    const g = await loadGuide(guideId);
    if (!g || !g.appOrigins.includes(ctx.sender.origin)) throw new Error('Guide not available here.');
    return fixFromLink(ctx.tabId, guideId, stepIndex);
  },
  // The panel's Fix step N for the link opened in its tab.
  'linkOffer.fix': async ({ tabId, guideId, stepIndex }) => fixFromLink(tabId, guideId, stepIndex),
};
