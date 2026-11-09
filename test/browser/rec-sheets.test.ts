/** D206 (#114): Google Sheets cell steps in the recorder, the recording outline and the advance rule. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createRecorder, type Recorder, type RecorderOp } from '../../src/core/recorder/recorder';
import { previewClick } from '../../src/core/recorder/preview';
import { watchAdvance } from '../../src/core/player/advance';
import { buildFingerprint } from '../../src/core/fingerprint';
import type { Step } from '../../src/core/model/schema';

let ops: RecorderOp[] = [];
let rec: Recorder | null = null;
let root: HTMLElement;
let box: HTMLInputElement;
let canvas: HTMLCanvasElement;
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
function steps(): Step[] {
  const out: Step[] = [];
  for (const op of ops) {
    if (op.op === 'add') out.push(op.step);
    else if (out[out.length - 1]?.id === op.stepId) out[out.length - 1] = op.step;
  }
  return out;
}

beforeEach(() => {
  ops = [];
  root = document.createElement('div');
  box = Object.assign(document.createElement('input'), { id: 't-name-box', value: 'A1' });
  const label = document.createElement('div');
  label.setAttribute('aria-label', 'Name box');
  label.append(box);
  const grid = document.createElement('div');
  grid.id = 'waffle-grid-container';
  canvas = Object.assign(document.createElement('canvas'), { width: 400, height: 200 });
  grid.append(canvas);
  const tab = document.createElement('div');
  tab.className = 'docs-sheet-tab docs-sheet-active-tab';
  tab.append(Object.assign(document.createElement('span'), { className: 'docs-sheet-tab-name', textContent: 'Budget' }));
  root.append(label, grid, tab);
  document.body.append(root);
  // As in Sheets: the selection moves on mousedown; a reference typed into the Name Box is applied on Enter.
  canvas.addEventListener('mousedown', (e) => (box.value = e.offsetX < 200 ? 'B2' : 'D4'));
  rec = createRecorder({ emit: (op) => ops.push(op) });
});
afterEach(() => {
  rec?.stop();
  root.remove();
});

describe('recording Sheets cells', () => {
  it('a click on the grid is "Select cell", read from the Name Box; clicking around keeps the last cell', async () => {
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle();
    expect(steps().map((s) => [s.kind, s.title, s.cell])).toEqual([['cell', 'Select cell **B2** on **Budget**', { ref: 'B2', sheet: 'Budget' }]]);
    expect(steps()[0]!.target?.id).toBe('t-name-box');
    await userEvent.click(canvas, { position: { x: 300, y: 50 } });
    await settle();
    expect(steps().map((s) => s.title)).toEqual(['Select cell **D4** on **Budget**']);
  });

  it('a reference typed into the Name Box, then Enter, is a cell step and never an input step', async () => {
    await userEvent.click(box);
    await userEvent.clear(box);
    await userEvent.type(box, 'e7{Enter}');
    await settle();
    expect(steps().map((s) => `${s.kind}: ${s.title}`)).toEqual(['cell: Select cell **E7** on **Budget**']);
  });

  it('a named range in the Name Box records nothing (there is no cell to select again)', async () => {
    canvas.addEventListener('mousedown', () => (box.value = 'Totals'));
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle();
    expect(steps()).toEqual([]);
  });

  it('the recording outline stays off the grid (no "Won’t be recorded")', () => {
    const path = [canvas, canvas.parentElement!, root, document.body, document.documentElement, document, window];
    expect(previewClick(path, (el) => buildFingerprint(el))).toBeNull();
  });
});

describe('playing Sheets cells', () => {
  const cellStep = (cell: Step['cell']): Step => ({ id: 's', kind: 'cell', title: 't', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(box), cell });

  it('moves on when the Name Box shows the cell on that sheet, however it was selected', async () => {
    let advanced = 0;
    const stop = watchAdvance({ step: cellStep({ ref: 'C3', sheet: 'Budget' }), targets: [box], onAdvance: () => advanced++ });
    box.value = 'C4';
    await settle(400);
    expect(advanced).toBe(0);
    box.value = 'C3';
    await settle(400);
    expect(advanced).toBe(1);
    stop();
  });

  it('not on another sheet', async () => {
    let advanced = 0;
    const stop = watchAdvance({ step: cellStep({ ref: 'A1', sheet: 'Totals' }), targets: [box], onAdvance: () => advanced++ });
    await settle(400);
    expect(advanced).toBe(0);
    document.querySelector('.docs-sheet-tab-name')!.textContent = 'Totals';
    await settle(400);
    expect(advanced).toBe(1);
    stop();
  });
});
