/**
 * Recording state (SPEC: Recorder, "State"): lives in chrome.storage.session so it survives
 * page loads and service worker restarts. Pure functions; the service worker persists them.
 */
import type { Guide, Step } from '../model/schema';
import { newId } from '../model/ids';
import { safeLabel } from '../fingerprint/filters';
import { stepTitle } from '../text/templates';
import { normalizePath, routedPath, stepUrlRule, type UrlOptions } from '../url/url';
import { MAX_STEPS_PER_GUIDE } from '../model/schema';

export const NAV_BELONGS_TO_CLICK_MS = 1500;
/** Page and service worker read the same clock; allow a little slack between their reads. */
export const CLOCK_SKEW_MS = 250;
/** Event times from a page further than this from the service worker's clock are not used. */
export const MAX_EVENT_AGE_MS = 10_000;

/** A page-reported event time, or now when it is missing or implausible (content is untrusted). */
export function eventTime(at: number | undefined, now = Date.now()): number {
  // Never in the future: a later lastActionAt would hide the navigations that follow.
  return typeof at === 'number' && Number.isFinite(at) && now - at <= MAX_EVENT_AGE_MS && at - now <= CLOCK_SKEW_MS ? at : now;
}

export interface RecordingState {
  guideId: string;
  title: string;
  lang: string;
  status: 'recording' | 'paused';
  tabIds: number[];
  steps: Step[];
  startedAt: string;
  startUrl: string;
  /** URL rule of the page recording started on (pattern only, no query). */
  startRule?: Step['url'];
  appOrigins: string[];
  /** Time (ms) of the last recorded action step, for the navigation rule. */
  lastActionAt: number;
  /** Last URL reported by each recording tab's top frame. */
  lastUrl: Record<string, string>;
  /** When each tab's top frame last started leaving the page (cross-document navigation). */
  leavingAt?: Record<string, number>;
  /**
   * The navigate steps just added from route reports (the last ones in the list), with when and
   * in which tab each navigation happened. An action from that tab reported after them, but done
   * up to 1.5 s before them, takes them back (D67).
   */
  pendingNav?: { stepId: string; at: number; tabId?: number }[];
  /** Screenshots for the printable how-to are on for this recording (D180). */
  shots?: boolean;
  /** Chrome refused the last screenshot: the panel shows the one-click hint (D186). */
  shotHint?: boolean;
  /** Tabs and sites (`tabId|origin`) whose page was already shown the hint once. */
  shotHinted?: string[];
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

/**
 * The start URL kept in a guide: origin plus the path up to the first key-like segment, never
 * the query or fragment (they can carry emails, tokens or business data). Capped in length.
 */
export function safeStartUrl(url: string): string {
  const u = new URL(url);
  const segs = normalizePath(u.pathname).split('/');
  const cut = segs.findIndex((x) => x.startsWith(':'));
  const path = (cut === -1 ? segs : segs.slice(0, cut)).join('/') || '/';
  return (u.origin + path).slice(0, 1000);
}

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * How a tab's last URL is kept while recording: origin and path as they are, the query and the
 * fragment only as hashes, so navigations can be compared without storing their contents.
 */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search ? `?h=${fnv(u.search)}` : ''}${u.hash ? `#h${fnv(u.hash)}` : ''}`;
  } catch {
    return '';
  }
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
    startUrl: safeStartUrl(url),
    startRule: stepUrlRule(url),
    appOrigins: [new URL(url).origin],
    lastActionAt: 0,
    lastUrl: { [tabId]: urlKey(url) },
  };
}

export function isRecordingTab(state: RecordingState | null | undefined, tabId: number | undefined): boolean {
  return !!state && tabId !== undefined && state.tabIds.includes(tabId);
}

/** At most as many sites as a guide may have (GuideSchema), so the recording stays saveable. */
export const MAX_ORIGINS = 50;

export function addOrigin(state: RecordingState, origin: string): void {
  if (!state.appOrigins.includes(origin) && state.appOrigins.length < MAX_ORIGINS) state.appOrigins.push(origin);
}

/** Applies a recorder operation. Replace only touches the last step, and only if ids match. */
export function applyOp(state: RecordingState, op: { op: 'add'; step: Step } | { op: 'replace'; stepId: string; step: Step }, now = Date.now(), tabId?: number): boolean {
  if (state.status !== 'recording') return false;
  if (op.op === 'add') {
    if (state.steps.some((x) => x.id === op.step.id)) return false;
    const isAction = op.step.kind !== 'note' && op.step.kind !== 'navigate';
    // The route report of a navigation this action caused got here first (D67): the navigation
    // belongs to the action, so its navigate step goes.
    const pending = state.pendingNav ?? [];
    while (isAction) {
      const last = state.steps[state.steps.length - 1];
      const nav = pending.find((p) => p.stepId === last?.id);
      if (!last || !nav || nav.tabId !== tabId) break;
      // An action on the page the navigation led to cannot have caused it, however close in time.
      if (JSON.stringify(last.url) === JSON.stringify(op.step.url)) break;
      if (nav.at - now < -CLOCK_SKEW_MS || nav.at - now > NAV_BELONGS_TO_CLICK_MS) break;
      state.steps.pop();
    }
    delete state.pendingNav;
    if (state.steps.length >= MAX_STEPS_PER_GUIDE) return false;
    state.steps.push(op.step);
  } else {
    const last = state.steps[state.steps.length - 1];
    if (!last || last.id !== op.stepId) return false;
    state.steps[state.steps.length - 1] = { ...op.step, id: op.stepId };
  }
  if (op.step.kind !== 'note' && op.step.kind !== 'navigate') state.lastActionAt = Math.max(state.lastActionAt, now);
  return true;
}

export interface RouteReport {
  url: string;
  /** The tab's previous URL as stored (see urlKey). */
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
  if (state.status !== 'recording' || !r.prevUrl || r.prevUrl === urlKey(r.url)) return null;
  // A page that keeps changing its route must not push the recording past what can be saved (D48).
  if (state.steps.length >= MAX_STEPS_PER_GUIDE) return null;
  let a: URL;
  let b: URL;
  try {
    a = new URL(r.prevUrl);
    b = new URL(urlKey(r.url));
  } catch {
    return null;
  }
  if (a.origin === b.origin && a.pathname === b.pathname && a.hash === b.hash) return null; // query-only
  if (r.navigationType === 'replace') return null;
  const now = r.now ?? Date.now();
  if (now - state.lastActionAt <= NAV_BELONGS_TO_CLICK_MS) return null;
  // A full page load belongs to the action if the old page started leaving within 1.5 s of
  // it, however long the new page took to arrive (docs/DECISIONS.md D21).
  // (The service worker logs the action a little after the click itself, so the navigation can
  // start a few milliseconds "before" it: compare the gap either way.)
  if (r.leavingAt !== undefined && now - r.leavingAt <= LEAVING_VALID_MS && Math.abs(r.leavingAt - state.lastActionAt) <= NAV_BELONGS_TO_CLICK_MS) return null;
  const pageTitle = safeLabel(r.title) ?? routedPath(new URL(r.url), opts);
  return {
    id: newId(),
    kind: 'navigate',
    title: stepTitle('navigate', { pageTitle }, state.lang),
    url: stepUrlRule(r.url, opts),
    advance: 'action',
  };
}

export function noteStep(state: RecordingState, title: string, note: string | undefined, url: string): Step | null {
  if (state.steps.length >= MAX_STEPS_PER_GUIDE) return null;
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
    matchUrls: [state.startRule ?? stepUrlRule(state.startUrl)],
    steps: state.steps,
    version: 1,
    source: 'local',
    updatedAt: new Date(now).toISOString(),
  };
}
