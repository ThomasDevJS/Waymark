/**
 * Service worker side of playback (SPEC: Player, "Runs across pages"). Run state is per tab in
 * chrome.storage.session (run:<tabId>) with a snapshot of the guide; frame match reports for
 * the current step live next to it (match:<tabId>). Nothing is kept in memory.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import { GuideSchema, type Guide } from '../core/model/schema';
import { recordReport } from '../core/player/board';
import { applyRunOp, currentStep, NO_RUN, onStartPage, runView, shouldCatchUp, startRun, type MatchBoard, type Run, type RunOp, type RunView } from '../core/player/run';
import { enqueue } from '../core/storage/queue';
import { guideKey } from '../core/storage/guides';
import { addCompletion, addProblem, listProblems } from '../core/storage/problems';
import { originToMatchPattern } from '../core/url/url';

const runKey = (tabId: number) => `run:${tabId}`;
const boardKey = (tabId: number) => `match:${tabId}`;

export async function getRun(tabId: number): Promise<Run | null> {
  return ((await chrome.storage.session.get(runKey(tabId)))[runKey(tabId)] as Run | undefined) ?? null;
}

async function getBoard(tabId: number): Promise<MatchBoard | undefined> {
  return (await chrome.storage.session.get(boardKey(tabId)))[boardKey(tabId)] as MatchBoard | undefined;
}

async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    return (await chrome.tabs.get(tabId)).url;
  } catch {
    return undefined;
  }
}

/**
 * The view sent to a tab's content scripts. Steps go only to tabs whose page is on one of the
 * guide's appOrigins (SPEC: Security: content scripts never receive unrelated guides).
 */
export async function viewFor(tabId: number | undefined, topUrl?: string): Promise<RunView> {
  if (tabId === undefined) return NO_RUN;
  const run = await getRun(tabId);
  if (!run) return NO_RUN;
  const url = topUrl ?? (await tabUrl(tabId));
  let origin: string | null = null;
  try {
    origin = url ? new URL(url).origin : null;
  } catch {
    origin = null;
  }
  const view = runView(run, await getBoard(tabId));
  if (!origin || !run.guideSnapshot.appOrigins.includes(origin)) return { ...view, step: null, winner: null };
  return view;
}

