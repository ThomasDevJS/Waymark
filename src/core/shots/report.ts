/**
 * A frame's answer to shot.hide, checked in the service worker (D191). Content scripts are
 * untrusted: anything malformed counts as no answer, so that frame is painted over (and without
 * the top frame's answer there is no picture). Service worker only: the content script must not
 * import Zod.
 */
import { z } from 'zod';
import type { FrameReport } from './place';

const n = z.number().finite();
const BoxSchema = z.object({ x: n, y: n, w: n.positive(), h: n.positive() });
const ChildSchema = z.object({
  // The page never names frame ids: the service worker resolves them (resolveChildren).
  frameId: z.literal(-1),
  sel: z.string().max(2000).optional(),
  box: BoxSchema,
  content: z.object({ x: n, y: n, w: n.min(0), h: n.min(0) }),
  k: n.positive().max(100),
});

export const FrameReportSchema = z.object({
  vw: n.positive().max(100_000),
  vh: n.positive().max(100_000),
  dpr: n.positive().max(10),
  rect: BoxSchema.nullable(),
  frames: z.array(ChildSchema).max(100),
  more: z.boolean().optional(),
});

export function asFrameReport(v: unknown): FrameReport | null {
  const r = FrameReportSchema.safeParse(v);
  if (!r.success) return null;
  const { more, ...rest } = r.data;
  return more ? { ...rest, more } : rest;
}
