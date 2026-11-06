/**
 * Service worker side of playback (SPEC: Player, "Runs across pages"). Run state is per tab in
 * chrome.storage.session (run:<tabId>) with a snapshot of the guide; frame match reports for
 * the current step live next to it (match:<tabId>). Nothing is kept in memory.
 */
import { fillRule } from '../core/url/fill';
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import { GuideSchema, type Guide } from '../core/model/schema';
import { docsToCheck, dropDoc, dropGone, markChecked, recordReport } from '../core/player/board';
import { applyRunOp, currentStep, newTabContinuesRun, NO_RUN, onStartPage, runView, shouldCatchUp, startRun, type MatchBoard, type Run, type RunOp, type RunView } from '../core/player/run';
import { enqueue } from '../core/storage/queue';
import { guideKey } from '../core/storage/guides';
import { addCompletion, addProblem, listProblems } from '../core/storage/problems';
import { normalizePath, urlMatches } from '../core/url/url';
import { getVoiceSettings, setVoiceSettings, speakCurrentStep, stopSpeech } from './voice';
import { siteAllowed } from './site-access';
import { dlog } from './debug';
import { redactUrl } from '../core/debug/log';
import { DEFAULT_SHADE, resolveShade } from '../core/player/shade';
import { getPlayerSettings } from './player-settings';

/** The origin of a page an entry names, so a page's own Copy log leaves out other sites (D111). */
function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** Step facts for the debug log: position, kind and the guide's own title (D110). */
function stepFacts(run: Run): Record<string, unknown> {
  const step = currentStep(run);
  return { step: run.stepIndex + 1, of: run.guideSnapshot.steps.length, kind: step?.kind ?? null, title: step ? step.title.replace(/\*\*/g, '') : null, status: run.status };
}

export const runKey = (tabId: number) => `run:${tabId}`;
const REPLAY_KEY = 'replayAt';
export const REPLAY_MIN_MS = 400;
const boardKey = (tabId: number) => `match:${tabId}`;

export async function getRun(tabId: number): Promise<Run | null> {
  return ((await chrome.storage.session.get(runKey(tabId)))[runKey(tabId)] as Run | undefined) ?? null;
}

async function getBoard(tabId: number): Promise<MatchBoard | undefined> {
  return (await chrome.storage.session.get(boardKey(tabId)))[boardKey(tabId)] as MatchBoard | undefined;
}

/** How long a frame has to answer "are you there?" before it counts as alive (D84). */
export const FRAME_ALIVE_MS = 500;

/**
 * True unless the document is certainly gone. A removed frame's document cannot receive messages,
 * so the send fails at once; a slow answer counts as alive, so a live frame is never dropped.
 */
export async function frameAlive(tabId: number, documentId: string): Promise<boolean> {
  const ask = chrome.tabs.sendMessage(tabId, { type: 'frame.alive' } satisfies ContentPush, { documentId }).then(
    (r) => r === true,
    () => false,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), FRAME_ALIVE_MS)));
  return Promise.race([ask, slow]).finally(() => clearTimeout(timer));
}

/** While frames still tie, they are asked again after these delays: an old frame may be removed later (D84). */
export const RECHECK_MS = [1200, 2500, 5000];

/** Asks the frames whether they still exist and drops those that do not (D84). */
async function pruneGoneFrames(tabId: number, stepToken: string, tied: { key: string; doc: string }[]): Promise<boolean> {
  const answers = await Promise.all(tied.map(async (t) => ((await frameAlive(tabId, t.doc)) ? null : t)));
  const gone = answers.filter((x): x is { key: string; doc: string } => x !== null);
  if (!gone.length) return false;
  return enqueue(async () => {
    const b = await getBoard(tabId);
    if (!b || b.stepToken !== stepToken || !dropGone(b, gone)) return false;
    await chrome.storage.session.set({ [boardKey(tabId)]: b });
    dlog('frame', 'frame.gone', { tab: tabId }, () => ({ dropped: gone.map((g) => g.key).join(','), winnerFrame: b.winner === null ? null : (Object.values(b.reports).find((x) => x.token === b.winner)?.frameId ?? null) }));
    return true;
  });
}

