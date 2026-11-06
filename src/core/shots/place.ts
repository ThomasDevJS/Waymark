/**
 * Where things are in a full-viewport screenshot (D190, D191). Pure: the service worker gathers
 * one report per frame Waymark runs in (content/shots.ts) and these functions:
 * - place each reporting frame in the top viewport, by adding up the content-box offsets of the
 *   iframes along the way (border and padding included, CSS transforms by their scale);
 * - list the areas to paint over: every embedded document whose frame did not confirm that it
 *   hid its own field text (no Waymark there, or no answer in time), and every object or embed;
 * - place the step's element, clipped to every frame it is inside;
 * - plan the stored image (at most MAX_W wide) and the element's box in it.
 * No Zod and no chrome.* here: the content script imports the types.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An embedded document in a frame's view, as that frame measured it (its own CSS pixels). */
export interface ChildFrame {
  /** The child's frameId, once the service worker has resolved it (resolveChildren); -1: unknown. */
  frameId: number;
  /** The token the child frame posted for this capture (D192); none for objects, embeds, and iframes without Waymark. */
  token?: string;
  /** The border box: painted over when the frame inside did not hide its fields. */
  box: Box;
  /** The content box: the child's viewport, where its own coordinates start. */
  content: Box;
  /** CSS scale of the iframe (its drawn width over its layout width); 1 without transforms. */
  k: number;
}

/** One frame's answer to shot.hide. */
export interface FrameReport {
  vw: number;
  vh: number;
  dpr: number;
  /** The step's element in this frame's viewport, when this frame was asked and has it. */
  rect: Box | null;
  /** Embedded documents in this frame's view. */
  frames: ChildFrame[];
  /** More embedded documents than were reported: the capture is refused (fail closed). */
  more?: boolean;
}

/** A frame placed in the top viewport: its point (0, 0), its scale, and what of it is visible. */
export interface Placed {
  ox: number;
  oy: number;
  k: number;
  clip: Box;
}

export interface Layout {
  placed: Map<number, Placed>;
  /** Areas to paint over, in top-viewport CSS pixels, already clipped to what is visible. */
  masks: Box[];
}

const finite = (...n: number[]) => n.every((v) => Number.isFinite(v));

/** The frame registry's links (registry.ts FrameMap): child frameId → its parent and iframe selector. */
export type FrameLinks = Readonly<Record<string, { parentFrameId: number; selector: string }>>;

/** How far a child's viewport may differ from its iframe's content box, in CSS pixels. */
const SIZE_SLACK = 2;

/**
 * Names each reported iframe's frameId (D191, D192). A frame cannot learn its children's ids, so
 * the service worker gives every frame a random token per capture; the frame posts it to its
 * parent, and the parent reports it with the iframe whose window sent it (contentWindow identity,
 * not a selector, which can be stale or shared). A child is named only when:
 * - exactly one reported iframe, in all frames, carries the token (a relayed token names nobody);
 * - the frame with that token answered, and the frame registry knows it as a child of this parent;
 * - its viewport is the size of the iframe's content box.
 * Anything else stays -1: painted over.
 */
export function resolveChildren(reports: ReadonlyMap<number, FrameReport>, links: FrameLinks, tokens: ReadonlyMap<number, string>): Map<number, FrameReport> {
  const byToken = new Map<string, number>();
  for (const [id, t] of tokens) byToken.set(t, byToken.has(t) ? -1 : id);
  const uses = new Map<string, number>();
  for (const r of reports.values()) for (const c of r.frames) if (c.token) uses.set(c.token, (uses.get(c.token) ?? 0) + 1);
  const out = new Map<number, FrameReport>();
  for (const [parent, r] of reports) {
    out.set(parent, {
      ...r,
      frames: r.frames.map((c) => {
        const id = c.token && uses.get(c.token) === 1 ? (byToken.get(c.token) ?? -1) : -1;
        const child = id > 0 ? reports.get(id) : undefined;
        const ok =
          !!child &&
          links[String(id)]?.parentFrameId === parent &&
          c.k > 0 &&
          Math.abs(child.vw - c.content.w / c.k) <= SIZE_SLACK &&
          Math.abs(child.vh - c.content.h / c.k) <= SIZE_SLACK;
        return { ...c, frameId: ok ? id : -1 };
      }),
    });
  }
  return out;
}

export function intersect(a: Box, b: Box): Box | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const toTop = (p: Placed, b: Box): Box => ({ x: p.ox + b.x * p.k, y: p.oy + b.y * p.k, w: b.w * p.k, h: b.h * p.k });

/**
 * Places every frame that answered, starting from the top frame (0), and lists what must be
 * painted over. A child counts as hidden only when its own frame answered (`reports` has its
 * frameId) and exactly one parent lists it. Anything else in view is masked: a frame without
 * Waymark, one that did not answer in time, an object or embed, an iframe with an unknown id.
 * Frames nobody lists (inside a masked frame, or off screen) are not placed.
 */
