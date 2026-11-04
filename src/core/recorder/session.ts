/**
 * Recording state (SPEC: Recorder, "State"): lives in chrome.storage.session so it survives
 * page loads and service worker restarts. Pure functions; the service worker persists them.
 */
import type { Guide, Step } from '../model/schema';
import { newId } from '../model/ids';
import { safeLabel } from '../fingerprint/filters';
import { stepTitle } from '../text/templates';
import { routedPath, stepUrlRule, type UrlOptions } from '../url/url';

export const NAV_BELONGS_TO_CLICK_MS = 1500;

export interface RecordingState {
  guideId: string;
  title: string;
  lang: string;
  status: 'recording' | 'paused';
  tabIds: number[];
  steps: Step[];
  startedAt: string;
  startUrl: string;
  appOrigins: string[];
  /** Time (ms) of the last recorded action step, for the navigation rule. */
  lastActionAt: number;
  /** Last URL reported by each recording tab's top frame. */
  lastUrl: Record<string, string>;
  /** When each tab's top frame last started leaving the page (cross-document navigation). */
  leavingAt?: Record<string, number>;
}

/** What content scripts and the pill see. Never the steps themselves. */
export interface RecordingView {
  active: boolean;
  paused: boolean;
  count: number;
  lastStepTitle: string | null;
}

export function viewOf(state: RecordingState | null | undefined): RecordingView {
  if (!state) return { active: false, paused: false, count: 0, lastStepTitle: null };
  const lastStep = state.steps[state.steps.length - 1];
  return { active: true, paused: state.status === 'paused', count: state.steps.length, lastStepTitle: lastStep?.title ?? null };
}

export function startRecording(title: string, tabId: number, url: string, now = Date.now()): RecordingState {
  return {
    guideId: newId(),
    title: title.trim() || 'Untitled guide',
    lang: 'en',
    status: 'recording',
    tabIds: [tabId],
    steps: [],
    startedAt: new Date(now).toISOString(),
    startUrl: url,
    appOrigins: [new URL(url).origin],
    lastActionAt: 0,
    lastUrl: { [tabId]: url },
  };
}

export function isRecordingTab(state: RecordingState | null | undefined, tabId: number | undefined): boolean {
  return !!state && tabId !== undefined && state.tabIds.includes(tabId);
}

export function addOrigin(state: RecordingState, origin: string): void {
  if (!state.appOrigins.includes(origin)) state.appOrigins.push(origin);
}

/** Applies a recorder operation. Replace only touches the last step, and only if ids match. */
export function applyOp(state: RecordingState, op: { op: 'add'; step: Step } | { op: 'replace'; stepId: string; step: Step }, now = Date.now()): boolean {
  if (state.status !== 'recording') return false;
  if (op.op === 'add') {
    state.steps.push(op.step);
  } else {
    const last = state.steps[state.steps.length - 1];
    if (!last || last.id !== op.stepId) return false;
    state.steps[state.steps.length - 1] = { ...op.step, id: op.stepId };
  }
  if (op.step.kind !== 'note' && op.step.kind !== 'navigate') state.lastActionAt = now;
  return true;
}

export interface RouteReport {
  url: string;
  prevUrl: string | undefined;
  navigationType?: string;
  title?: string;
  now?: number;
  /** When the previous page started leaving, for full page loads (ms). */
  leavingAt?: number;
}

/** How long a "leaving" mark stays valid for the next page load in that tab. */
export const LEAVING_VALID_MS = 60_000;

/**
 * Navigation rule (SPEC: Recorder, "Navigation"): a navigation within 1.5 s of a recorded
 * action belongs to it. Others become a navigate step, except replace-type navigations and
 * query-only changes.
 */
export function navigationStep(state: RecordingState, r: RouteReport, opts: UrlOptions = {}): Step | null {
  if (state.status !== 'recording' || !r.prevUrl || r.prevUrl === r.url) return null;
  let a: URL;
  let b: URL;
  try {
    a = new URL(r.prevUrl);
    b = new URL(r.url);
  } catch {
    return null;
  }
  if (a.origin === b.origin && a.pathname === b.pathname && a.hash === b.hash) return null; // query-only
  if (r.navigationType === 'replace') return null;
  const now = r.now ?? Date.now();
  if (now - state.lastActionAt <= NAV_BELONGS_TO_CLICK_MS) return null;
  // A full page load belongs to the action if the old page started leaving within 1.5 s of
  // it, however long the new page took to arrive (docs/DECISIONS.md D21).
  if (r.leavingAt !== undefined && now - r.leavingAt <= LEAVING_VALID_MS && r.leavingAt - state.lastActionAt <= NAV_BELONGS_TO_CLICK_MS && r.leavingAt >= state.lastActionAt) return null;
  const pageTitle = safeLabel(r.title) ?? routedPath(b, opts);
  return {
    id: newId(),
    kind: 'navigate',
    title: stepTitle('navigate', { pageTitle }, state.lang),
    url: stepUrlRule(r.url, opts),
    advance: 'action',
  };
}

export function noteStep(state: RecordingState, title: string, note: string | undefined, url: string): Step {
  const step: Step = { id: newId(), kind: 'note', title: title.trim() || 'Note', url: stepUrlRule(url), advance: 'next' };
  if (note?.trim()) step.note = note.trim();
  void state;
  return step;
}

export function toGuide(state: RecordingState, now = Date.now()): Guide {
  return {
    id: state.guideId,
    schemaVersion: 1,
    revisionId: newId(),
    title: state.title,
    lang: state.lang,
    tags: [],
    appOrigins: state.appOrigins,
    startUrl: state.startUrl,
    matchUrls: [stepUrlRule(state.startUrl)],
    steps: state.steps,
    version: 1,
    source: 'local',
    updatedAt: new Date(now).toISOString(),
  };
}