/** After a board change by D84: show and read the new winner. */
async function afterPrune(tabId: number): Promise<void> {
  await broadcast(tabId);
  if ((await getBoard(tabId))?.winner) await voiceSync(tabId);
}

/**
 * Asks the frames to check, drops the gone ones, and while two or more found frames remain for
 * this step, asks again later: an app may remove the old frame only after the new one loaded.
 */
async function checkFrames(tabId: number, stepToken: string, docs: { key: string; doc: string }[], attempt = 0): Promise<boolean> {
  const pruned = docs.length ? await pruneGoneFrames(tabId, stepToken, docs) : false;
  const delay = RECHECK_MS[attempt];
  if (delay !== undefined) {
    setTimeout(() => {
      void (async () => {
        const next = await enqueue(async () => {
          const b = await getBoard(tabId);
          if (!b || b.stepToken !== stepToken) return null;
          const now = Date.now();
          const d = docsToCheck(b, now);
          if (!d.length) return null;
          markChecked(b, d, now);
          await chrome.storage.session.set({ [boardKey(tabId)]: b });
          return d;
        });
        if (next && (await checkFrames(tabId, stepToken, next, attempt + 1))) await afterPrune(tabId);
      })();
    }, delay);
  }
  return pruned;
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
  let pageOrigin: string | null = null;
  try {
    pageOrigin = url ? new URL(url).origin : null;
  } catch {
    pageOrigin = null;
  }
  const shade = resolveShade((await getPlayerSettings()).shade, run.guideSnapshot.shade);
  const view = { ...runView(run, await getBoard(tabId)), muted: (await getVoiceSettings()).muted, shade };
  // On another site the content scripts learn only that a run exists, not which guide (D48).
  if (!pageOrigin || !run.guideSnapshot.appOrigins.includes(pageOrigin)) return { ...view, guideId: null, guideTitle: null, appOrigins: [], step: null, stepToken: null, winner: null, shade: DEFAULT_SHADE };
  return view;
}

/**
 * Sends the tab its current view. The read happens inside the write queue, so views go out in
 * the same order as the changes they describe (an older view can never overtake a newer one).
 */
export function broadcast(tabId: number): Promise<void> {
  return enqueue(async () => {
    const msg: ContentPush = { type: 'run.changed', payload: await viewFor(tabId) };
    chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
  });
}

