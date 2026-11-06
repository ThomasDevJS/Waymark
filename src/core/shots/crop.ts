/**
 * Step screenshots for the printable how-to (D180–D186): which part of a captured viewport is
 * kept, and how big the stored image may be. Pure: the service worker draws and encodes.
 */

/** Context kept around the element, in CSS pixels, on each side (D182). */
export const CONTEXT_PX = 200;
/** Largest stored image, in image pixels. */
export const MAX_W = 800;
export const MAX_H = 800;
/** WebP quality, and the size cap a stored image must fit under (D182). */
export const QUALITY = 0.6;
export const MAX_BYTES = 60_000;
/** Each retry over the cap scales the image down by this much; after the last one it is dropped. */
export const SHRINK = 0.75;
export const MAX_TRIES = 5;

export interface ViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The viewport the rect was measured in, in CSS pixels. */
  vw: number;
  vh: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropPlan {
  /** The part of the captured image to keep, in image pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Size of the stored image. */
  dw: number;
  dh: number;
  /** The element within the stored image: the export draws the highlight from it. */
  box: Box;
}

const finite = (...n: number[]) => n.every((v) => Number.isFinite(v));

/**
 * The crop for an element's rect (CSS pixels, viewport coordinates) in a captured image of
 * `iw` × `ih` pixels. The visible part of the element plus CONTEXT_PX on each side, clamped to
 * the image, scaled down to fit MAX_W × MAX_H. Null when the element is not on screen.
 *
 * `pxPerCss` is the page's devicePixelRatio (which includes zoom): the capture is in device
 * pixels. Without it, the image is taken to cover the viewport exactly. The ratio is the safer
 * one: the visible area can be narrower than the layout viewport (a side panel opening).
 */
export function planCrop(rect: ViewportRect, iw: number, ih: number, scaleDown = 1, pxPerCss?: number): CropPlan | null {
  if (!finite(rect.x, rect.y, rect.w, rect.h, rect.vw, rect.vh, iw, ih) || rect.vw <= 0 || rect.vh <= 0 || iw <= 0 || ih <= 0) return null;
  // Image pixels per CSS pixel.
  const s = pxPerCss !== undefined && Number.isFinite(pxPerCss) && pxPerCss > 0 && pxPerCss <= 10 ? pxPerCss : iw / rect.vw;
  const ex0 = Math.max(0, rect.x);
  const ey0 = Math.max(0, rect.y);
  const ex1 = Math.min(rect.vw, rect.x + rect.w);
  const ey1 = Math.min(rect.vh, rect.y + rect.h);
  if (ex1 - ex0 < 2 || ey1 - ey0 < 2) return null; // off screen, or too thin to show
  const clampX = (v: number) => Math.min(iw, Math.max(0, Math.round(v * s)));
  const clampY = (v: number) => Math.min(ih, Math.max(0, Math.round(v * s)));
  // Not in the captured area (it can be narrower than the viewport).
  if (clampX(ex1) - clampX(ex0) < 2 || clampY(ey1) - clampY(ey0) < 2) return null;
  const sx = clampX(ex0 - CONTEXT_PX);
  const sy = clampY(ey0 - CONTEXT_PX);
  const sw = clampX(ex1 + CONTEXT_PX) - sx;
  const sh = clampY(ey1 + CONTEXT_PX) - sy;
  if (sw < 1 || sh < 1) return null;
  const k = Math.min(1, MAX_W / sw, MAX_H / sh) * Math.min(1, Math.max(0.05, scaleDown));
  const dw = Math.max(1, Math.round(sw * k));
  const dh = Math.max(1, Math.round(sh * k));
  const bx = (clampX(ex0) - sx) * k;
  const by = (clampY(ey0) - sy) * k;
  const box = {
    x: Math.round(bx),
    y: Math.round(by),
    w: Math.max(1, Math.min(dw - Math.round(bx), Math.round((clampX(ex1) - clampX(ex0)) * k))),
    h: Math.max(1, Math.min(dh - Math.round(by), Math.round((clampY(ey1) - clampY(ey0)) * k))),
  };
  return { sx, sy, sw, sh, dw, dh, box };
}

/**
 * Encodes at full size, then smaller until the image fits under the cap (D182). `encode` gets
 * the scale (1, 0.75, 0.56…) and returns the image. Null when even the last try is too big.
 */
export async function fitUnderCap<T extends { size: number }>(encode: (scale: number) => Promise<T | null>, cap = MAX_BYTES): Promise<{ image: T; scale: number } | null> {
  let scale = 1;
  for (let i = 0; i < MAX_TRIES; i++) {
    const image = await encode(scale);
    if (!image) return null;
    if (image.size <= cap) return { image, scale };
    scale *= SHRINK;
  }
  return null;
}
