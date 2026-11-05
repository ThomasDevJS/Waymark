/** Nameless controls in list items are named by the item's text (D56; TodoMVC Vue and Angular). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { buildFingerprint } from '../../src/core/fingerprint';
import { matchOnce } from '../../src/core/matcher';
import { createRecorder, type Recorder, type RecorderOp } from '../../src/core/recorder/recorder';
import { render } from './harness';

let keys: Map<string, Element[]>;
const q = (k: string) => keys.get(k)![0] as HTMLElement;
beforeEach(() => {
  keys = render({ seed: 1, layoutSeed: 1 });
});

describe('item label', () => {
  it('a nameless toggle is recorded by its item text, unique, and found again after a re-render', () => {
    const fp = buildFingerprint(q('todo-dog'));
    expect(fp.itemLabel).toBe('Walk the dog');
    expect(fp.instance).toBe('unique');
    keys = render({ seed: 4, reorder: true, wrap: true, layoutSeed: 4 });
    const r = matchOnce(document, fp);
    expect(r.status).toBe('found');
    expect(r.status === 'found' && r.element).toBe(q('todo-dog'));
  });

  it('two items with the same text are ambiguous, never a guess', () => {
    const fp = buildFingerprint(q('todo-dog'));
    const li = q('todo-dog').closest('li')!;
    li.after(li.cloneNode(true));
    expect(matchOnce(document, fp).status).toBe('not-found');
  });

  it('a control with its own name, or in a row whose text is data, gets no item label', () => {
    expect(buildFingerprint(q('row-edit')).itemLabel).toBeUndefined(); // "Edit" names it
    const rowToggle = document.createElement('input');
    rowToggle.type = 'checkbox';
    q('row-edit').closest('tr')!.querySelector('td')!.append(rowToggle);
    expect(buildFingerprint(rowToggle).itemLabel).toBeUndefined(); // "#10234 Ada … $120.00" is data
  });
});

describe('recording', () => {
  let ops: RecorderOp[] = [];
  let rec: Recorder | null = null;
  beforeEach(() => {
    ops = [];
    rec = createRecorder({ emit: (op) => ops.push(op) });
  });
  afterEach(() => rec?.stop());

  it('a click on a nameless toggle is a check step titled by its item', async () => {
    await userEvent.click(q('todo-dog'));
    await new Promise((r) => setTimeout(r, 30));
    const steps = ops.flatMap((o) => (o.op === 'add' ? [o.step] : []));
    expect(steps.map((s) => `${s.kind}: ${s.title}`)).toEqual(['check: Check **Walk the dog**']);
  });
});
