/**
 * What a click at this event path would record (D153), for the hover outline while recording.
 * The same choice as the recorder's: the clickable region of D82 when a plain-content click can be
 * promoted, otherwise the target itself, low-confidence. Pure: no chrome.*, no drawing.
 */
import type { ElementFingerprint } from '../model/schema';
import { resolveTargetFromPath, tagOf } from '../fingerprint/dom';
import { hasStrongSignal } from '../matcher/signals';
import { promoteToRegion } from './region';

/** ok: found again reliably; warn: recorded but "hard to find" (D82); skip: not recorded (D47). */
export type PreviewTone = 'ok' | 'warn' | 'skip';

export interface ClickPreview {
  element: Element;
  tone: PreviewTone;
}

export function previewClick(path: EventTarget[], fpOf: (el: Element) => ElementFingerprint): ClickPreview | null {
  const t = resolveTargetFromPath(path);
  if (!t) return null;
  if (t.lowConfidence) {
    const up = promoteToRegion(t, fpOf);
    if (up) return { element: up.element, tone: 'ok' };
  }
  const fp = fpOf(t.element);
  if (!hasStrongSignal(fp)) return { element: t.element, tone: 'skip' };
  if (t.lowConfidence || tagOf(t.element) === 'canvas') return { element: t.element, tone: 'warn' };
  return { element: t.element, tone: 'ok' };
}
