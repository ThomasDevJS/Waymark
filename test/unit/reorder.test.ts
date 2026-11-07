/** D205 (#108): reordering steps by drag, by keyboard, and with Move to top / bottom. */
import { describe, expect, it } from 'vitest';
import { dropIndex, edgeScroll, moveItem } from '../../src/core/editor/reorder';

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
  it('a card makes way once the pointer passes its middle', () => {
    expect(dropIndex(spans, 3, 40)).toBe(0); // above card 1's middle: to the top
    expect(dropIndex(spans, 3, 60)).toBe(1);
    expect(dropIndex(spans, 3, 400)).toBe(3); // back where it was
    expect(dropIndex(spans, 0, 170)).toBe(1);
    expect(dropIndex(spans, 0, 500)).toBe(3);
  });
  it('dropped where it started, it stays', () => {
    expect(dropIndex(spans, 1, 150)).toBe(1);
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
