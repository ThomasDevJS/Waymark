/** Repeated elements and ambiguity (SPEC: Robustness suite; M1 acceptance). */
import { describe, expect, it } from 'vitest';
import { matchOnce } from '../../src/core/matcher';
import { recordAll, render, replayAll } from './harness';

const A = { seed: 1, layoutSeed: 1 };

/** Review H1 look-alikes: told apart only by title, image alt, input value or radio value. */
const LOOKALIKES_H1 = ['dr-edit', 'dr-delete', 'dr-archive', 'dr-duplicate', 'dr-save', 'dr-publish', 'dr-public', 'dr-private'];
/** Review M6: custom toggles whose native input is visually hidden. */
const TOGGLES = ['tg-autosave', 'tg-beta'];

describe('repeated elements', () => {
  it("row buttons record as instance 'any'; unique look-alikes record as 'unique'", () => {
    const fps = recordAll(A);
    for (const k of ['row-edit', 'row-delete', 'row-view']) {
      expect(fps.get(k)!.instance, k).toBe('any');
      expect(fps.get(k)!.matchCount, k).toBe(5);
    }
    for (const k of ['pf-save', 'bl-save', 'pf-cancel', 'bl-cancel', 'card-starter-choose', 'card-team-choose', 'tb-new', 'nav-orders']) {
      expect(fps.get(k)!.instance, k).toBe('unique');
    }
  });

  it("look-alikes that share only a name or a link back to the page record as 'unique' (review H1)", () => {
    const fps = recordAll(A);
    for (const k of LOOKALIKES_H1) {
      expect(fps.get(k)!.instance, k).toBe('unique');
      expect(fps.get(k)!.matchCount, k).toBe(1);
    }
    expect(fps.get('dr-edit')!.hrefPath).toBeUndefined();
    expect(fps.get('dr-private')!.value).toBe('private');
  });

  it('row buttons play back on any row, and a click on any tied row counts', () => {
    const fps = recordAll(A);
    const keys = render({ seed: 3, reorder: true, wrap: true, layoutSeed: 3 });
    for (const k of ['row-edit', 'row-delete', 'row-view']) {
      const r = matchOnce(document, fps.get(k)!);
      expect(r.status, k).toBe('found');
      if (r.status !== 'found') continue;
      const rows = keys.get(k)!;
      expect(rows).toContain(r.element);
      expect(new Set(r.tied)).toEqual(new Set(rows));
      // spotlight goes to the first visible tied candidate in document order
      expect(r.element).toBe(r.tied[0]);
    }
  });

  it('unique look-alikes never match the wrong one, across many layouts', () => {
    const fps = recordAll(A);
    for (let s = 10; s < 20; s++) {
      const outcomes = replayAll(fps, { seed: s, reorder: true, wrap: true, layoutSeed: s });
      const lookalikes = outcomes.filter((o) => /^(pf|bl)-(save|cancel)$|choose$|^dr-|^tg-/.test(o.key));
      expect(lookalikes.length).toBe(6 + LOOKALIKES_H1.length + TOGGLES.length);
      expect(lookalikes.filter((o) => o.result === 'wrong')).toEqual([]);
      expect(lookalikes.every((o) => o.result === 'found')).toBe(true);
    }
  });
});

describe('ambiguity returns not-found', () => {
  it('an identical twin of a unique element makes it ambiguous', () => {
    const fps = recordAll(A);
    for (const k of ['pf-save', 'tb-import', 'card-team-choose', 'sw-dark', 'nav-orders', 'dr-edit', 'dr-archive', 'dr-publish', 'dr-private']) {
      render({ twin: [k] });
      const r = matchOnce(document, fps.get(k)!);
      expect(r.status, k).toBe('not-found');
    }
  });

  it('an identical twin of a shadow DOM widget makes its elements ambiguous (review H2)', () => {
    const fps = recordAll(A);
    for (const k of ['sh-launch', 'sh-input']) {
      const keys = render({ twin: ['widget#host'] });
      expect(keys.get(`${k}#twin`), k).toHaveLength(1);
      const r = matchOnce(document, fps.get(k)!);
      expect(r, k).toMatchObject({ status: 'not-found', reason: 'ambiguous' });
    }
  });

  it('when the recorded element is gone, its look-alike is not taken instead', () => {
    const fps = recordAll(A);
    for (const [k, other] of [
      ['pf-save', 'bl-save'],
      ['bl-cancel', 'pf-cancel'],
      ['card-starter-choose', 'card-team-choose'],
      ['dr-edit', 'dr-delete'],
      ['dr-archive', 'dr-duplicate'],
      ['dr-publish', 'dr-save'],
      ['dr-private', 'dr-public'],
      ['tg-autosave', 'tg-beta'],
      // told apart only by their container's id, in the CSS path (D55; ant.design date pickers)
      ['date-basic', 'date-other'],
      ['date-other', 'date-basic'],
    ] as const) {
      const keys = render({ remove: [k] });
      const r = matchOnce(document, fps.get(k)!);
      expect(r.status === 'found' && keys.get(other)!.includes(r.element), `${k} -> ${other}`).toBe(false);
      expect(r.status, k).toBe('not-found');
    }
  });

  it('look-alikes that lose every distinguishing signal are not guessed', () => {
    const fps = recordAll(A);
    const keys = render({ unlabel: ['profile', 'billing'], reorder: true, layoutSeed: 4, wrap: true });
    for (const k of ['pf-save', 'bl-save']) {
      const r = matchOnce(document, fps.get(k)!);
      if (r.status === 'found') expect(keys.get(k)).toContain(r.element);
    }
  });
});
