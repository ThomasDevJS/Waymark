/**
 * The Practice page's run loop (D128), pure. It stands in for the service worker's run state
 * (src/core/player/run.ts), which tutorials never touch: one page, one frame, no tabs, so it only
 * holds the step index and status, and builds the RunView that PlayerUI draws.
 */
import { NO_RUN, type RunOp, type RunView } from '../player/run';
import { toStep, type Tutorial } from './tutorials';

export interface TutorialRun {
  tutorial: Tutorial;
  stepIndex: number;
  status: 'running' | 'finished' | 'exited';
  /** Bumps on every step change, so a late advance or search result for an old step is ignored. */
  rev: number;
  muted: boolean;
}

export function startTutorial(tutorial: Tutorial, muted = false, stepIndex = 0): TutorialRun {
  return { tutorial, stepIndex: Math.min(Math.max(0, stepIndex), tutorial.steps.length - 1), status: 'running', rev: 1, muted };
}

/** Applies a learner action. `retry` keeps the step (the shell searches again). */
export function applyOp(run: TutorialRun, op: RunOp | 'retry' | 'restart'): TutorialRun {
  if (run.status !== 'running' && op !== 'restart' && op !== 'exit') return run;
  const last = run.tutorial.steps.length - 1;
  switch (op) {
    case 'done':
    case 'next':
    case 'skip':
      return run.stepIndex >= last ? { ...run, status: 'finished', rev: run.rev + 1 } : { ...run, stepIndex: run.stepIndex + 1, rev: run.rev + 1 };
    case 'back':
      return run.stepIndex === 0 ? run : { ...run, stepIndex: run.stepIndex - 1, rev: run.rev + 1 };
    case 'exit':
      return { ...run, status: 'exited', rev: run.rev + 1 };
    case 'restart':
      return { ...run, stepIndex: 0, status: 'running', rev: run.rev + 1 };
    case 'retry':
      return { ...run, rev: run.rev + 1 };
    default:
      return run;
  }
}

/** The view PlayerUI draws. The token changes on every step change, as in a real run. */
export function tutorialView(run: TutorialRun): RunView {
  const t = run.tutorial;
  const s = t.steps[run.stepIndex];
  return {
    ...NO_RUN,
    active: run.status !== 'exited',
    status: run.status === 'running' ? 'running' : run.status === 'finished' ? 'finished' : 'none',
    guideId: `tutorial:${t.id}`,
    guideTitle: t.title,
    stepIndex: run.stepIndex,
    total: t.steps.length,
    step: s && run.status === 'running' ? toStep(s) : null,
    stepToken: `${t.id}:${run.rev}`,
    runId: t.id,
    rev: run.rev,
    muted: run.muted,
    phase: 'found',
  };
}
