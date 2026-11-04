/**
 * Local Problems list (SPEC: Sharing and storage, "Report broken step"): saves the step and page
 * URL so the learner can copy a report for the author. No server in v1.
 */
import { enqueue } from './queue';

export interface Problem {
  guideId: string;
  guideTitle: string;
  stepId: string;
  stepTitle: string;
  stepIndex: number;
  url: string;
  at: string;
}

export const PROBLEMS_KEY = 'problems';
export const MAX_PROBLEMS = 200;

export function addProblem(p: Problem): Promise<void> {
  return enqueue(async () => {
    const list = ((await chrome.storage.local.get(PROBLEMS_KEY))[PROBLEMS_KEY] as Problem[] | undefined) ?? [];
    await chrome.storage.local.set({ [PROBLEMS_KEY]: [...list, p].slice(-MAX_PROBLEMS) });
  });
}

export async function listProblems(): Promise<Problem[]> {
  return ((await chrome.storage.local.get(PROBLEMS_KEY))[PROBLEMS_KEY] as Problem[] | undefined) ?? [];
}

/** Completion is saved locally (SPEC: Play, step 7). */
export function addCompletion(guideId: string, at: string): Promise<void> {
  return enqueue(async () => {
    const key = 'completions';
    const all = ((await chrome.storage.local.get(key))[key] as Record<string, string[]> | undefined) ?? {};
    all[guideId] = [...(all[guideId] ?? []), at].slice(-50);
    await chrome.storage.local.set({ [key]: all });
  });
}
