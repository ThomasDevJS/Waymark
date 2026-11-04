/**
 * Robustness suite (SPEC: Tech stack, "Robustness suite"): record on fixture version A,
 * replay on mutated version B, report the find rate and any wrong matches.
 */
import { describe, expect, it } from 'vitest';
import { recordAll, replayAll, summarize, type Outcome } from './harness';

const A = { seed: 1, layoutSeed: 1 };

describe('mutation set A: re-hashed classes, reordered siblings, extra wrappers', () => {
  const variants = [
    { name: 'rehash', opts: { seed: 2 } },
    { name: 'reorder', opts: { reorder: true, layoutSeed: 2 } },
    { name: 'wrap', opts: { wrap: true, layoutSeed: 3 } },
    ...[4, 5, 6, 7, 8].map((s) => ({ name: `all#${s}`, opts: { seed: s, reorder: true, wrap: true, layoutSeed: s } })),
  ];
  const all: Outcome[] = [];

  for (const v of variants) {
    it(`${v.name}: zero wrong matches`, () => {
      const fps = recordAll(A);
      const outcomes = replayAll(fps, v.opts);
      all.push(...outcomes);
      const s = summarize(outcomes);
      console.log(`[set A ${v.name}] found ${s.found}/${s.total} (${(s.rate * 100).toFixed(1)}%) wrong=${s.wrong.join(',') || 0} missing=${s.missing.join(' ') || '-'}`);
      expect(s.wrong).toEqual([]);
    });
  }

  it('95% or more found overall', () => {
    const s = summarize(all);
    console.log(`[set A total] found ${s.found}/${s.total} (${(s.rate * 100).toFixed(1)}%)`);
    expect(s.total).toBeGreaterThan(300);
    expect(s.rate).toBeGreaterThanOrEqual(0.95);
  });
});

describe('mutation set B: changed button text', () => {
  for (const [name, opts] of [
    ['text only', { changeText: true }],
    ['text + set A', { changeText: true, seed: 9, reorder: true, wrap: true, layoutSeed: 9 }],
  ] as const) {
    it(`${name}: wrong matches stay at zero`, () => {
      const outcomes = replayAll(recordAll(A), opts);
      const s = summarize(outcomes);
      console.log(`[set B ${name}] found ${s.found}/${s.total} wrong=${s.wrong.join(',') || 0}`);
      expect(s.wrong).toEqual([]);
    });
  }
});