async function broadcast(tabId: number): Promise<void> {
  const msg: ContentPush = { type: 'run.changed', payload: await viewFor(tabId) };
  chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

/** Read-modify-write of one tab's run, serialized through the write queue. */
function mutateRun<T>(tabId: number, fn: (run: Run | null) => T): Promise<{ run: Run | null; out: T }> {
  return enqueue(async () => {
    const run = await getRun(tabId);
    const out = fn(run);
    if (run) await chrome.storage.session.set({ [runKey(tabId)]: run });
    return { run, out };
  });
}

async function loadGuide(id: string): Promise<Guide> {
  const raw = (await chrome.storage.local.get(guideKey(id)))[guideKey(id)];
  const parsed = GuideSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Guide not found.');
  return parsed.data;
}

async function endRun(tabId: number): Promise<void> {
  await enqueue(() => chrome.storage.session.remove([runKey(tabId), boardKey(tabId)]));
  await broadcast(tabId);
}

/** Applies a run operation for the current step of a tab's run (from content, panel or commands). */
export async function runOp(tabId: number, op: RunOp, stepId: string): Promise<boolean> {
  if (op === 'exit') {
    if (!(await getRun(tabId))) return false;
    await endRun(tabId);
    return true;
  }
  const { run, out } = await mutateRun(tabId, (r) => (r ? applyRunOp(r, op, stepId) : false));
  if (!out || !run) return false;
  await enqueue(() => chrome.storage.session.remove(boardKey(tabId)));
  if (run.status === 'finished') await addCompletion(run.guideSnapshot.id, new Date().toISOString());
  await broadcast(tabId);
  return true;
}

export const runHandlers: Handlers = {
  'run.start': async ({ tabId, guideId, openStart }) => {
    const guide = await loadGuide(guideId);
    const url = await tabUrl(tabId);
    const origin = new URL(guide.startUrl).origin;
    if (!(await chrome.permissions.contains({ origins: [originToMatchPattern(origin)] }))) throw new Error('Allow Waymark on this site first.');
    if (!url || !onStartPage(guide, url)) {
      if (!openStart) return { status: 'needs-start' as const, startUrl: guide.startUrl };
      await chrome.tabs.update(tabId, { url: guide.startUrl });
    }
    const run = startRun(guide);
    await enqueue(async () => {
      await chrome.storage.session.remove(boardKey(tabId));
      await chrome.storage.session.set({ [runKey(tabId)]: run });
    });
    await broadcast(tabId);
    return { status: 'started' as const };
  },
  'run.stop': async ({ tabId }) => {
    const had = !!(await getRun(tabId));
    await endRun(tabId);
    return { ok: had };
  },
  'run.state': ({ tabId }) => viewFor(tabId),
  'problems.list': async () => ({ problems: await listProblems() }),
  'run.advance': async ({ stepId, op }, ctx: HandlerContext) => {
    if (ctx.tabId === undefined) return { ok: false };
    if (op === 'exit') return { ok: await runOp(ctx.tabId, 'exit', stepId) };
    return { ok: await runOp(ctx.tabId, op, stepId) };
  },
  'run.match': async (r, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    if (tabId === undefined || ctx.frameId === undefined) return { ok: false };
    const frameId = ctx.frameId;
    const changed = await enqueue(async () => {
      const run = await getRun(tabId);
      if (!run || run.status !== 'running' || run.stepToken !== r.stepToken) return false;
      const before = await getBoard(tabId);
      const prev = before && before.stepToken === r.stepToken ? { winner: before.winner, gave: before.topGaveUp } : null;
      const board = recordReport(before, { ...r, frameId });
      await chrome.storage.session.set({ [boardKey(tabId)]: board });
      return !prev || prev.winner !== board.winner || prev.gave !== board.topGaveUp;
    });
    if (changed) await broadcast(tabId);
    return { ok: true };
  },
  'run.problem': async ({ stepId }, ctx: HandlerContext) => {
    if (ctx.tabId === undefined) return { ok: false };
    const run = await getRun(ctx.tabId);
    const step = run ? currentStep(run) : undefined;
    if (!run || !step || step.id !== stepId) return { ok: false };
    await addProblem({
      guideId: run.guideSnapshot.id,
      guideTitle: run.guideSnapshot.title,
      stepId,
      stepTitle: step.title,
      stepIndex: run.stepIndex,
      url: ctx.sender.tab?.url ?? '',
      at: new Date().toISOString(),
    });
    return { ok: true };
  },
};

export const CARRY_DELAY_MS = 300;

/** A link that opens a new tab carries the run there; the old tab's run pauses. */
export async function carryRunToNewTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  const newId = tab.id;
  const opener = tab.openerTabId;
  // The click that opened the tab also reports "step done" from the opener; let that land first
  // (the same 300 ms the player waits after any action), so the run moves on the right step.
  await new Promise((r) => setTimeout(r, CARRY_DELAY_MS));
  // Only a tab opened on one of the guide's origins takes the run (not, say, a docs page or a
  // new blank tab). Its URL is readable because the guide's site is granted.
  let url = tab.pendingUrl ?? tab.url;
  try {
    const t = await chrome.tabs.get(newId);
    url = t.pendingUrl || t.url || url;
  } catch {
    return;
  }
  let origin: string | null = null;
  try {
    origin = url ? new URL(url).origin : null;
  } catch {
    origin = null;
  }
  const moved = await enqueue(async () => {
    const run = await getRun(opener);
    if (!run || run.status !== 'running' || (await getRun(newId))) return false;
    if (!origin || !run.guideSnapshot.appOrigins.includes(origin)) return false;
    const carried: Run = { ...run, cause: 'resume' };
    run.status = 'paused';
    await chrome.storage.session.set({ [runKey(newId)]: carried, [runKey(opener)]: run });
    await chrome.storage.session.remove(boardKey(opener));
    return true;
  });
  if (moved) {
    await broadcast(opener);
    await broadcast(newId);
  }
}

/**
 * A new document in the top frame: the frames that reported for the current step are gone, and
 * a link or submit step whose report was lost on the way out is caught up (D32).
 */
export async function onTopFrameLoad(tabId: number, url: string): Promise<void> {
  await enqueue(async () => {
    await chrome.storage.session.remove(boardKey(tabId));
    const run = await getRun(tabId);
    const step = run ? currentStep(run) : undefined;
    if (run && step && shouldCatchUp(run, url) && applyRunOp(run, 'done', step.id)) {
      await chrome.storage.session.set({ [runKey(tabId)]: run });
    }
  });
}

export async function dropRun(tabId: number): Promise<void> {
  await chrome.storage.session.remove([runKey(tabId), boardKey(tabId)]);
}

/** chrome.commands: Next, Back and Exit shortcuts the user can change (SPEC: Accessibility). */
export async function onRunCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return;
  const run = await getRun(tabId);
  const step = run ? currentStep(run) : undefined;
  if (!run) return;
  if (command === 'exit-guide') await runOp(tabId, 'exit', step?.id ?? '');
  else if (command === 'next-step' && step) await runOp(tabId, 'next', step.id);
  else if (command === 'previous-step' && step) await runOp(tabId, 'back', step.id);
}

/** After site access is revoked, runs end in tabs whose page is no longer granted. */
export async function endRunsOnRevokedSites(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  for (const key of Object.keys(all)) {
    if (!key.startsWith('run:')) continue;
    const tabId = Number(key.slice(4));
    const url = await tabUrl(tabId);
    let ok = false;
    try {
      ok = !!url && (await chrome.permissions.contains({ origins: [originToMatchPattern(new URL(url).origin)] }));
    } catch {
      ok = false;
    }
    if (!ok) await endRun(tabId);
  }
}
