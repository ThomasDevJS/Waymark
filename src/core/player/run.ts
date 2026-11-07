/**
 * Run state (SPEC: Player, "Runs across pages"): stored per tab in chrome.storage.session
 * (key run:<tabId>) with a snapshot of the guide, so a run continues on the copy it started
 * with even if the guide is edited. Pure functions; the service worker persists them.
 */
import type { ElementFingerprint, Guide, RunState, Step } from '../model/schema';
import { matchPath, routedPath, urlMatches, type UrlOptions } from '../url/url';
import type { Shade } from './shade';

export type RunOp = 'done' | 'next' | 'back' | 'skip' | 'exit';

/** Why the current step changed; the content script waits 300 ms after an action. */
export type StepCause = 'start' | 'action' | 'next' | 'back' | 'skip' | 'resume';

export interface Run extends RunState {
  /** Changes every time the step changes, so stale reports can be told apart. */
  stepToken: string;
  /** Increases with every change to the run; content scripts ignore older views. */
  rev: number;
  /** Set on a paused run: the tab the run moved to (D36). */
  movedTo?: number;
  /** The step token last read aloud: each step is spoken once, whatever path changed it (D41). */
  spokenToken?: string;
  cause: StepCause;
  /**
   * The author is picking the right element for the current step (issue #95, D210): set by
   * "Pick the right element", for this step token only. Content scripts hide the player meanwhile.
   */
  fix?: { stepToken: string; at: number };
  /**
   * A report link's Fix step N (D212): open the player's pick once a frame finds this step token's
   * element. Not found: the not-found card shows, with its own Pick the right element.
   */
  fixWhenFound?: string;
}

export function startRun(guide: Guide, now = Date.now(), startIndex = 0): Run {
  return {
    guideSnapshot: structuredClone(guide), // the exact copy the run started with
    stepIndex: Math.min(startIndex, Math.max(0, guide.steps.length - 1)),
    status: guide.steps.length ? 'running' : 'finished',
    startedAt: new Date(now).toISOString(),
    stepToken: token(),
    cause: 'start',
    rev: 1,
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
  run.rev = (run.rev ?? 0) + 1;
  return true;
}

/** The step a learner should start at: the first step whose page matches the current URL. */
export function stepForUrl(guide: Guide, url: string, opts: UrlOptions = {}): number {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return -1;
  }
  if (!guide.appOrigins.includes(u.origin)) return -1;
  const path = routedPath(u, opts);
  return guide.steps.findIndex((s) => matchPath(s.url, path));
}

/** True when the URL is on the guide's start page (the first step's page). */
export function onStartPage(guide: Guide, url: string, opts: UrlOptions = {}): boolean {
  const first = guide.steps[0];
  if (!first) return false;
  try {
    const u = new URL(url);
    return guide.appOrigins.includes(u.origin) && matchPath(first.url, routedPath(u, opts));
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
  /** The guide's language: the panel offers the HD voice only for English guides (D140). */
  lang?: string;
  appOrigins: string[];
  stepIndex: number;
  total: number;
  step: Step | null;
  stepToken: string | null;
  cause: StepCause | null;
  /** Run identity (start time) and revision, so a content script can drop out-of-order views. */
  runId: string | null;
  rev: number;
  /** Voice muted (a global setting, shown by the tooltip's toggle). */
  muted: boolean;
  /**
   * The shade around the highlight, already resolved for this run (D145): only the level, never
   * the learner's settings or the guide's own field. Optional: older views have none.
   */
  shade?: Shade;
  /** Frame token chosen to draw the current step, or null while searching. */
  winner: string | null;
  /** 'not-found' once the top frame gave up and no frame found the target. */
  phase: 'searching' | 'found' | 'not-found';
  /** The board for this step, or null before any report (#36). */
  boardId: string | null;
  /** The guide is the author's own (`source: 'local'`): the player offers Pick the right element (D210). */
  fixable?: boolean;
  /** A pick for the current step is under way: the player hides until it ends (D210). */
  fixing?: boolean;
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
  runId: null,
  rev: 0,
  muted: false,
  winner: null,
  phase: 'searching',
  boardId: null,
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
    lang: run.guideSnapshot.lang,
    appOrigins: run.guideSnapshot.appOrigins,
    stepIndex: run.stepIndex,
    total: run.guideSnapshot.steps.length,
    step,
    stepToken: run.stepToken,
    cause: run.cause,
    runId: run.startedAt,
    rev: run.rev ?? 0,
    muted: false,
    winner: board?.winner ?? null,
    phase: board?.winner ? 'found' : board?.topGaveUp ? 'not-found' : 'searching',
    boardId: board?.id ?? null,
    fixable: run.guideSnapshot.source === 'local',
    fixing: fixPending(run),
  };
}

