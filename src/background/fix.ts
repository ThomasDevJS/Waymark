/**
 * Fix a broken step during playback (issue #95, D210): on the author's own guide, the not-found
 * card and the tooltip offer "Pick the right element". The page enters the editor's pick mode;
 * the picked element replaces the step's element, the guide is saved as a new revision, the run
 * continues on the fixed step, and the panel offers Undo. Nothing is guessed: a person chooses.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import { ElementFingerprintSchema, GuideSchema, type ElementFingerprint, type Guide, type Step } from '../core/model/schema';
import { newId } from '../core/model/ids';
import { hasStrongSignal } from '../core/matcher/signals';
import { applyRunStep, currentStep, fixedStep, fixPending, withStep, type Run } from '../core/player/run';
import { enqueue } from '../core/storage/queue';
import { guideKey, writeGuide } from '../core/storage/guides';
import { UNDO_MS } from '../core/storage/trash';
import { broadcast, getRun, runKey, stopPicker } from './runs';
import { endPick, pickKey } from './pick';
import { updateAllBadges } from './discovery';
import { FIX_UNDO_GRACE_MS, scheduleShotSweep } from './shots';
import { dlog } from './debug';
import { framePathFor, framesKey, type FrameMap } from '../core/frames/registry';
import { sessionKV } from '../core/storage/session-kv';

/** The last fix in a tab, for the panel's Undo toast (chrome.storage.session, trusted contexts only). */
export const fixKey = (tabId: number) => `runFix:${tabId}`;

export interface FixRecord {
  guideId: string;
  stepId: string;
  stepIndex: number;
  /** The run the fix was made in (its start time). */
  runId: string;
  /** The guide as it was before the fix: Undo writes this exact copy back. */
  before: Guide;
  /** The revision the fix saved: Undo is refused once the guide has changed again. */
  revisionId: string;
  /** The run's own copy of the step before the fix. */
  runStep: Step;
  at: number;
  until: number;
}

/** Undo is accepted a little after the toast goes, for a click on its last frame. */
const UNDO_GRACE_MS = FIX_UNDO_GRACE_MS;

/** Why the player's button could not start a pick: the tooltip says what to do (D210). */
export type FixRefusal = 'step' | 'guide' | 'page';

async function storedGuide(id: string): Promise<Guide | null> {
  const parsed = GuideSchema.safeParse((await chrome.storage.local.get(guideKey(id)))[guideKey(id)]);
  return parsed.success ? parsed.data : null;
}

/** The origin of the tab's top page: a pick is only for a run on that page's site. */
function topOrigin(ctx: HandlerContext): string | null {
  try {
    return ctx.sender.tab?.url ? new URL(ctx.sender.tab.url).origin : null;
  } catch {
    return null;
  }
}

function onGuideSite(run: Run, ctx: HandlerContext): boolean {
  const o = topOrigin(ctx);
  return !!o && run.guideSnapshot.appOrigins.includes(o);
}

/** The sending frame's path in the tab's frame map; null when it is not mapped (yet). */
async function senderPath(tabId: number, ctx: HandlerContext): Promise<string[] | null> {
  if (ctx.frameId === undefined) return null;
  if (ctx.frameId === 0) return [];
  return framePathFor((await sessionKV.get<FrameMap>(framesKey(tabId))) ?? {}, ctx.frameId);
}

/**
 * The sending frame may act for the run's current step (D210, review): a frame of one of the
 * guide's sites, or the frame the step's element lives in (a partner iframe on another site).
 * Any other granted frame on the page sees the run's view but cannot start or answer a pick.
 */
function frameMayFix(run: Run, ctx: HandlerContext, path: string[] | null): boolean {
  const origin = ctx.sender.origin;
  if (origin && run.guideSnapshot.appOrigins.includes(origin)) return true;
  const want = currentStep(run)?.target?.framePath;
  return !!path && !!want && JSON.stringify(path) === JSON.stringify(want);
}

