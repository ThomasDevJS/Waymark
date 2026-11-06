/**
 * Draws a stored screenshot for the how-to (D193, D194), at export time, in an extension page:
 * the element's highlight (a rounded ring with a soft dim around it, like the player, and the
 * step's number), optionally a light blur of everything but the element, and optionally only the
 * part around the element ("Zoom to the element"). All of it is baked into the pixels of the
 * result: with blur on, the file has no clear copy of what is around the element (a CSS blur
 * would ship the clear image). The stored image is never changed.
 */
import { intersect, zoomRect, type Box } from './place';

export const RING_COLOR = '#e8710a';
/** The dim around the highlighted element (the player's lighter scrim). */
export const DIM = 'rgba(15, 23, 42, 0.28)';

export interface StoredShot {
  blob: Blob;
  w: number;
  h: number;
  box: Box;
  /** 2: the whole page (D190); missing: a 0.5.0 close-up, drawn as it is (D196). */
  v?: number;
  /** Image pixels per CSS pixel, when known (D190). */
  px?: number;
}

export interface RenderOptions {
  /** Light blur of everything but the element (D193). Off by default. */
  blur?: boolean;
  /** Only the part around the element (D194). Ignored for old close-ups, which already are one. */
  zoom?: boolean;
  /** The step's number, drawn next to the highlight. */
  n?: number;
}

/** Size unit for strokes and the badge: about one CSS pixel on a typical capture. */
export const unitOf = (w: number) => Math.max(1, w / 1000);

/**
 * The blur's standard deviation in image pixels: about 3.5 CSS pixels, which leaves boxes, menus
 * and headings recognisable and makes body text unreadable (D193). D188's pixelation plus a
 * blur of 1/80 of the image is about three times stronger.
 */
export function blurPx(shot: Pick<StoredShot, 'w' | 'px'>): number {
  const px = shot.px !== undefined && Number.isFinite(shot.px) && shot.px > 0 && shot.px <= 10 ? shot.px : shot.w / 1280;
  return Math.max(2, Math.round(3.5 * px * 10) / 10);
}

/** The highlighted area: the element's box with some room, kept inside the image. */
export function highlightRect(box: Box, w: number, h: number, pad = 4): Box {
  const x = Math.max(0, Math.min(w - 1, box.x - pad));
  const y = Math.max(0, Math.min(h - 1, box.y - pad));
  const x1 = Math.max(x + 1, Math.min(w, box.x + box.w + pad));
  const y1 = Math.max(y + 1, Math.min(h, box.y + box.h + pad));
  return { x, y, w: x1 - x, h: y1 - y };
}

/** What part of the stored image is drawn, and where the element is in the result. */
export function renderPlan(shot: Pick<StoredShot, 'w' | 'h' | 'box' | 'v'>, zoom: boolean): { src: Box; box: Box } {
  const full = { x: 0, y: 0, w: shot.w, h: shot.h };
  const src = zoom && shot.v === 2 ? zoomRect(shot.box, shot.w, shot.h) : full;
  const vis = intersect(shot.box, src) ?? { x: src.x, y: src.y, w: 1, h: 1 };
  return { src, box: { x: vis.x - src.x, y: vis.y - src.y, w: vis.w, h: vis.h } };
}

function roundRect(ctx: OffscreenCanvasRenderingContext2D, r: Box, rad: number): void {
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(rad, r.w / 2, r.h / 2));
}