/** Every tab with a run gets its view again: a global setting (mute, the shade) changed. */
export async function broadcastAllRuns(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  for (const key of Object.keys(all)) if (key.startsWith('run:')) await broadcast(Number(key.slice(4)));
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

async function endRun(tabId: number, why = 'ended'): Promise<void> {
  const ending = await getRun(tabId);
  if (ending) {
    stopSpeech(why);
    dlog('run', 'run.end', { tab: tabId }, { why });
  }
  // The player's pick ends with its run (D210).
  if (ending?.fix) void stopPicker(tabId);
  await enqueue(() => chrome.storage.session.remove([runKey(tabId), boardKey(tabId)]));
  await broadcast(tabId);
}

/** Every frame of the tab leaves pick mode. */
export function stopPicker(tabId: number): Promise<void> {
  const msg: ContentPush = { type: 'pick.stop' };
  return chrome.tabs.sendMessage(tabId, msg).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Reads the current step aloud if it has not been read yet. Every path that changes the step
 * (advance, start, catch-up on a page load, moving to a new tab, resuming) calls this, and the
 * stored spokenToken keeps it to once per step, even across service worker restarts (D41).
 */
async function voiceSync(tabId: number): Promise<void> {
  // A step on an element is read once some frame found it, not while its page or frame is still
  // loading (#32). Note and navigate steps are read at once. The board is read before the queue
  // (mutateRun) and is only a gate: a later winner report calls voiceSync again.
  const board = await getBoard(tabId);
  let wait = false;
  const { run, out } = await mutateRun(tabId, (r) => {
    if (!r || r.status !== 'running' || r.spokenToken === r.stepToken) return false;
    if (currentStep(r)?.target && !(board && board.stepToken === r.stepToken && board.winner)) {
      wait = true;
      return false;
    }
    r.spokenToken = r.stepToken;
    return true;
  });
  if (wait && run) dlog('voice', 'voice.wait', { tab: tabId }, () => ({ step: run.stepIndex + 1, why: 'no frame has found the element yet (D83)' }));
  if (out && run) dlog('voice', 'voice.due', { tab: tabId }, () => ({ step: run.stepIndex + 1, why: currentStep(run)?.target ? 'element found' : 'step has no element' }));
  if (out) await speakCurrentStep(tabId, run);
  else if (run && run.status !== 'running') stopSpeech(`run ${run.status}`);
}

/** Applies a run operation for the current step of a tab's run (from content, panel or commands). */
export async function runOp(tabId: number, op: RunOp, stepId: string): Promise<boolean> {
  if (op === 'exit') {
    if (!(await getRun(tabId))) return false;
    await endRun(tabId, 'exit');
    return true;
  }
  let from = -1;
  let hadFix = false;
  const { run, out } = await mutateRun(tabId, (r) => {
    from = r ? r.stepIndex : -1;
    if (!r || !applyRunOp(r, op, stepId)) return false;
    // The step changed during the player's pick (a shortcut, another frame): the pick ends (D210).
    hadFix = !!r.fix;
    delete r.fix;
    return true;
  });
  if (hadFix) void stopPicker(tabId);
  if (!out || !run) {
    dlog('run', 'step.refused', { tab: tabId }, () => ({ op, why: !run ? 'no run' : 'not the current step (stale or repeated)', current: run ? run.stepIndex + 1 : null }));
    return false;
  }
  dlog('run', 'step', { tab: tabId }, () => ({ op, from: from + 1, ...stepFacts(run) }));
  await enqueue(() => chrome.storage.session.remove(boardKey(tabId)));
  if (run.status === 'finished') await addCompletion(run.guideSnapshot.id, new Date().toISOString());
  await broadcast(tabId);
  // Speech stops on every step change and the new step is read once.
  if (run.status === 'finished') stopSpeech('guide finished');
  else await voiceSync(tabId);
  return true;
}

/** Problem reports keep the origin and normalized path only, never the query or fragment (D36). */
function problemUrl(url: string | undefined): string {
  try {
    const u = new URL(url ?? '');
    return u.origin + normalizePath(u.pathname);
  } catch {
    return '';
  }
}

export type StartResult = { status: 'started' } | { status: 'needs-start'; startUrl: string; reachable: boolean; pattern: string; stepIndex?: number };

/** True when the URL is on the page of step `index` (step 0: the start page). */
function onStepPage(guide: Guide, index: number, url: string): boolean {
  if (index === 0) return onStartPage(guide, url);
  const step = guide.steps[index];
  return !!step && urlMatches(step.url, url, guide.appOrigins);
}

/**
 * Starts a guide in a tab (side panel Start, Restart, on-page launcher, deep link). With
 * `stepIndex`, the run starts at that step ("Start from step N", D101); the learner must be on
 * that step's page, because only the start page can be opened for them.
 */
export async function startRunInTab(tabId: number, guideId: string, openStart: boolean, stepIndex = 0): Promise<StartResult> {
  const guide = await loadGuide(guideId);
  const url = await tabUrl(tabId);
  const origin = new URL(guide.startUrl).origin;
  if (!(await siteAllowed(origin))) throw new Error('Allow Waymark on this site first.');
  if (stepIndex > 0) {
    const step = guide.steps[stepIndex];
    if (!step) throw new Error(`This guide has no step ${stepIndex + 1}.`);
    let opened = false;
    if (!url || !onStepPage(guide, stepIndex, url)) {
      // That step's page, its ids filled in from the page the learner is on (D203).
      const page = fillRule(step.url.value, origin, url);
      if (!openStart || !page) return { status: 'needs-start', startUrl: page ?? guide.startUrl, reachable: !!page, pattern: step.url.value, stepIndex };
      await chrome.tabs.update(tabId, { url: page });
      opened = true;
    }
    const run = startRun(guide, Date.now(), stepIndex);
    dlog('run', 'run.start', { tab: tabId, o: originOf(url) }, () => ({ guide: guide.id, title: guide.title, ...stepFacts(run), url: redactUrl(url) }));
    await enqueue(async () => {
      await chrome.storage.session.remove(boardKey(tabId));
      await chrome.storage.session.set({ [runKey(tabId)]: run });
    });
    await broadcast(tabId);
    if (!opened) await voiceSync(tabId);
    return { status: 'started' };
  }
  if (!url || !onStartPage(guide, url)) {
    // The stored start URL has no ids (D33). When the first page needs one, it is filled in
    // from the page the learner is on, on the same site (D203); only without one does the
    // learner have to open it themselves (D36).
    const firstRule = guide.steps[0]?.url.value ?? '/';
    const page = onStartPage(guide, guide.startUrl) ? guide.startUrl : fillRule(firstRule, origin, url);
    if (!openStart || !page) return { status: 'needs-start', startUrl: page ?? guide.startUrl, reachable: !!page, pattern: firstRule };
    await chrome.tabs.update(tabId, { url: page });
  }
  const run = startRun(guide);
  dlog('run', 'run.start', { tab: tabId, o: originOf(url) }, () => ({ guide: guide.id, title: guide.title, ...stepFacts(run), url: redactUrl(url), openedStart: !url || !onStartPage(guide, url) }));
  await enqueue(async () => {
    await chrome.storage.session.remove(boardKey(tabId));
    await chrome.storage.session.set({ [runKey(tabId)]: run });
  });
  await broadcast(tabId);
  // With "Open start page", the first step is read when that page arrives (onTopFrameLoad).
  if (!url || onStartPage(guide, url)) await voiceSync(tabId);
  return { status: 'started' };
}

export const runHandlers: Handlers = {
  'run.start': ({ tabId, guideId, openStart, stepIndex }) => startRunInTab(tabId, guideId, !!openStart, stepIndex ?? 0),
  'run.mute': async ({ muted }) => {
    await setVoiceSettings({ muted });
    dlog('voice', muted ? 'voice.muted' : 'voice.unmuted', {});
    if (muted) stopSpeech('muted');
    // Mute is global: every tab with a run shows the new state.
    await broadcastAllRuns();
    return { ok: true };
  },
  // Replay voice / Repeat step from the tooltip (D106). Only the sender tab's own run, only its
  // current step, and at most every 400 ms, so a page cannot keep the voice busy.
  'run.replay': async ({ stepId }, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    if (tabId === undefined) return { ok: false };
    const ok = await enqueue(async () => {
      const run = await getRun(tabId);
      const step = run ? currentStep(run) : undefined;
      if (!run || run.status !== 'running' || !step || step.id !== stepId) return false;
      if (!ctx.sender.origin || !run.guideSnapshot.appOrigins.includes(ctx.sender.origin)) return false;
      const last = ((await chrome.storage.session.get(REPLAY_KEY))[REPLAY_KEY] as number | undefined) ?? 0;
      const now = Date.now();
      if (now - last < REPLAY_MIN_MS && now >= last) return false;
      await chrome.storage.session.set({ [REPLAY_KEY]: now });
      return true;
    });
    if (!ok) {
      dlog('voice', 'voice.replay.refused', { tab: tabId }, { why: 'not the current step, not the guide’s site, or within 400 ms' });
      return { ok: false };
    }
    dlog('voice', 'voice.replay', { tab: tabId });
    await speakCurrentStep(tabId, await getRun(tabId), true);
    return { ok: true };
  },
  'run.stop': async ({ tabId }) => {
    const had = !!(await getRun(tabId));
    await endRun(tabId, 'stopped from the panel');
    return { ok: had };
  },
  'run.state': ({ tabId }) => viewFor(tabId),
  'problems.list': async () => ({ problems: await listProblems() }),
  'problems.clear': async () => {
    await enqueue(() => chrome.storage.local.remove('problems'));
    return { ok: true };
  },
  'run.advance': async ({ stepId, op }, ctx: HandlerContext) => {
    if (ctx.tabId === undefined) return { ok: false };
    if (op === 'exit') return { ok: await runOp(ctx.tabId, 'exit', stepId) };
    return { ok: await runOp(ctx.tabId, op, stepId) };
  },
  'run.match': async (r, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    if (tabId === undefined || ctx.frameId === undefined) return { ok: false };
    // A report from a document that is going away (bfcache, unload) must not decide the winner.
    const lifecycle = (ctx.sender as { documentLifecycle?: string }).documentLifecycle;
    if (lifecycle && lifecycle !== 'active') {
      dlog('frame', 'frame.report.ignored', { tab: tabId, frame: ctx.frameId }, { why: `document ${lifecycle}` });
      return { ok: false };
    }
    const frameId = ctx.frameId;
    const changed = await enqueue(async () => {
      const run = await getRun(tabId);
      if (!run || run.status !== 'running' || run.stepToken !== r.stepToken) {
        dlog('frame', 'frame.report.stale', { tab: tabId, frame: frameId }, () => ({ why: !run ? 'no run' : run.status !== 'running' ? `run ${run.status}` : 'report for an older step' }));
        return null;
      }
      const before = await getBoard(tabId);
      const prev = before && before.stepToken === r.stepToken ? { winner: before.winner, gave: before.topGaveUp } : null;
      const doc = (ctx.sender as { documentId?: string }).documentId;
      const board = recordReport(before, { ...r, frameId, ...(doc ? { doc } : {}) });
      // Two or more frames found it: ask them whether they still exist (D84), once per burst.
      const now = Date.now();
      const check = docsToCheck(board, now);
      if (check.length) markChecked(board, check, now);
      await chrome.storage.session.set({ [boardKey(tabId)]: board });
      dlog('frame', 'frame.report', { tab: tabId, frame: frameId, o: ctx.sender.origin ?? null }, () => ({
        step: run.stepIndex + 1,
        found: r.found,
        score: r.score,
        margin: r.margin,
        instance: r.instance,
        pathMatches: r.pathMatches,
        winnerFrame: board.winner === null ? null : (Object.values(board.reports).find((x) => x.token === board.winner)?.frameId ?? null),
        frames: Object.keys(board.reports).length,
        topGaveUp: board.topGaveUp,
      }));
      return { changed: !prev || prev.winner !== board.winner || prev.gave !== board.topGaveUp, found: !!board.winner, check, boardId: board.id };
    });
    if (!changed) return { ok: true };
    // Two or more frames found it: drop the reports of frames that no longer exist (D84).
    if (changed.check.length && (await checkFrames(tabId, r.stepToken, changed.check))) {
      changed.changed = true;
      changed.found = !!(await getBoard(tabId))?.winner;
    }
    if (changed.changed) await broadcast(tabId);
    // Found: read the step now (D83). Idempotent (spokenToken), so a report after a service worker
    // restart that interrupted the first read still gets it read.
    if (changed.found) await voiceSync(tabId);
    return { ok: true, ...(changed.boardId ? { boardId: changed.boardId } : {}) };
  },
  // A frame's document is going away (pagehide): its reports go, so it never blocks the frame that
  // replaces it (D84). Accepted whatever the document's lifecycle; it can only remove its own entries.
  'run.leave': async (_p, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    const doc = (ctx.sender as { documentId?: string }).documentId;
    if (tabId === undefined || !doc) return { ok: false };
    const dropped = await enqueue(async () => {
      const b = await getBoard(tabId);
      if (!b || !dropDoc(b, doc)) return false;
      await chrome.storage.session.set({ [boardKey(tabId)]: b });
      dlog('frame', 'frame.left', { tab: tabId, frame: ctx.frameId ?? null }, () => ({ winnerFrame: b.winner === null ? null : (Object.values(b.reports).find((x) => x.token === b.winner)?.frameId ?? null) }));
      return true;
    });
    if (dropped) await afterPrune(tabId);
    return { ok: dropped };
  },
  'run.problem': async ({ stepId }, ctx: HandlerContext) => {
    if (ctx.tabId === undefined) return { ok: false };
    const run = await getRun(ctx.tabId);
    const step = run ? currentStep(run) : undefined;
    if (!run || !step || step.id !== stepId) return { ok: false };
    dlog('run', 'problem.reported', { tab: ctx.tabId }, () => stepFacts(run));
    await addProblem({
      guideId: run.guideSnapshot.id,
      guideTitle: run.guideSnapshot.title,
      stepId,
      stepTitle: step.title,
      stepIndex: run.stepIndex,
      url: problemUrl(ctx.sender.tab?.url),
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
  // Only a tab opened on the page of the run's current step takes the run (not a docs page, a
  // blank tab or an unrelated same-origin link). Its URL is readable because the site is granted.
  let url = tab.pendingUrl ?? tab.url;
  try {
    const t = await chrome.tabs.get(newId);
    url = t.pendingUrl || t.url || url;
  } catch {
    return;
  }
  let hadFix = false;
  const moved = await enqueue(async () => {
    const run = await getRun(opener);
    if (!run || (await getRun(newId)) || !url || !newTabContinuesRun(run, url)) return false;
    const carried: Run = { ...run, cause: 'resume', rev: run.rev + 1 };
    // No picker runs in the new tab: a pick under way ends with the move (review of D210).
    hadFix = !!run.fix;
    delete carried.fix;
    delete run.fix;
    run.status = 'paused';
    run.movedTo = newId;
    run.rev += 1;
    await chrome.storage.session.set({ [runKey(newId)]: carried, [runKey(opener)]: run });
    await chrome.storage.session.remove(boardKey(opener));
    return true;
  });
  if (hadFix) await stopPicker(opener);
  if (moved) {
    dlog('run', 'run.moved', { tab: newId, o: originOf(url) }, { from: opener, url: redactUrl(url) });
    await broadcast(opener);
    await broadcast(newId);
    await voiceSync(newId);
  }
}

/** When the tab a run moved to closes, the paused run in its opener resumes where it got to. */
export async function resumeRunsMovedTo(closedTabId: number): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const closed = all[runKey(closedTabId)] as Run | undefined;
  for (const [key, value] of Object.entries(all)) {
    const run = value as Run;
    if (!key.startsWith('run:') || run?.status !== 'paused' || run.movedTo !== closedTabId) continue;
    const tabId = Number(key.slice(4));
    await enqueue(async () => {
      const r = await getRun(tabId);
      if (!r || r.movedTo !== closedTabId) return;
      if (closed && closed.startedAt === r.startedAt) {
        r.stepIndex = closed.stepIndex;
        r.stepToken = closed.stepToken;
        if (closed.status === 'finished') r.status = 'finished';
      }
      if (r.status === 'paused') r.status = 'running';
      delete r.movedTo;
      r.cause = 'resume';
      r.rev = Math.max(r.rev, closed?.rev ?? 0) + 1;
      if (closed?.spokenToken) r.spokenToken = closed.spokenToken;
      await chrome.storage.session.set({ [runKey(tabId)]: r });
      dlog('run', 'run.resumed', { tab: tabId }, () => ({ closedTab: closedTabId, ...stepFacts(r) }));
    });
    await broadcast(tabId);
    await voiceSync(tabId);
  }
}

export async function onTopFrameLoad(tabId: number, url: string): Promise<void> {
  await enqueue(async () => {
    await chrome.storage.session.remove(boardKey(tabId));
    const run = await getRun(tabId);
    // A new page has no picker running: the player's pick ends and the step shows again (D210).
    if (run?.fix) {
      delete run.fix;
      run.rev += 1;
      await chrome.storage.session.set({ [runKey(tabId)]: run });
      dlog('run', 'fix.end', { tab: tabId }, { why: 'a new page loaded' });
    }
    const step = run ? currentStep(run) : undefined;
    if (run && step && shouldCatchUp(run, url) && applyRunOp(run, 'done', step.id)) {
      await chrome.storage.session.set({ [runKey(tabId)]: run });
      dlog('run', 'step.catch-up', { tab: tabId }, () => ({ why: 'the page loaded after a link click whose step report was lost (D32)', ...stepFacts(run) }));
    }
  });
  // The first step after "Open start page", or the step a catch-up moved to, is read now.
  await voiceSync(tabId);
}

export async function dropRun(tabId: number): Promise<void> {
  // A closed tab's step must not keep being read (chrome.tts is global to the extension).
  if (await getRun(tabId)) {
    stopSpeech('tab closed');
    dlog('run', 'run.end', { tab: tabId }, { why: 'tab closed' });
  }
  // A closed tab's Undo toast can't be used any more: its copy of the guide goes (review of D210).
  await chrome.storage.session.remove([runKey(tabId), boardKey(tabId), `runFix:${tabId}`]);
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
      ok = !!url && (await siteAllowed(new URL(url).origin));
    } catch {
      ok = false;
    }
    if (!ok) await endRun(tabId, 'site access removed');
  }
}