export function layoutFrames(reports: ReadonlyMap<number, FrameReport>): Layout | null {
  const top = reports.get(0);
  if (!top || !finite(top.vw, top.vh) || top.vw <= 0 || top.vh <= 0) return null;
  const placed = new Map<number, Placed>([[0, { ox: 0, oy: 0, k: 1, clip: { x: 0, y: 0, w: top.vw, h: top.vh } }]]);
  // A frame id listed by two parents is not trusted for either.
  const listed = new Map<number, number>();
  for (const r of reports.values()) for (const c of r.frames) if (c.frameId >= 0) listed.set(c.frameId, (listed.get(c.frameId) ?? 0) + 1);
  const masks: Box[] = [];
  const queue = [0];
  while (queue.length) {
    const id = queue.shift()!;
    const p = placed.get(id)!;
    const r = reports.get(id)!;
    for (const c of r.frames) {
      if (!finite(c.box.x, c.box.y, c.box.w, c.box.h)) continue;
      const box = intersect(toTop(p, c.box), p.clip);
      const ok =
        c.frameId > 0 && reports.has(c.frameId) && !placed.has(c.frameId) && listed.get(c.frameId) === 1 && finite(c.k, c.content.x, c.content.y, c.content.w, c.content.h) && c.k > 0;
      if (!ok) {
        if (box) masks.push(box);
        continue;
      }
      const content = toTop(p, c.content);
      const clip = intersect(content, p.clip) ?? { x: content.x, y: content.y, w: 0, h: 0 };
      placed.set(c.frameId, { ox: content.x, oy: content.y, k: p.k * c.k, clip });
      queue.push(c.frameId);
    }
  }
  return { placed, masks };
}

/** The element of frame `frameId` in the top viewport, clipped to every frame around it; null when not visible. */
export function placeElement(layout: Layout, frameId: number, rect: Box | null): Box | null {
  const p = layout.placed.get(frameId);
  if (!p || !rect || !finite(rect.x, rect.y, rect.w, rect.h)) return null;
  const vis = intersect(toTop(p, rect), p.clip);
  return vis && vis.w >= 2 && vis.h >= 2 ? vis : null;
}

/** Largest stored width, in image pixels (D190). */
export const MAX_W = 1600;
/** Largest stored height: tall windows are scaled down too. */
export const MAX_H = 2400;
/** WebP quality and the per-image size cap (D190). */
export const QUALITY = 0.7;
export const MAX_BYTES = 250_000;
/** Each try over the cap scales down by this much; after the last one nothing is stored. */
export const SHRINK = 0.8;
export const MAX_TRIES = 6;

export interface ImagePlan {
  /** The captured area kept: the part of the capture that shows the viewport. */
  sw: number;
  sh: number;
  /** Stored size. */
  dw: number;
  dh: number;
  /** Image pixels per CSS pixel in the stored image. */
  s: number;
  /** The element in the stored image. */
  box: Box;
  /** Areas to paint over in the stored image, rounded outward. */
  masks: Box[];
}

/**
 * The stored image for a capture of `iw` × `ih` pixels: the whole visible tab, scaled down to fit
 * MAX_W × MAX_H (and by `scaleDown` for the size cap). `dpr` converts CSS pixels to captured
 * pixels (the captured area can be narrower than the viewport, D183). Null when the element is
 * not in the captured area.
 */
export function planImage(el: Box, masks: Box[], iw: number, ih: number, dpr: number, scaleDown = 1): ImagePlan | null {
  if (!finite(iw, ih, dpr, el.x, el.y, el.w, el.h) || iw <= 0 || ih <= 0 || dpr <= 0 || dpr > 10) return null;
  const k = Math.min(1, MAX_W / iw, MAX_H / ih) * Math.min(1, Math.max(0.05, scaleDown));
  const dw = Math.max(1, Math.round(iw * k));
  const dh = Math.max(1, Math.round(ih * k));
  const s = dpr * k;
  const area = { x: 0, y: 0, w: dw, h: dh };
  const raw = { x: el.x * s, y: el.y * s, w: el.w * s, h: el.h * s };
  const vis = intersect(raw, area);
  if (!vis || vis.w < 2 || vis.h < 2) return null;
  const box = { x: Math.round(vis.x), y: Math.round(vis.y), w: Math.max(1, Math.round(vis.w)), h: Math.max(1, Math.round(vis.h)) };
  const out: Box[] = [];
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor(m.x * s));
    const y0 = Math.max(0, Math.floor(m.y * s));
    const x1 = Math.min(dw, Math.ceil((m.x + m.w) * s));
    const y1 = Math.min(dh, Math.ceil((m.y + m.h) * s));
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return { sw: iw, sh: ih, dw, dh, s, box, masks: out };
}

/**
 * Encodes at full size, then smaller until the image fits under the cap. `encode` gets the scale
 * (1, 0.8, 0.64…) and returns the image. Null when even the last try is too big.
 */
export async function fitUnderCap<T extends { size: number }>(encode: (scale: number) => Promise<T | null>, cap = MAX_BYTES, tries = MAX_TRIES): Promise<{ image: T; scale: number } | null> {
  let scale = 1;
  for (let i = 0; i < tries; i++) {
    const image = await encode(scale);
    if (!image) return null;
    if (image.size <= cap) return { image, scale };
    scale *= SHRINK;
  }
  return null;
}

/**
 * "Zoom to the element" (D194): a part of the image around the element, computed when the how-to
 * is drawn (the stored image stays whole). It keeps the image's shape, shows the element with
 * room around it, and is at least 40% of the image wide so the page stays recognisable.
 */
export function zoomRect(box: Box, w: number, h: number): Box {
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: Math.max(1, w), h: Math.max(1, h) };
  const aspect = w / h;
  const room = Math.max(box.w, box.h) * 0.75 + w * 0.06;
  let cw = Math.max(w * 0.4, box.w + 2 * room);
  let ch = cw / aspect;
  if (ch < box.h + 2 * room) {
    ch = box.h + 2 * room;
    cw = ch * aspect;
  }
  cw = Math.min(w, cw);
  ch = Math.min(h, ch);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.round(Math.min(w - cw, Math.max(0, cx - cw / 2)));
  const y = Math.round(Math.min(h - ch, Math.max(0, cy - ch / 2)));
  return { x, y, w: Math.round(Math.min(cw, w - x)), h: Math.round(Math.min(ch, h - y)) };
}
