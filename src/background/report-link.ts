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
import { startRunInTab, type StartResult } from './runs';
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

export type FixFromLinkResult = StartResult & { fixing?: boolean };

/**
 * Starts the run at step `stepIndex` and opens the player's pick there. Only the author's own
 * guide, only when the tab shows one of its sites (the run start checks the step's page too).
 */
export async function fixFromLink(tabId: number, guideId: string, stepIndex: number): Promise<FixFromLinkResult> {
  const g = await loadGuide(guideId);
  const origin = await tabOrigin(tabId);
  if (!g || !origin || !g.appOrigins.includes(origin)) throw new Error('This guide isn’t in your library.');
  if (g.source !== 'local') throw new Error('Team guides are read-only. Use Duplicate in the list to edit your own copy.');
  const step = g.steps[stepIndex];
  if (!step?.target) throw new Error('That step no longer exists in your copy.');
  const r = await startRunInTab(tabId, guideId, false, stepIndex);
  if (r.status !== 'started') return r;
  await chrome.storage.session.remove(linkOfferKey(tabId));
  const fix = await beginFix(tabId, step.id, () => true);
  return { ...r, fixing: fix.ok };
}

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
