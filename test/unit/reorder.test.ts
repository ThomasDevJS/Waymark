/** D205 (#108): reordering steps by drag, by keyboard, and with Move to top / bottom. */
import { describe, expect, it } from 'vitest';
import { dropIndex, edgeScroll, moveItem } from '../../src/core/editor/reorder';
import { reordered } from '../../src/ui/useMotion';

describe('moveItem', () => {
  const steps = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  it('moves step 7 to the top in one go, and to the bottom', () => {
    expect(moveItem(steps, 6, 0)).toEqual(['s7', 's1', 's2', 's3', 's4', 's5', 's6', 's8']);
    expect(moveItem(steps, 0, 7)).toEqual(['s2', 's3', 's4', 's5', 's6', 's7', 's8', 's1']);
  });
  it('clamps the destination, ignores an unknown source, and returns the same array when nothing moves', () => {
    expect(moveItem(steps, 2, -5)[0]).toBe('s3');
    expect(moveItem(steps, 2, 99)[7]).toBe('s3');
    expect(moveItem(steps, 9, 0)).toBe(steps);
    expect(moveItem(steps, 3, 3)).toBe(steps);
    expect(steps).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']); // never changed in place
  });
});

describe('dropIndex', () => {
  // Four 100 px cards with 10 px gaps: middles at 50, 160, 270, 380.
  const spans = [0, 110, 220, 330].map((top) => ({ top, height: 100 }));
  it('the line passes a card once the dragged card\'s leading edge passes its middle', () => {
    expect(dropIndex(spans, 3, 0)).toBe(3); // not moved
    expect(dropIndex(spans, 3, -59)).toBe(3); // top at 271: not above card 3's middle (270) yet
    expect(dropIndex(spans, 3, -60)).toBe(2);
    expect(dropIndex(spans, 3, -290)).toBe(0); // top at 40: above card 1's middle
    expect(dropIndex(spans, 0, 61)).toBe(1); // bottom at 161: past card 2's middle
    expect(dropIndex(spans, 0, 400)).toBe(3);
  });
  it('review fix: a tall (open) card moves down past a short one as soon as its bottom edge passes it', () => {
    // An open 500 px card above two 60 px cards (middles at 540 and 610).
    const mixed = [
      { top: 0, height: 500 },
      { top: 510, height: 60 },
      { top: 580, height: 60 },
    ];
    expect(dropIndex(mixed, 0, 41)).toBe(1); // bottom at 541: past the first short card's middle
    expect(dropIndex(mixed, 0, 39)).toBe(0);
    expect(dropIndex(mixed, 2, -40)).toBe(1); // a short card going up: its top edge counts
    expect(dropIndex(mixed, 2, -331)).toBe(0); // top at 249: above the tall card's middle (250)
  });
});

describe('reordered (FLIP: what glides)', () => {
  const keys = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
  it('↑ / ↓ glide both swapped rows', () => {
    expect(reordered(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual(new Set(['a', 'b']));
  });
  it('review fix: one step moved across a long list glides alone, not every row between', () => {
    const before = keys(500);
    const after = ['s500', ...before.slice(0, 499)];
    expect(reordered(before, after)).toEqual(new Set(['s500']));
    const down = [...before.slice(1), 's1'];
    expect(reordered(before, down)).toEqual(new Set(['s1']));
    const mid = moveItem(keys(11), 6, 0) as string[];
    expect(reordered(keys(11), mid)).toEqual(new Set(['s7']));
  });
  it('two items moved: all the changed rows glide, as before', () => {
    expect(reordered(['a', 'b', 'c', 'd', 'e'], ['e', 'd', 'c', 'b', 'a']).size).toBe(4);
  });
});

describe('edgeScroll', () => {
  it('scrolls up near the top and down near the bottom, faster closer to the edge', () => {
    expect(edgeScroll(300, 0, 600)).toBe(0);
    expect(edgeScroll(40, 0, 600)).toBeLessThan(0);
    expect(edgeScroll(0, 0, 600)).toBe(-16);
    expect(edgeScroll(590, 0, 600)).toBeGreaterThan(0);
    expect(Math.abs(edgeScroll(5, 0, 600))).toBeGreaterThan(Math.abs(edgeScroll(40, 0, 600)));
  });
  it('a very short area has no edges', () => {
    expect(edgeScroll(10, 0, 100)).toBe(0);
  });
});
