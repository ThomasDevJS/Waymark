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
import { pruneAfterSave } from './shots';
import { dlog } from './debug';

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
const UNDO_GRACE_MS = 2000;

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
  // The page is untrusted: an element it could never find again is refused here too (D47).
  if (!parsed.success || !hasStrongSignal(parsed.data)) {
    if ((await getRun(tabId))?.fix) dlog('run', 'fix.refused', { tab: tabId }, { why: 'nothing to find the element by' });
    return { ok: false };
  }
  const fp: ElementFingerprint = parsed.data;
  const out = await enqueue(async (): Promise<{ saved: Guide; index: number } | { why: string }> => {
    const run = await getRun(tabId);
    if (!run?.fix) return { why: 'no pick' };
    if (!fixPending(run)) return { why: 'the pick timed out or the step changed' };
    if (!onGuideSite(run, ctx)) return { why: 'the tab is not on the guide’s site' };
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
  // The fixed step's screenshot showed the old element (D185).
  await pruneAfterSave(out.saved);
  return { ok: true };
}

export const fixHandlers: Handlers = {
  // From the player (card or tooltip): only the sender tab's run, its current step, on the guide's site.
  'run.fix.start': async ({ stepId }, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    if (tabId === undefined) return { ok: false };
    // An editor pick in this tab gives way (its panel stops waiting).
    if ((await chrome.storage.session.get(pickKey(tabId)))[pickKey(tabId)]) await endPick(tabId, true);
    const ok = await enqueue(async () => {
      const run = await getRun(tabId);
      const step = run ? currentStep(run) : undefined;
      if (!run || run.status !== 'running' || !step?.target || step.id !== stepId || !onGuideSite(run, ctx)) return false;
      if (run.guideSnapshot.source !== 'local') return false;
      const stored = await storedGuide(run.guideSnapshot.id);
      if (!stored || stored.source !== 'local' || !stored.steps.some((s) => s.id === stepId && s.target)) return false;
      run.fix = { stepToken: run.stepToken, at: Date.now() };
      run.rev += 1;
      await chrome.storage.session.set({ [runKey(tabId)]: run });
      return true;
    });
    if (!ok) {
      dlog('run', 'fix.refused', { tab: tabId }, { why: 'not the current step, not the author’s own guide, or not on its site' });
      return { ok: false };
    }
    dlog('run', 'fix.start', { tab: tabId });
    await broadcast(tabId);
    const msg: ContentPush = { type: 'pick.start' };
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      await endFix(tabId, 'no picker on the page');
      return { ok: false };
    }
    return { ok: true };
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
      const run = await getRun(tabId);
      const picking = !!run?.fix;
      // The run stays on the step it is on; its copy of the fixed step is the old one again.
      if (run && run.startedAt === rec.runId && applyRunStep(run, rec.runStep)) await chrome.storage.session.set({ [runKey(tabId)]: run });
      return { ...rec, stopPick: picking && !run?.fix };
    });
    if (done.stopPick) await stopPicker(tabId);
    dlog('run', 'fix.undone', { tab: tabId }, { step: done.stepIndex + 1 });
    await broadcast(tabId);
    await updateAllBadges();
    return { ok: true };
  },
};
