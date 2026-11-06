/**
 * Marks a stored screenshot for the printable how-to (D188), in the side panel at export time:
 * the highlight is drawn from the stored box, and with `blur` everything but the element is
 * pixelated and blurred. Both are baked into the exported pixels: the file has no clear copy of
 * what is around the element. If blurring is not possible, the image is not made at all.
 * The stored image is never changed.
 */
import type { Box } from './crop';

/** Space between the element and its outline, in image pixels. */
export const OUTLINE_PAD = 4;
export const OUTLINE_COLOR = '#e8710a';

/** The outlined area: the element's box with padding, kept inside the image. */
export function highlightRect(box: Box, w: number, h: number, pad = OUTLINE_PAD): Box {
  const x = Math.max(0, Math.min(w - 1, box.x - pad));
  const y = Math.max(0, Math.min(h - 1, box.y - pad));
  const x1 = Math.max(x + 1, Math.min(w, box.x + box.w + pad));
  const y1 = Math.max(y + 1, Math.min(h, box.y + box.h + pad));
  return { x, y, w: x1 - x, h: y1 - y };
}

/** Blur applied after pixelation, relative to the image. */
export const blurPx = (w: number, h: number) => Math.max(6, Math.round(Math.max(w, h) / 80));
/**
 * Pixelation block: the background is drawn at 1/BLOCK of its size first, so text of any size is
 * averaged away (blur alone leaves large digits readable), then blurred.
 */
export const BLOCK = 12;

export interface StoredShot {
  blob: Blob;
  w: number;
  h: number;
  box: Box;
}

export async function renderShot(shot: StoredShot, opts: { blur: boolean }): Promise<Blob> {
  const bmp = await createImageBitmap(shot.blob);
  try {
    const { w, h } = shot;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const r = highlightRect(shot.box, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    if (opts.blur) {
      const small = new OffscreenCanvas(Math.max(1, Math.ceil(w / BLOCK)), Math.max(1, Math.ceil(h / BLOCK)));
      const sctx = small.getContext('2d');
      if (!sctx) throw new Error('no canvas');
      sctx.drawImage(bmp, 0, 0, small.width, small.height);
      const filter = `blur(${blurPx(w, h)}px)`;
      ctx.filter = filter;
      // Fail closed: a canvas that ignores filters would ship the clear picture.
      if (ctx.filter !== filter) throw new Error('blur is not supported');
      ctx.drawImage(small, 0, 0, w, h);
      ctx.filter = 'none';
      // The element itself stays sharp.
      ctx.drawImage(bmp, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    } else {
      ctx.drawImage(bmp, 0, 0, w, h);
    }
    // A white edge under the outline keeps it visible on dark and busy pages.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.strokeRect(r.x + 1.5, r.y + 1.5, Math.max(1, r.w - 3), Math.max(1, r.h - 3));
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x + 1.5, r.y + 1.5, Math.max(1, r.w - 3), Math.max(1, r.h - 3));
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  } finally {
    bmp.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('could not read the image'));
    r.readAsDataURL(blob);
  });
}
