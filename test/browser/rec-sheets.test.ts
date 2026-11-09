/** D206 (#114): Google Sheets cell steps in the recorder, the recording outline and the advance rule. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createRecorder, type Recorder, type RecorderOp } from '../../src/core/recorder/recorder';
import { previewClick } from '../../src/core/recorder/preview';
import { watchAdvance } from '../../src/core/player/advance';
import { buildFingerprint } from '../../src/core/fingerprint';
import type { Step } from '../../src/core/model/schema';
import { PlayerUI } from '../../src/content/player/ui';
import { NO_RUN, type RunView } from '../../src/core/player/run';
import { destroyOverlay, overlayHost } from '../../src/content/overlay/host';

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
  const sort = Object.assign(document.createElement('button'), { id: 'sort', textContent: 'Sort A to Z' });
  root.append(label, grid, tab, sort);
  document.body.append(root);
  // As in Sheets: the selection moves on mousedown; a reference typed into the Name Box is applied on Enter.
  canvas.addEventListener('mousedown', (e) => (box.value = e.offsetX < 200 ? 'B2' : 'D4'));
  // The keyboard moves or extends the selection, as in Sheets.
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && e.shiftKey) box.value = `${box.value.split(':')[0]}:B3`;
    else if (e.key === 'ArrowDown') box.value = 'D5';
  });
  rec = createRecorder({ emit: (op) => ops.push(op) });
});
afterEach(() => {
  rec?.stop();
  root.remove();
  destroyOverlay();
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

describe('recording Sheets cells: fixes from the review', () => {
  it('review fix: a range extended by keyboard (Shift+arrow) is what the cell step holds', async () => {
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(400);
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await userEvent.click(document.getElementById('sort')!);
    await settle();
    expect(steps().map((s) => s.title)).toEqual(['Select cells **B2:B3** on **Budget**', 'Click **Sort A to Z**']);
  });

  it('review fix: after a copy, another cell is a step of its own (by click or by keyboard)', async () => {
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(400);
    await userEvent.keyboard('{Control>}c{/Control}');
    await userEvent.click(canvas, { position: { x: 300, y: 50 } });
    await settle(400);
    await userEvent.keyboard('{Control>}v{/Control}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.click(document.getElementById('sort')!);
    await settle();
    expect(steps().map((s) => s.cell?.ref ?? s.title)).toEqual(['B2', 'D4', 'D5', 'Click **Sort A to Z**']);
  });

  it('review fix: the same cell on another sheet is not merged', async () => {
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(400);
    // Ctrl+PgDn, say: the other sheet shows its own selection
    document.querySelector('.docs-sheet-tab-name')!.textContent = 'Totals';
    box.value = 'A1';
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(400);
    expect(steps().map((s) => s.title)).toEqual(['Select cell **B2** on **Budget**', 'Select cell **B2** on **Totals**']);
  });

  it('review fix: a Name Box that Sheets updates late is read again', async () => {
    canvas.addEventListener('mousedown', () => setTimeout(() => (box.value = 'F6'), 150));
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(500);
    expect(steps().map((s) => s.cell?.ref)).toEqual(['F6']);
  });

  it('review fix: clicking into the Name Box, then on the grid without typing, records no "Click Name box"', async () => {
    await userEvent.click(box);
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(400);
    expect(steps().map((s) => s.kind)).toEqual(['cell']);
  });
});

describe('#115: the owner\'s sheet (a filter menu from the grid, cells typed with Tab)', () => {
  it('typing into the next cell after Tab adds a cell step before it', async () => {
    const editor = Object.assign(document.createElement('div'), { contentEditable: 'true' });
    editor.setAttribute('role', 'combobox');
    editor.setAttribute('aria-label', 'B2');
    root.append(editor);
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(400);
    editor.focus();
    await userEvent.keyboard('4');
    // Tab commits B2 and moves to C2: Sheets relabels the same editor
    box.value = 'C2';
    editor.setAttribute('aria-label', 'C2');
    editor.textContent = '';
    await userEvent.keyboard('7');
    await settle();
    expect(steps().map((s) => `${s.kind}: ${s.title}`)).toEqual(['cell: Select cell **B2** on **Budget**', 'input: Enter B2', 'cell: Select cell **C2** on **Budget**', 'input: Enter C2']);
  });

  it('a step in a menu opened by a click on the grid is flagged "in a menu"; the click selects nothing', async () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.style.display = 'none';
    const item = Object.assign(document.createElement('div'), { textContent: 'Show done' });
    item.setAttribute('role', 'menuitemcheckbox');
    item.setAttribute('aria-checked', 'true');
    item.addEventListener('click', () => item.setAttribute('aria-checked', 'false'));
    menu.append(item);
    root.append(menu);
    // A filter button drawn on the canvas: the press opens the menu and leaves the selection as it was.
    const filter = document.createElement('canvas');
    filter.width = 40;
    filter.height = 20;
    canvas.parentElement!.append(filter);
    filter.addEventListener('mousedown', () => (menu.style.display = 'block'));
    await userEvent.click(filter);
    await settle(500);
    await userEvent.click(item);
    await settle();
    expect(steps().map((s) => [s.kind, s.flags])).toEqual([['check', ['in-menu']]]);
  });

  it('not flagged when a recorded click opened the menu', async () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const item = Object.assign(document.createElement('button'), { textContent: 'Rename' });
    menu.append(item);
    const opener = Object.assign(document.createElement('button'), { textContent: 'More' });
    opener.addEventListener('click', () => (menu.hidden = false));
    root.append(opener, menu);
    await userEvent.click(opener);
    await settle();
    await userEvent.click(item);
    await settle();
    expect(steps().map((s) => [s.title, s.flags])).toEqual([
      ['Click **More**', undefined],
      ['Click **Rename**', undefined],
    ]);
  });
});

describe('playing Sheets cells', () => {
  it('review fix: Next is offered on a cell step (a renamed sheet, a cell out of reach)', () => {
    const handlers = { next() {}, back() {}, skip() {}, exit() {}, retry() {}, report() {}, goBack() {}, mute() {} };
    const ui = new PlayerUI(handlers);
    const step: Step = { id: 's', kind: 'cell', title: 'Select cell **B8**', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(box), cell: { ref: 'B8' } };
    const view: RunView = { ...NO_RUN, active: true, status: 'running', guideTitle: 'Demo', stepIndex: 0, total: 2, step, stepToken: 't' };
    ui.showStep(view, box);
    expect(overlayHost()!.shadowRoot!.querySelector('[data-action="next"]')).not.toBeNull();
  });

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

describe('#115: typing steps in a cell that clears on commit', () => {
  it('Tab out of a filled field moves on, even when the app clears it on Tab', async () => {
    const editor = Object.assign(document.createElement('div'), { contentEditable: 'true' });
    editor.setAttribute('aria-label', 'A1');
    root.append(editor);
    editor.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      editor.textContent = ''; // committed, as Sheets does
      canvas.focus();
    });
    let advanced = 0;
    const step: Step = { id: 's', kind: 'input', title: 'Enter A1', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(editor) };
    const stop = watchAdvance({ step, targets: [editor], onAdvance: () => advanced++ });
    editor.focus();
    await userEvent.keyboard('42');
    await userEvent.keyboard('{Tab}');
    expect(advanced).toBe(1);
    stop();
  });
});