export async function renderShot(shot: StoredShot, opts: RenderOptions = {}): Promise<Blob> {
  const bmp = await createImageBitmap(shot.blob);
  try {
    const { src, box } = renderPlan(shot, !!opts.zoom);
    const w = src.w;
    const h = src.h;
    const u = unitOf(shot.w);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const hl = highlightRect(box, w, h, 4 * u);
    const rad = 8 * u;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    if (opts.blur) {
      const r = blurPx(shot);
      const filter = `blur(${r}px)`;
      ctx.filter = filter;
      // Fail closed: a canvas that ignores filters would ship the clear picture.
      if (ctx.filter !== filter) throw new Error('blur is not supported');
      // Drawn a little larger than the canvas, so the edges do not fade to white.
      const m = Math.ceil(r * 2);
      ctx.drawImage(bmp, src.x - m, src.y - m, w + 2 * m, h + 2 * m, -m, -m, w + 2 * m, h + 2 * m);
      ctx.filter = 'none';
      // The element itself stays sharp.
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, hl, rad);
      ctx.clip();
      ctx.drawImage(bmp, src.x, src.y, w, h, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(bmp, src.x, src.y, w, h, 0, 0, w, h);
    }
    // A soft dim around the element.
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    roundRect(ctx, hl, rad);
    ctx.fillStyle = DIM;
    ctx.fill('evenodd');
    // The ring: a white edge under the orange keeps it visible on dark and busy pages.
    ctx.lineJoin = 'round';
    for (const [color, width] of [
      ['#fff', 6 * u],
      [RING_COLOR, 3 * u],
    ] as const) {
      ctx.beginPath();
      roundRect(ctx, { x: hl.x + width / 2 - 1.5 * u, y: hl.y + width / 2 - 1.5 * u, w: Math.max(1, hl.w - width + 3 * u), h: Math.max(1, hl.h - width + 3 * u) }, rad);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    if (opts.n !== undefined) drawBadge(ctx, String(opts.n), hl, w, h, u);
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  } finally {
    bmp.close();
  }
}

/**
 * Where the step-number badge goes (D158): outside the highlight, so it never covers the element
 * (it hid the start of a small tab label, #87). Spots are tried in order, top-left first as before,
 * then the other corners, then the sides; the first that lies wholly in the image and clear of the
 * highlight and its ring wins. If none fits, a smaller badge is tried; only then inside the box.
 */
export function badgeSpot(hl: Box, w: number, h: number, u: number): { cx: number; cy: number; r: number } {
  const edge = 2;
  const ring = 5 * u; // the ring is drawn this far outside the highlight
  const full = 13 * u;
  // A badge about as tall as a small target, never under 9 (readable), never over 13.
  const sized = Math.max(9 * u, Math.min(full, Math.min(hl.w, hl.h) * 0.75));
  for (const r of [sized, 9 * u]) {
    // Measured from the ring's outer edge, so a spot is clear of everything drawn for the element.
    const o = { x: hl.x - ring, y: hl.y - ring, w: hl.w + 2 * ring, h: hl.h + 2 * ring };
    const d = r + 2 * u; // centre this far from that edge
    const diag = d / Math.SQRT2;
    const left = o.x - d;
    const right = o.x + o.w + d;
    const top = o.y - d;
    const bottom = o.y + o.h + d;
    const midX = hl.x + hl.w / 2;
    const midY = hl.y + hl.h / 2;
    const spots: [number, number][] = [
      [o.x - diag, o.y - diag],
      [o.x + o.w + diag, o.y - diag],
      [o.x - diag, o.y + o.h + diag],
      [o.x + o.w + diag, o.y + o.h + diag],
      [left, midY],
      [right, midY],
      [midX, top],
      [midX, bottom],
      // Along an edge, off-centre: a long, flat element at the top of the image (a nav bar).
      [left, hl.y + r],
      [right, hl.y + r],
    ];
    for (const [cx, cy] of spots) {
      if (cx - r < edge || cy - r < edge || cx + r > w - edge || cy + r > h - edge) continue;
      // Clear of the highlight plus the ring: the distance from the centre to that box.
      const dx = Math.max(hl.x - ring - cx, 0, cx - (hl.x + hl.w + ring));
      const dy = Math.max(hl.y - ring - cy, 0, cy - (hl.y + hl.h + ring));
      if (Math.hypot(dx, dy) >= r + u) return { cx, cy, r };
    }
  }
  // The element fills the image: inside its top-left corner, as before.
  const r = 9 * u;
  return { cx: Math.min(w - r - edge, Math.max(r + edge, hl.x + r + 2 * u)), cy: Math.min(h - r - edge, Math.max(r + edge, hl.y + r + 2 * u)), r };
}

/** The step's number in a circle beside the highlight (badgeSpot). */
function drawBadge(ctx: OffscreenCanvasRenderingContext2D, label: string, hl: Box, w: number, h: number, u: number): void {
  const { cx, cy, r } = badgeSpot(hl, w, h, u);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = RING_COLOR;
  ctx.fill();
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + r * 0.08);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('could not read the image'));
    r.readAsDataURL(blob);
  });
}
