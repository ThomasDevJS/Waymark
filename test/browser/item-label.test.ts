/** Nameless controls in list items are named by the item's label (D65; TodoMVC Vue and Angular). */
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

describe('item label: review of D65', () => {
  /** Test markup only (no user strings), parsed without innerHTML. */
  const parse = (html: string) => document.importNode(new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!, true);
  const list = (rows: string[]) => {
    const ul = parse(`<ul>${rows.join('')}</ul>`);
    document.body.append(ul);
    return ul;
  };
  afterEach(() => document.querySelectorAll('ul.review').forEach((u) => u.remove()));

  it('status text next to a named link is not an item label (never the wrong row)', () => {
    const ul = list([
      '<li><input type="checkbox"><a href="/i/1">Fix bug</a><span>Open</span></li>',
      '<li><input type="checkbox"><a href="/i/2">Add docs</a><span>Closed</span></li>',
      '<li><input type="checkbox"><a href="/i/3">Ship it</a><span>Closed</span></li>',
    ]);
    ul.className = 'review';
    const fp = buildFingerprint(ul.querySelector('input')!);
    expect(fp.itemLabel).toBeUndefined();
    ul.children[0]!.remove();
    ul.children[0]!.querySelector('span')!.textContent = 'Open';
    expect(matchOnce(document, fp).status).toBe('not-found');
  });

  it('plain status text in a row is not an item label; only a label or heading is', () => {
    const ul = list(['<li><input type="checkbox"><span>Open</span></li>', '<li><input type="checkbox"><span>Closed</span></li>']);
    ul.className = 'review';
    expect(buildFingerprint(ul.querySelector('input')!).itemLabel).toBeUndefined();
  });

  it('rows that share a label are ambiguous, not interchangeable', () => {
    const ul = list(['<li><input type="checkbox"><label>Same</label></li>', '<li><input type="checkbox"><label>Same</label></li>']);
    ul.className = 'review';
    const fp = buildFingerprint(ul.querySelector('input')!);
    expect(fp.instance).toBe('unique');
    expect(matchOnce(document, fp).status).toBe('not-found');
  });

  it('never reads text typed into a rich-text editor (task lists in contenteditable)', () => {
    const host = parse('<div contenteditable="true"><ul><li><label><input type="checkbox"></label><label>call my lawyer</label></li></ul></div>');
    document.body.append(host);
    const fp = buildFingerprint(host.querySelector('input')!);
    host.remove();
    expect(JSON.stringify(fp)).not.toContain('lawyer');
  });

  it('text hidden by CSS is not part of the label', () => {
    const ul = list(['<li><input type="checkbox"><label>Task<span style="display:none"> Saving…</span></label></li>']);
    ul.className = 'review';
    expect(buildFingerprint(ul.querySelector('input')!).itemLabel).toBe('Task');
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
