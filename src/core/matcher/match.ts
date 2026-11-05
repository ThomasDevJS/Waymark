/**
 * The matcher (SPEC: Element targeting, "At playback" steps 1-7).
 * Rule: highlighting the wrong element is worse than "not found"; never fall back to a guess.
 */
import type { ElementFingerprint } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { compareDocumentOrder, cssEscape, displayBox, isEnabled, isVisible as layoutVisible } from '../fingerprint/dom';
import { GUIDE_ID_ATTR } from '../fingerprint/selectors';
import { gatherCandidates, searchRoots } from './candidates';
import {
  ACCEPT_SCORE,
  IDENTIFYING,
  POSITIONAL,
  UNIQUE_MARGIN,
  passesTagFilter,
  presentSignals,
  scoreCandidate,
  type Scored,
  type SignalKey,
} from './signals';

export interface MatchOptions {
  profile?: ProfileOptions;
  /** Visibility test; defaults to a layout-based check. */
  isVisible?: (el: Element) => boolean;
  /** Base URL for link paths; defaults to the document URL. */
  base?: string;
}

export type NotFoundReason = 'no-candidates' | 'no-strong-signal' | 'below-threshold' | 'ambiguous' | 'lookalike';

export type MatchResult =
  | {
      status: 'found';
      element: Element;
      /** For instance 'any': every tied candidate (a click on any of them counts). Otherwise [element]. */
      tied: Element[];
      /**
       * The element whose box the overlay outlines: `element` itself, or the visible <label> of a
       * visually hidden control (a custom checkbox or switch). A click on that label reaches
       * `element`, so advancing still listens on `tied` (docs/DECISIONS.md R7).
       */
      spotlight: Element;
      score: number;
      /** Lead over the best non-tied candidate (100 when there is none). */
      margin: number;
      matched: SignalKey[];
      via: 'fast-path' | 'score';
    }
  | {
      status: 'not-found';
      reason: NotFoundReason;
      bestScore: number;
      runnerUpScore: number;
      matched: SignalKey[];
    };

/**
 * SPEC playback step 1: a unique match on data-guide-id or a test id wins. Unique means one
 * match across every searched root together (all twin widgets, or every shadow root when the
 * shadow path broke), never one per root (docs/DECISIONS.md R6).
 */
function fastPath(doc: Document, fp: ElementFingerprint, isVis: (el: Element) => boolean): Element | null {
  const roots = searchRoots(doc, fp);
  const sels: string[] = [];
  if (fp.guideId) sels.push(`[${GUIDE_ID_ATTR}="${cssEscape(fp.guideId)}"]`);
  if (fp.testId) sels.push(`[${cssEscape(fp.testId.attr)}="${cssEscape(fp.testId.value)}"]`);
  for (const sel of sels) {
    const found: Element[] = [];
    for (const root of roots) {
      try {
        found.push(...Array.from(root.querySelectorAll(sel)));
      } catch {
        break;
      }
    }
    if (found.length === 1) {
      const el = found[0]!;
      if (passesTagFilter(el, fp) && displayBox(el, isVis) && isEnabled(el)) return el;
    }
  }
  return null;
}

/**
 * Score every visible, enabled candidate; sorted best first, ties in document order. A visually
 * hidden control counts as visible when its label is (custom checkboxes and switches).
 */
export function scoreAll(doc: Document, fp: ElementFingerprint, opts: MatchOptions = {}): Scored[] {
  const isVis = opts.isVisible ?? layoutVisible;
  const base = opts.base ?? doc.URL;
  const present = presentSignals(fp);
  const ctx = { profile: opts.profile, base, isVisible: isVis };
  return gatherCandidates(doc, fp, { profile: opts.profile, base, isVisible: isVis })
    .filter((el) => displayBox(el, isVis) !== null && isEnabled(el))
    .map((el) => scoreCandidate(el, fp, ctx, present))
    .sort((a, b) => b.score - a.score || compareDocumentOrder(a.element, b.element));
}

/** True when `b` matched every non-positional signal `a` matched: only position could tell them apart. */
function coreCovers(b: Scored, a: Scored): boolean {
  return a.matched.filter((k) => !POSITIONAL.has(k)).every((k) => b.matched.includes(k));
}

function coreKey(s: Scored): string {
  return s.matched.filter((k) => !POSITIONAL.has(k)).join(',');
}