/** How long a pick from the player may take; the service worker refuses a later answer (D210). */
export const FIX_TTL_MS = 120_000;

/** True while a pick for the run's current step is under way and not timed out (D210). */
export function fixPending(run: Run, now = Date.now()): boolean {
  return run.status === 'running' && !!run.fix && run.fix.stepToken === run.stepToken && now - run.fix.at >= 0 && now - run.fix.at <= FIX_TTL_MS;
}

/** The guide with one step replaced (matched by id); null when the step is gone (D210). */
export function withStep(guide: Guide, step: Step): Guide | null {
  const i = guide.steps.findIndex((s) => s.id === step.id);
  if (i < 0) return null;
  const steps = guide.steps.slice();
  steps[i] = step;
  return { ...guide, steps };
}

/** The guide's step with its element replaced by a picked one; null when the step is gone or has no element (D210). */
export function fixedStep(guide: Guide, stepId: string, target: ElementFingerprint): Step | null {
  const step = guide.steps.find((s) => s.id === stepId);
  if (!step?.target) return null;
  // An element the author chose: the recorder's warnings about the old one no longer apply.
  const { flags: _flags, ...rest } = step;
  return { ...rest, target };
}

/**
 * Moves the run onto a changed step (D210, a fix or its Undo): the snapshot gets that step, and
 * when it is the current step, the step starts again (a new token, so every frame searches for
 * the new element). Other steps stay as they were when the run started. A step already read
 * aloud is not read again.
 */
export function applyRunStep(run: Run, step: Step): boolean {
  const next = withStep(run.guideSnapshot, step);
  if (!next) return false;
  run.guideSnapshot = next;
  if (currentStep(run)?.id === step.id) {
    // Only a pick for this step ends: one for another step goes on (review of D210).
    delete run.fix;
    const spoken = run.spokenToken === run.stepToken;
    run.stepToken = token();
    if (spoken) run.spokenToken = run.stepToken;
    run.cause = 'resume';
  }
  run.rev = (run.rev ?? 0) + 1;
  return true;
}

/** Per-step match reports from every frame (SPEC: Element targeting, playback step 8). */
export interface MatchBoard {
  stepToken: string;
  /** Keyed by frameId. */
  reports: Record<string, { frameId: number; token: string; found: boolean; score: number; margin: number; instance: 'unique' | 'any'; pathMatches: boolean; /** Strong signals the match used (D211). */ strong?: number; /** The reporting document (sender.documentId), to tell a frame that is gone (D84). */ doc?: string }>;
  winner: string | null;
  topGaveUp: boolean;
  /** New for every board: a frame resends its report only when the board holding it was replaced (#36). */
  id?: string;
  /** When each reporting document was last asked whether it still exists (D84). */
  checked?: Record<string, number>;
}

/**
 * On a full page load: if the current step is a click or submit whose page we just left, and
 * the new page is the next step's page, the action happened even though its "done" report may
 * have died with the old page (for example while the service worker was starting). See D32.
 */
export function shouldCatchUp(run: Run, url: string, opts: UrlOptions = {}): boolean {
  if (run.status !== 'running') return false;
  const step = currentStep(run);
  const next = run.guideSnapshot.steps[run.stepIndex + 1];
  if (!step || !next || (step.kind !== 'click' && step.kind !== 'submit')) return false;
  const origins = run.guideSnapshot.appOrigins;
  return !urlMatches(step.url, url, origins, opts) && urlMatches(next.url, url, origins, opts);
}

/**
 * A new tab takes the run only when it opened on the page of the run's current step (the
 * click on the link has already advanced the run), not for any same-origin tab (D36).
 */
export function newTabContinuesRun(run: Run, url: string, opts: UrlOptions = {}): boolean {
  const step = currentStep(run);
  return run.status === 'running' && !!step && urlMatches(step.url, url, run.guideSnapshot.appOrigins, opts);
}
