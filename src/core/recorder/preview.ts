/**
 * What a click at this event path would record (D153), for the hover outline while recording.
 * The same choice as the recorder's: the clickable region of D82 when a plain-content click can be
 * promoted, otherwise the target itself, low-confidence. Pure: no chrome.*, no drawing.
 */
import type { ElementFingerprint } from '../model/schema';
import { isInteractive, resolveTargetFromPath, tagOf } from '../fingerprint/dom';
import { hasStrongSignal } from '../matcher/signals';
import { hasInteractiveAncestor, promoteToRegion } from './region';

/** ok: found again reliably; warn: recorded but "hard to find" (D82); skip: not recorded (D47). */
export type PreviewTone = 'ok' | 'warn' | 'skip';

export interface ClickPreview {
  element: Element;
  tone: PreviewTone;
}

/**
 * The recorder's own rules, in its order (recorder.ts onClick, flagsFor, add): null where it
 * ignores the click, so the outline never promises a step that will not come (review of D153).
 */
export function previewClick(path: EventTarget[], fpOf: (el: Element) => ElementFingerprint): ClickPreview | null {
  const t = resolveTargetFromPath(path);
  if (!t) return null;
  if (t.lowConfidence) {
    const up = promoteToRegion(t, fpOf);
    if (up) return { element: up.element, tone: 'ok' };
  }
  const el = t.element;
  const tag = tagOf(el);
  if (tag === 'html' || tag === 'body') return null; // a click on the page itself
  if (t.lowConfidence && hasInteractiveAncestor(el)) return null; // the control records it
  if (!hasStrongSignal(fpOf(el))) return { element: el, tone: 'skip' };
  // The flags the side panel shows after recording: low-confidence, canvas, closed component.
  const closedShadow = tag.includes('-') && !el.shadowRoot && !isInteractive(el) && el.childElementCount === 0;
  if (t.lowConfidence || tag === 'canvas' || closedShadow) return { element: el, tone: 'warn' };
  return { element: el, tone: 'ok' };
}
