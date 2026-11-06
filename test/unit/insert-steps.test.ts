/** D202: steps recorded into an existing guide go in at the chosen place, as a new version. */
import { describe, expect, it } from 'vitest';
import { insertRecorded, planInsertStop } from '../../src/core/recorder/insert';
import { MAX_STEPS_PER_GUIDE, type Guide, type Step } from '../../src/core/model/schema';

const step = (id: string): Step => ({ id, kind: 'note', title: id, url: { kind: 'prefix', value: '/' }, advance: 'next' });
const guide = (ids: string[]): Guide => ({
  id: 'g', schemaVersion: 1, revisionId: 'r1', title: 'G', lang: 'en', tags: [], appOrigins: ['https://a.test'], startUrl: 'https://a.test/', matchUrls: [],
  steps: ids.map(step), version: 3, source: 'local', updatedAt: '',
});

describe('insertRecorded (D202)', () => {
  it('puts the new steps before index `at`, at the start, in the middle and at the end', () => {
    const ids = (g: Guide) => g.steps.map((s) => s.id);
    expect(ids(insertRecorded(guide(['a', 'b']), [step('x'), step('y')], 1, []))).toEqual(['a', 'x', 'y', 'b']);
    expect(ids(insertRecorded(guide(['a', 'b']), [step('x')], 0, []))).toEqual(['x', 'a', 'b']);
    expect(ids(insertRecorded(guide(['a', 'b']), [step('x')], 2, []))).toEqual(['a', 'b', 'x']);
    expect(ids(insertRecorded(guide(['a', 'b']), [step('x')], 99, []))).toEqual(['a', 'b', 'x']); // clamped
  });
  it('is a new version: version up, a new revision, the recording’s new sites added once', () => {
    const g = insertRecorded(guide(['a']), [step('x')], 1, ['https://a.test', 'https://b.test'], 0);
    expect(g.version).toBe(4);
    expect(g.revisionId).not.toBe('r1');
    expect(g.appOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(g.updatedAt).toBe(new Date(0).toISOString());
  });
  it('a clashing step id gets a fresh one; over the step limit it refuses', () => {
    const g = insertRecorded(guide(['a']), [step('a')], 1, []);
    expect(new Set(g.steps.map((s) => s.id)).size).toBe(2);
    expect(() => insertRecorded(guide(Array.from({ length: MAX_STEPS_PER_GUIDE }, (_, i) => `s${i}`)), [step('x')], 0, [])).toThrow(/at most/);
  });
});

describe('planInsertStop: what Stop does with a recording into a guide (review of D202)', () => {
  const rec = (n: number, title = 'G', base = 'r1') => ({ title, steps: Array.from({ length: n }, (_, i) => step(`n${i}`)), appOrigins: ['https://a.test'], insert: { at: 1, baseRevisionId: base } });
  it('into the guide when it is unchanged and the steps fit', () => {
    const p = planInsertStop(guide(['a', 'b']), rec(2));
    expect(p.kind).toBe('insert');
    if (p.kind === 'insert') expect(p.guide.steps.map((s) => s.id)).toEqual(['a', 'n0', 'n1', 'b']);
  });
  it('their own guide when the guide changed, went, is a team guide, or the steps would not fit', () => {
    expect(planInsertStop(guide(['a']), rec(1, 'G', 'older')).kind).toBe('aside');
    expect(planInsertStop(undefined, rec(1)).kind).toBe('aside');
    expect(planInsertStop({ ...guide(['a']), source: 'library' }, rec(1)).kind).toBe('aside');
    const full = guide(Array.from({ length: MAX_STEPS_PER_GUIDE - 5 }, (_, i) => `s${i}`));
    expect(planInsertStop(full, rec(5)).kind).toBe('insert');
    expect(planInsertStop(full, rec(6)).kind).toBe('aside'); // Stop must never fail (it did: an error, every time)
  });
  it('the title of that guide stays within 500 characters; nothing is written for no steps', () => {
    const p = planInsertStop(guide(['a']), rec(1, 'x'.repeat(500), 'older'));
    expect(p.kind === 'aside' && p.title.length <= 500 && p.title.endsWith(' (added steps)')).toBe(true);
    expect(planInsertStop(guide(['a']), rec(0, 'G', 'older')).kind).toBe('nothing');
    expect(planInsertStop(guide(['a']), rec(0)).kind).toBe('nothing');
  });
});

