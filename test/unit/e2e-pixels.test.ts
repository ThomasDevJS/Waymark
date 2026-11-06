/** The e2e helper that finds a button in a stored screenshot (CI fix for PR #81). */
import { describe, expect, it } from 'vitest';
import { largestBlob } from '../e2e/helpers/pixels';

describe('largestBlob', () => {
  it('finds a solid rectangle and ignores scattered near-colour pixels around it (text fringes)', () => {
    const pts: [number, number][] = [];
    for (let y = 91; y < 125; y++) for (let x = 24; x < 147; x++) pts.push([x, y]);
    // Fringes of a heading right above, in the same column, and a stray pixel far away.
    for (let x = 24; x < 241; x += 3) pts.push([x, 49 + (x % 7)]);
    pts.push([600, 300]);
    expect(largestBlob(pts)).toEqual({ x: 24, y: 91, w: 123, h: 34 });
  });
  it('a plain bounding box of the same pixels would be wrong (the CI failure)', () => {
    const pts: [number, number][] = [];
    for (let y = 91; y < 125; y++) for (let x = 24; x < 147; x++) pts.push([x, y]);
    for (let x = 24; x < 241; x += 3) pts.push([x, 49]);
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...ys)).toBe(49);
    expect(largestBlob(pts)!.y).toBe(91);
  });
  it('no pixels: no box', () => {
    expect(largestBlob([])).toBeNull();
  });
});
