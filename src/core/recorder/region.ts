/**
 * Clickable regions (D82), shared by the recorder and Re-pick: a click on plain content inside a
 * card-like region records the region when it can be found again on its own, never anything else.
 */
import type { ElementFingerprint } from '../model/schema';
import { clickableRegion, composedParent, isInteractive, ownText, type ResolvedTarget } from '../fingerprint/dom';
import { hasStrongSignal } from '../matcher/signals';

export function hasInteractiveAncestor(el: Element): boolean {
  for (let p = composedParent(el); p; p = composedParent(p)) if (isInteractive(p)) return true;
  return false;
}

export interface Promoted {
  element: Element;
  fp: ElementFingerprint;
  /** The text clicked (or the region's own visible text), for the step title. */
  name?: string;
}

/**
 * The region to record instead of a low-confidence target, or null to keep the target.
 * The region must be one of a kind (not a card that shares its test id with its siblings), and
 * findable without its own text, which spans titles, counts and live data.
 */
export function promoteToRegion(t: ResolvedTarget, fpOf: (el: Element) => ElementFingerprint, why?: (reason: string) => void): Promoted | null {
  // `why` explains a null for the debug log (D110); it never changes the result.
  const no = (reason: string) => {
    why?.(reason);
    return null;
  };
  if (!t.lowConfidence) return null;
  const region = clickableRegion(t.element, why);
  if (!region) return null;
  if (hasInteractiveAncestor(region)) return no('the region is inside a control');
  const fp = fpOf(region);
  if (fp.instance === 'any' || fp.matchCount > 1) return no(`the region repeats (instance ${fp.instance}, ${fp.matchCount} alike)`);
  if (!hasStrongSignal({ ...fp, text: undefined })) return no('the region has nothing but its text to find it by');
  const name = ownText(t.element) ?? ownText(region);
  return { element: region, fp, ...(name ? { name } : {}) };
}