/** Ends the player's pick in a tab (Esc, a refused answer, the editor's own pick): the step shows again. */
export async function endFix(tabId: number, why: string): Promise<boolean> {
  const ended = await enqueue(async () => {
    const run = await getRun(tabId);
    if (!run?.fix) return false;
    delete run.fix;
    run.rev += 1;
    await chrome.storage.session.set({ [runKey(tabId)]: run });
    return true;
  });
  if (!ended) return false;
  dlog('run', 'fix.end', { tab: tabId }, { why });
  await stopPicker(tabId);
  await broadcast(tabId);
  return true;
}

/** A pick.result while no editor pick is pending: the player's pick, if one is under way (D210). */
export async function fixPicked(tabId: number, target: unknown, ctx: HandlerContext): Promise<{ ok: boolean }> {
  const parsed = ElementFingerprintSchema.safeParse(target);
  // The page is untrusted: an element it could never find again is refused here too (D47). The
  // frame stays in pick mode (its picker stopped when it sent the answer), so the author goes on.
  if (!parsed.success || !hasStrongSignal(parsed.data)) {
    const run = await getRun(tabId);
    if (run && fixPending(run)) {
      dlog('run', 'fix.refused', { tab: tabId }, { why: 'nothing to find the element by' });
      const again: ContentPush = { type: 'pick.start' };
      if (ctx.frameId !== undefined) await chrome.tabs.sendMessage(tabId, again, { frameId: ctx.frameId }).catch(() => undefined);
    }
    return { ok: false };
  }
  const fp: ElementFingerprint = parsed.data;
  const path = await senderPath(tabId, ctx);
  const out = await enqueue(async (): Promise<{ saved: Guide; index: number } | { why: string }> => {
    const run = await getRun(tabId);
    if (!run?.fix) return { why: 'no pick' };
    if (!fixPending(run)) return { why: 'the pick timed out or the step changed' };
    if (!onGuideSite(run, ctx)) return { why: 'the tab is not on the guide’s site' };
    // The element's frame path must be the frame it came from, and that frame may act for the step.
    if (!path || JSON.stringify(path) !== JSON.stringify(fp.framePath) || !frameMayFix(run, ctx, path)) return { why: 'the answer came from a frame that may not fix this step' };
    const step = currentStep(run);
    // Read the stored guide inside the queue: an edit saved in the panel meanwhile is kept (no lost write).
    const stored = step ? await storedGuide(run.guideSnapshot.id) : null;
    if (!step || !stored || stored.source !== 'local') return { why: 'the guide is gone or not the author’s own' };
    const fixed = fixedStep(stored, step.id, fp);
    const next = fixed && withStep(stored, fixed);
    const runFixed = fixedStep(run.guideSnapshot, step.id, fp);
    if (!fixed || !next || !runFixed) return { why: 'the step was deleted or has no element' };
    const saved: Guide = { ...next, source: 'local', version: stored.version + 1, revisionId: newId(), updatedAt: new Date().toISOString() };
    await writeGuide(saved);
    const runStep = step;
    applyRunStep(run, runFixed);
    const now = Date.now();
    const record: FixRecord = { guideId: saved.id, stepId: step.id, stepIndex: run.stepIndex, runId: run.startedAt, before: stored, revisionId: saved.revisionId, runStep, at: now, until: now + UNDO_MS };
    await chrome.storage.session.set({ [runKey(tabId)]: run, [fixKey(tabId)]: record });
    return { saved, index: run.stepIndex };
  });
  if ('why' in out) {
    if (out.why !== 'no pick') await endFix(tabId, out.why);
    return { ok: false };
  }
  dlog('run', 'fix.saved', { tab: tabId }, () => ({ step: out.index + 1, version: out.saved.version }));
  await stopPicker(tabId);
  await broadcast(tabId);
  await updateAllBadges();
  // The fixed step's screenshot showed the old element (D185); it stays while Undo can bring the
  // old element back, and the sweep removes it after that.
  await scheduleShotSweep();
  return { ok: true };
}

