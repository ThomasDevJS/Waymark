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
const unitOf = (w: number) => Math.max(1, w / 1000);

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

/** The step's number in a circle at the highlight's top-left corner, kept inside the image. */
function drawBadge(ctx: OffscreenCanvasRenderingContext2D, label: string, hl: Box, w: number, h: number, u: number): void {
  const r = 13 * u;
  const cx = Math.min(w - r - 2, Math.max(r + 2, hl.x));
  const cy = Math.min(h - r - 2, Math.max(r + 2, hl.y));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = RING_COLOR;
  ctx.fill();
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(14 * u)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + u);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('could not read the image'));
    r.readAsDataURL(blob);
  });
}
