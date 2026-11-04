/**
 * Run state (SPEC: Player, "Runs across pages"): stored per tab in chrome.storage.session
 * (key run:<tabId>) with a snapshot of the guide, so a run continues on the copy it started
 * with even if the guide is edited. Pure functions; the service worker persists them.
 */
import type { Guide, RunState, Step } from '../model/schema';
import { matchPath, routedPath } from '../url/url';

export type RunOp = 'done' | 'next' | 'back' | 'skip' | 'exit';

/** Why the current step changed; the content script waits 300 ms after an action. */
export type StepCause = 'start' | 'action' | 'next' | 'back' | 'skip' | 'resume';

export interface Run extends RunState {
  /** Changes every time the step changes, so stale reports can be told apart. */
  stepToken: string;
  cause: StepCause;
}

export function startRun(guide: Guide, now = Date.now(), startIndex = 0): Run {
  return {
    guideSnapshot: structuredClone(guide), // the exact copy the run started with
    stepIndex: Math.min(startIndex, Math.max(0, guide.steps.length - 1)),
    status: guide.steps.length ? 'running' : 'finished',
    startedAt: new Date(now).toISOString(),
    stepToken: token(),
    cause: 'start',
  };
}

function token(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function currentStep(run: Run): Step | undefined {
  return run.status === 'finished' ? undefined : run.guideSnapshot.steps[run.stepIndex];
}

/**
 * Applies a learner or advance operation for `stepId`. Returns false when it is stale (the
 * run is no longer on that step), so duplicate reports from several frames are harmless.
 * 'exit' is handled by the caller (the run is deleted).
 */
export function applyRunOp(run: Run, op: Exclude<RunOp, 'exit'>, stepId: string): boolean {
  if (run.status !== 'running') return false;
  const step = currentStep(run);
  if (!step || step.id !== stepId) return false;
  const last = run.guideSnapshot.steps.length - 1;
  if (op === 'back') {
    if (run.stepIndex === 0) return false;
    run.stepIndex -= 1;
    run.cause = 'back';
  } else if (run.stepIndex >= last) {
    run.status = 'finished';
    run.cause = op === 'done' ? 'action' : op;
  } else {
    run.stepIndex += 1;
    run.cause = op === 'done' ? 'action' : op;
  }
  run.stepToken = token();
  return true;
}

/** The step a learner should start at: the first step whose page matches the current URL. */
export function stepForUrl(guide: Guide, url: string): number {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return -1;
  }
  if (!guide.appOrigins.includes(u.origin)) return -1;
  const path = routedPath(u);
  return guide.steps.findIndex((s) => matchPath(s.url, path));
}

/** True when the URL is on the guide's start page (the first step's page). */
export function onStartPage(guide: Guide, url: string): boolean {
  const first = guide.steps[0];
  if (!first) return false;
  try {
    const u = new URL(url);
    return guide.appOrigins.includes(u.origin) && matchPath(first.url, routedPath(u));
  } catch {
    return false;
  }
}

/** What content scripts see of a run: the current step only, never the whole guide. */
export interface RunView {
  active: boolean;
  status: 'running' | 'paused' | 'finished' | 'none';
  guideId: string | null;
  guideTitle: string | null;
  appOrigins: string[];
  stepIndex: number;
  total: number;
  step: Step | null;
  stepToken: string | null;
  cause: StepCause | null;
  /** Frame token chosen to draw the current step, or null while searching. */
  winner: string | null;
  /** 'not-found' once the top frame gave up and no frame found the target. */
  phase: 'searching' | 'found' | 'not-found';
}

export const NO_RUN: RunView = {
  active: false,
  status: 'none',
  guideId: null,
  guideTitle: null,
  appOrigins: [],
  stepIndex: 0,
  total: 0,
  step: null,
  stepToken: null,
  cause: null,
  winner: null,
  phase: 'searching',
};

export function runView(run: Run | null | undefined, match?: MatchBoard): RunView {
  if (!run) return NO_RUN;
  const step = currentStep(run) ?? null;
  const board = match && match.stepToken === run.stepToken ? match : undefined;
  return {
    active: true,
    status: run.status,
    guideId: run.guideSnapshot.id,
    guideTitle: run.guideSnapshot.title,
    appOrigins: run.guideSnapshot.appOrigins,
    stepIndex: run.stepIndex,
    total: run.guideSnapshot.steps.length,
    step,
    stepToken: run.stepToken,
    cause: run.cause,
    winner: board?.winner ?? null,
    phase: board?.winner ? 'found' : board?.topGaveUp ? 'not-found' : 'searching',
  };
}

/** Per-step match reports from every frame (SPEC: Element targeting, playback step 8). */
export interface MatchBoard {
  stepToken: string;
  reports: Record<string, { frameId: number; found: boolean; score: number; margin: number; instance: 'unique' | 'any'; pathMatches: boolean }>;
  winner: string | null;
  topGaveUp: boolean;
}