/** One matching pass, no waiting. */
export function matchOnce(doc: Document, fp: ElementFingerprint, opts: MatchOptions = {}): MatchResult {
  const isVis = opts.isVisible ?? layoutVisible;
  const spotlight = (el: Element) => displayBox(el, isVis) ?? el;
  const fast = fastPath(doc, fp, isVis);
  if (fast) {
    return { status: 'found', element: fast, tied: [fast], spotlight: spotlight(fast), score: 100, margin: 100, matched: ['testId'], via: 'fast-path' };
  }

  const scored = scoreAll(doc, fp, opts);
  const best = scored[0];
  if (!best) return { status: 'not-found', reason: 'no-candidates', bestScore: 0, runnerUpScore: 0, matched: [] };

  const notFound = (reason: NotFoundReason, runnerUp = scored[1]?.score ?? 0): MatchResult => ({
    status: 'not-found',
    reason,
    bestScore: best.score,
    runnerUpScore: runnerUp,
    matched: best.matched,
  });

  // The tied group must share a signal that identifies an element. A group held together only by
  // a shared name or link path (a radio group, `commit` buttons) is not interchangeable: such a
  // fingerprint (crafted, imported or older) is held to the unique rules (DECISIONS R5).
  if (fp.instance === 'any' && best.matched.some((k) => IDENTIFYING.has(k))) {
    // Tied = same matched non-positional signals; position may differ (another row of the table).
    const qualifies = (s: Scored) => s.strongMatched && s.score >= ACCEPT_SCORE;
    const bestCore = coreKey(best);
    const group = scored.filter((s) => qualifies(s) && coreKey(s) === bestCore);
    if (!best.strongMatched) return notFound('no-strong-signal');
    if (best.score < ACCEPT_SCORE) return notFound('below-threshold');
    const ordered = group.map((s) => s.element).sort(compareDocumentOrder);
    const others = scored.filter((s) => !group.includes(s));
    const margin = best.score - (others[0]?.score ?? 0);
    return {
      status: 'found',
      element: ordered[0]!,
      tied: ordered,
      spotlight: spotlight(ordered[0]!),
      score: best.score,
      margin: others.length ? margin : 100,
      matched: best.matched,
      via: 'score',
    };
  }

  const runnerUp = scored[1];
  if (!best.strongMatched) return notFound('no-strong-signal');
  if (best.score < ACCEPT_SCORE) return notFound('below-threshold');
  if (runnerUp) {
    if (best.score - runnerUp.score < UNIQUE_MARGIN) return notFound('ambiguous');
    // Stricter than the spec's margin rule (see docs/DECISIONS.md): a lead built only from
    // position (XPath, nearby spot) is not enough to pick one of two otherwise identical elements.
    if (coreCovers(runnerUp, best)) return notFound('ambiguous');
  }
  // The best candidate matched nothing that a look-alike seen at record time lacked: it may be
  // that look-alike while the real target is missing or not rendered yet (D57).
  const core = best.matched.filter((k) => !POSITIONAL.has(k));
  if (fp.lookalikes?.some((set) => core.every((k) => set.includes(k)))) return notFound('lookalike');
  return {
    status: 'found',
    element: best.element,
    tied: [best.element],
    spotlight: spotlight(best.element),
    score: best.score,
    margin: runnerUp ? best.score - runnerUp.score : 100,
    matched: best.matched,
    via: 'score',
  };
}

/** At most this many look-alike profiles are stored per fingerprint. */
export const MAX_LOOKALIKES = 5;

/**
 * Record time, in one scoring pass (SPEC record step 3; D57):
 * - `count`: visible, enabled elements that match every non-positional signal (more than one
 *   means a repeated element);
 * - `lookalikes`: for every other element with a strong signal (visible or not, enabled or not:
 *   a hidden tab or a collapsed demo can be shown later), the non-positional signals it matched.
 *   Only maximal sets are kept (a set inside another refuses nothing more), most weight first.
 * Playback refuses a unique match that matched no more than one of these sets. Score is not a
 * filter: position and XPath can lift a weak look-alike over 60 once the target is gone.
 */
export function recordTimeScan(doc: Document, fp: ElementFingerprint, target: Element, opts: MatchOptions = {}): { count: number; lookalikes: string[][] } {
  const isVis = opts.isVisible ?? layoutVisible;
  const base = opts.base ?? doc.URL;
  const present = presentSignals(fp);
  const core = present.filter((k) => !POSITIONAL.has(k));
  const ctx = { profile: opts.profile, base, isVisible: isVis };
  const all = gatherCandidates(doc, fp, { profile: opts.profile, base, isVisible: () => true }).map((el) => scoreCandidate(el, fp, ctx, present));
  const shown = (s: Scored) => displayBox(s.element, isVis) !== null && isEnabled(s.element);
  const count = all.filter((s) => shown(s) && core.every((k) => s.matched.includes(k))).length;
  const sets = new Map<string, { keys: string[]; weight: number }>();
  for (const s of all) {
    if (s.element === target || !s.strongMatched) continue;
    const keys = s.matched.filter((k) => !POSITIONAL.has(k)).sort();
    sets.set(keys.join(','), { keys, weight: s.coreWeight });
  }
  const list = [...sets.values()];
  const maximal = list.filter((a) => !list.some((b) => b !== a && b.keys.length > a.keys.length && a.keys.every((k) => b.keys.includes(k))));
  maximal.sort((a, b) => b.weight - a.weight);
  return { count, lookalikes: maximal.slice(0, MAX_LOOKALIKES).map((x) => x.keys) };
}
