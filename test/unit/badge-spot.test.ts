/** D158 (#87): the step-number badge sits beside the highlighted element, never on it. */
import { describe, expect, it } from 'vitest';
import { badgeSpot } from '../../src/core/shots/render';
import type { Box } from '../../src/core/shots/place';

const RING = 5;
/** True when the badge circle touches the highlight or its ring. */
const overlaps = (s: { cx: number; cy: number; r: number }, hl: Box) => {
  const dx = Math.max(hl.x - RING - s.cx, 0, s.cx - (hl.x + hl.w + RING));
  const dy = Math.max(hl.y - RING - s.cy, 0, s.cy - (hl.y + hl.h + RING));
  return Math.hypot(dx, dy) < s.r;
};
const inside = (s: { cx: number; cy: number; r: number }, w: number, h: number) => s.cx - s.r >= 0 && s.cy - s.r >= 0 && s.cx + s.r <= w && s.cy + s.r <= h;

describe('badgeSpot (D158)', () => {
  it('a small tab touching the top of the image (the owner: "Safety" read "afety"): beside it, not on it', () => {
    const hl = { x: 304, y: 2, w: 86, h: 40 };
    const s = badgeSpot(hl, 1600, 1013, 1);
    expect(overlaps(s, hl)).toBe(false);
    expect(inside(s, 1600, 1013)).toBe(true);
  });

  it('an element in each corner of the image keeps its whole box free', () => {
    const W = 800;
    const H = 450;
    for (const hl of [
      { x: 0, y: 0, w: 60, h: 20 },
      { x: W - 60, y: 0, w: 60, h: 20 },
      { x: 0, y: H - 20, w: 60, h: 20 },
      { x: W - 60, y: H - 20, w: 60, h: 20 },
    ]) {
      const s = badgeSpot(hl, W, H, 1);
      expect(overlaps(s, hl), JSON.stringify(hl)).toBe(false);
      expect(inside(s, W, H), JSON.stringify(hl)).toBe(true);
    }
  });

  it('a long flat bar across the top of the image: still beside it', () => {
    const hl = { x: 0, y: 0, w: 800, h: 30 };
    const s = badgeSpot(hl, 800, 450, 1);
    expect(overlaps(s, hl)).toBe(false);
    expect(inside(s, 800, 450)).toBe(true);
  });

  it('with room, at the top-left corner, outside, as before', () => {
    const hl = { x: 300, y: 200, w: 120, h: 40 };
    const s = badgeSpot(hl, 800, 450, 1);
    expect(s.cx).toBeLessThan(hl.x);
    expect(s.cy).toBeLessThan(hl.y);
    expect(overlaps(s, hl)).toBe(false);
  });

  it('sized to the target: smaller beside a small element, readable at the least, scaled with the image', () => {
    expect(badgeSpot({ x: 300, y: 200, w: 120, h: 40 }, 800, 450, 1).r).toBe(13);
    expect(badgeSpot({ x: 300, y: 200, w: 14, h: 14 }, 800, 450, 1).r).toBe(10.5);
    expect(badgeSpot({ x: 300, y: 200, w: 6, h: 6 }, 800, 450, 1).r).toBe(9);
    expect(badgeSpot({ x: 600, y: 400, w: 240, h: 80 }, 1600, 900, 2).r).toBe(26);
  });

  it('an element that fills the image: inside it, within the image (nowhere else to go)', () => {
    const s = badgeSpot({ x: 0, y: 0, w: 800, h: 450 }, 800, 450, 1);
    expect(inside(s, 800, 450)).toBe(true);
  });
});
