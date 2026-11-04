/**
 * Cross-frame winner (SPEC: Element targeting, "At playback" step 8): each frame's matcher
 * reports its best score and margin; the service worker picks one winner by frameId. Only
 * the winning frame draws the spotlight and tooltip.
 */
import { UNIQUE_MARGIN } from './signals';

export interface FrameReport {
  frameId: number;
  found: boolean;
  score: number;
  margin: number;
  instance: 'unique' | 'any';
  /** True when this frame's path matches the step's recorded framePath. */
  pathMatches?: boolean;
}

/**
 * Picks the frame that should draw, or null. A frame on the recorded framePath wins when it
 * found the element. Otherwise the best-scoring frame wins; for 'unique' steps it must also
 * lead every other frame by the unique margin, so two frames never both claim the target.
 */
export function pickWinnerFrame(reports: FrameReport[]): number | null {
  const found = reports.filter((r) => r.found).sort((a, b) => b.score - a.score || a.frameId - b.frameId);
  if (!found.length) return null;
  const onPath = found.filter((r) => r.pathMatches);
  if (onPath.length === 1) return onPath[0]!.frameId;
  const pool = onPath.length > 1 ? onPath : found;
  const best = pool[0]!;
  const second = pool[1];
  if (second && best.instance === 'unique' && best.score - second.score < UNIQUE_MARGIN) return null;
  return best.frameId;
}
