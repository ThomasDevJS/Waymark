/**
 * Signals, weights and the score formula (SPEC: Element targeting, "At playback" step 3).
 *
 *   score = 100 * sum(weights of matched signals) / sum(weights of signals present in the fingerprint)
 */
import type { ElementFingerprint } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { getRole, rawAccessibleName, rawOwnText, tagOf } from '../fingerprint/dom';
import { buildAncestors, buildCssPath, buildXPath, landmarksEqual, GUIDE_ID_ATTR } from '../fingerprint/selectors';
import { normText } from '../text/normalize';
import { linkPath } from '../url/url';

export type SignalKey =
  | 'testId'
  | 'id'
  | 'roleName'
  | 'text'
  | 'name'
  | 'href'
  | 'placeholder'
  | 'css'
  | 'ancestors'
  | 'xpath'
  | 'position';

export const WEIGHTS: Readonly<Record<SignalKey, number>> = {
  testId: 40,
  id: 25,
  roleName: 25,
  text: 20,
  name: 15,
  href: 10,
  placeholder: 10,
  css: 10,
  ancestors: 10,
  xpath: 5,
  position: 5,
};

export const STRONG: ReadonlySet<SignalKey> = new Set<SignalKey>(['testId', 'id', 'roleName', 'text', 'name', 'href']);

/** Signals that only describe where an element is, not what it is. */
export const POSITIONAL: ReadonlySet<SignalKey> = new Set<SignalKey>(['xpath', 'position']);

export const ACCEPT_SCORE = 60;
export const UNIQUE_MARGIN = 15;

/** Signals the fingerprint actually has. Tag (or role) is a filter, not a signal. */
export function presentSignals(fp: ElementFingerprint): SignalKey[] {
  const out: SignalKey[] = [];
  if (fp.testId || fp.guideId) out.push('testId');
  if (fp.id) out.push('id');
  if (fp.role && fp.accessibleName) out.push('roleName');
  if (fp.text) out.push('text');
  if (fp.name) out.push('name');
  if (fp.hrefPath) out.push('href');
  if (fp.placeholder) out.push('placeholder');
  if (fp.cssPath) out.push('css');
  out.push('ancestors'); // an empty landmark list is also information
  if (fp.xpath) out.push('xpath');
  if (fp.rect && fp.rect.vw > 0) out.push('position');
  return out;
}

export interface ScoreContext {
  profile?: ProfileOptions;
  /** Base URL for link paths (the frame's document URL). */
  base: string;
}

export interface Scored {
  element: Element;
  score: number;
  matched: SignalKey[];
  strongMatched: boolean;
  /** Sum of weights of matched non-positional signals. */
  coreWeight: number;
}

/** Document-coordinate rect, as stored in fingerprints. */
export function docRect(el: Element): ElementFingerprint['rect'] {
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  const sx = win?.scrollX ?? 0;
  const sy = win?.scrollY ?? 0;
  return {
    x: Math.round(r.left + sx),
    y: Math.round(r.top + sy),
    w: Math.round(r.width),
    h: Math.round(r.height),
    vw: win?.innerWidth ?? 0,
    vh: win?.innerHeight ?? 0,
  };
}

/** Close to the recorded spot: centers within max(40px, 5% of the viewport) on each axis, x scaled to the current width. */
export function positionMatches(rec: ElementFingerprint['rect'], now: ElementFingerprint['rect']): boolean {
  if (!rec.vw || !now.vw || (now.w === 0 && now.h === 0)) return false;
  const scale = now.vw / rec.vw;
  const rx = (rec.x + rec.w / 2) * scale;
  const ry = rec.y + rec.h / 2;
  const nx = now.x + now.w / 2;
  const ny = now.y + now.h / 2;
  return Math.abs(rx - nx) <= Math.max(40, 0.05 * now.vw) && Math.abs(ry - ny) <= Math.max(40, 0.05 * now.vh);
}

function signalMatches(key: SignalKey, el: Element, fp: ElementFingerprint, ctx: ScoreContext): boolean {
  switch (key) {
    case 'testId': {
      if (fp.guideId && el.getAttribute(GUIDE_ID_ATTR) !== fp.guideId) return false;
      if (fp.testId) {
        if (el.getAttribute(fp.testId.attr) !== fp.testId.value) return false;
      }
      return true;
    }
    case 'id':
      return el.getAttribute('id') === fp.id;
    case 'roleName':
      return getRole(el) === fp.role && normText(rawAccessibleName(el)) === normText(fp.accessibleName);
    case 'text':
      return normText(rawOwnText(el)) === normText(fp.text);
    case 'name':
      return el.getAttribute('name') === fp.name;
    case 'href': {
      const href = el.getAttribute('href');
      return href !== null && linkPath(href, ctx.base) === fp.hrefPath;
    }
    case 'placeholder':
      return normText(el.getAttribute('placeholder')) === normText(fp.placeholder);
    case 'css':
      try {
        return el.matches(fp.cssPath) || buildCssPath(el, ctx.profile) === fp.cssPath;
      } catch {
        return false;
      }
    case 'ancestors':
      return landmarksEqual(buildAncestors(el), fp.ancestors);
    case 'xpath':
      return buildXPath(el) === fp.xpath;
    case 'position':
      return positionMatches(fp.rect, docRect(el));
  }
}

export function scoreCandidate(el: Element, fp: ElementFingerprint, ctx: ScoreContext, present = presentSignals(fp)): Scored {
  let total = 0;
  let got = 0;
  let coreWeight = 0;
  let strongMatched = false;
  const matched: SignalKey[] = [];
  for (const key of present) {
    const w = WEIGHTS[key];
    total += w;
    if (signalMatches(key, el, fp, ctx)) {
      got += w;
      matched.push(key);
      if (STRONG.has(key)) strongMatched = true;
      if (!POSITIONAL.has(key)) coreWeight += w;
    }
  }
  return { element: el, score: total ? (100 * got) / total : 0, matched, strongMatched, coreWeight };
}

/** Tag (or role) filter: a candidate must keep the recorded tag, or the recorded role. */
export function passesTagFilter(el: Element, fp: ElementFingerprint): boolean {
  if (tagOf(el) === fp.tag) return true;
  return !!fp.role && getRole(el) === fp.role;
}
