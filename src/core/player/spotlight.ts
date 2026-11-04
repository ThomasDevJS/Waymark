/**
 * Spotlight geometry (SPEC: Player, "Overlay"): four dimmed panels around the target's box
 * plus 6 px padding. The target stays clickable through the gap.
 */
export const SPOTLIGHT_PADDING = 6;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Panels (top, bottom, left, right) for a hole in a viewport of vw x vh, in viewport coordinates. */
export function spotlightPanels(target: Box, vw: number, vh: number, pad = SPOTLIGHT_PADDING): { hole: Box; panels: Box[] } {
  const left = Math.max(0, Math.min(vw, target.x - pad));
  const top = Math.max(0, Math.min(vh, target.y - pad));
  const right = Math.max(left, Math.min(vw, target.x + target.w + pad));
  const bottom = Math.max(top, Math.min(vh, target.y + target.h + pad));
  const hole = { x: left, y: top, w: right - left, h: bottom - top };
  const panels = [
    { x: 0, y: 0, w: vw, h: top },
    { x: 0, y: bottom, w: vw, h: Math.max(0, vh - bottom) },
    { x: 0, y: top, w: left, h: hole.h },
    { x: right, y: top, w: Math.max(0, vw - right), h: hole.h },
  ];
  return { hole, panels };
}