/**
 * Starts the player's pick for the current step of a tab's run (D210), when `may` accepts the run:
 * the caller checks who asks (a frame of the page, or a report link, D212).
 */
export async function beginFix(tabId: number, stepId: string, may: (run: Run) => boolean | Promise<boolean>): Promise<{ ok: boolean; why?: FixRefusal }> {
  const why = await enqueue(async (): Promise<FixRefusal | null> => {
    const run = await getRun(tabId);
    const step = run ? currentStep(run) : undefined;
    if (!run || run.status !== 'running' || !step?.target || step.id !== stepId) return 'step';
    if (!(await may(run))) return 'page';
    if (run.guideSnapshot.source !== 'local') return 'guide';
    const stored = await storedGuide(run.guideSnapshot.id);
    if (!stored || stored.source !== 'local') return 'guide';
    if (!stored.steps.some((s) => s.id === stepId && s.target)) return 'step';
    run.fix = { stepToken: run.stepToken, at: Date.now() };
    run.rev += 1;
    await chrome.storage.session.set({ [runKey(tabId)]: run });
    return null;
  });
  if (why) {
    dlog('run', 'fix.refused', { tab: tabId }, { why });
    return { ok: false, why };
  }
  dlog('run', 'fix.start', { tab: tabId });
  // An editor pick in this tab gives way (its panel stops waiting); only once this pick is on.
  if ((await chrome.storage.session.get(pickKey(tabId)))[pickKey(tabId)]) await endPick(tabId, true);
  await broadcast(tabId);
  const msg: ContentPush = { type: 'pick.start' };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await endFix(tabId, 'no picker on the page');
    return { ok: false, why: 'page' };
  }
  return { ok: true };
}

export const fixHandlers: Handlers = {
  // From the player (card or tooltip): only the sender tab's run, its current step, on the guide's site.
  'run.fix.start': async ({ stepId }, ctx: HandlerContext): Promise<{ ok: boolean; why?: FixRefusal }> => {
    const tabId = ctx.tabId;
    if (tabId === undefined) return { ok: false, why: 'page' };
    const path = await senderPath(tabId, ctx);
    return beginFix(tabId, stepId, (run) => onGuideSite(run, ctx) && frameMayFix(run, ctx, path));
  },
  // The panel's Undo: the exact copy from before the fix, only while nothing changed it since.
  'run.fix.undo': async ({ tabId }) => {
    const done = await enqueue(async () => {
      const rec = (await chrome.storage.session.get(fixKey(tabId)))[fixKey(tabId)] as FixRecord | undefined;
      if (!rec || Date.now() > rec.until + UNDO_GRACE_MS) throw new Error('Too late to undo. Open the guide in the editor to change the step.');
      const current = await storedGuide(rec.guideId);
      if (!current || current.revisionId !== rec.revisionId) throw new Error('This guide changed after the fix. Open it in the editor to change the step.');
      await writeGuide(rec.before);
      await chrome.storage.session.remove(fixKey(tabId));
      // The run stays on the step it is on; its copy of the fixed step is the old one again. Every
      // copy of that run: it may have moved to a tab a link opened (the opener keeps a paused copy).
      const all = await chrome.storage.session.get(null);
      const changed: number[] = [];
      const stopPick: number[] = [];
      for (const [key, value] of Object.entries(all)) {
        const run = value as Run;
        if (!key.startsWith('run:') || run?.startedAt !== rec.runId) continue;
        const picking = !!run.fix;
        if (!applyRunStep(run, rec.runStep)) continue;
        await chrome.storage.session.set({ [key]: run });
        changed.push(Number(key.slice(4)));
        if (picking && !run.fix) stopPick.push(Number(key.slice(4)));
      }
      return { ...rec, changed, stopPick };
    });
    for (const t of done.stopPick) await stopPicker(t);
    dlog('run', 'fix.undone', { tab: tabId }, { step: done.stepIndex + 1 });
    for (const t of done.changed) await broadcast(t);
    await updateAllBadges();
    return { ok: true };
  },
};
