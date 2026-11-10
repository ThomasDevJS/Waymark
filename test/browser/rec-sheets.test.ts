/** D206 (#114): Google Sheets cell steps in the recorder, the recording outline and the advance rule. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createRecorder, type Recorder, type RecorderOp } from '../../src/core/recorder/recorder';
import { previewClick } from '../../src/core/recorder/preview';
import { watchAdvance } from '../../src/core/player/advance';
import { activeCellRect, selectViaNameBox } from '../../src/core/sheets';
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
  it('typing into the next cell after Tab is a step of its own (D208: one step with selecting it)', async () => {
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
    // D208: selecting a cell and typing into it is one step
    expect(steps().map((s) => `${s.kind}: ${s.title}`)).toEqual(['input: Enter a value in **B2** on **Budget**', 'input: Enter a value in **C2** on **Budget**']);
    expect(steps().map((s) => s.cell)).toEqual([
      { ref: 'B2', sheet: 'Budget' },
      { ref: 'C2', sheet: 'Budget' },
    ]);
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

  it('D208: the selection alone never moves it on (the player selected it); a click on that cell does', async () => {
    let advanced = 0;
    const stop = watchAdvance({ step: cellStep({ ref: 'B2', sheet: 'Budget' }), targets: [box], onAdvance: () => advanced++ });
    box.value = 'B2'; // the player selected it
    await settle(400);
    expect(advanced).toBe(0);
    await userEvent.click(canvas, { position: { x: 300, y: 50 } }); // another cell (D4)
    await settle(300);
    expect(advanced).toBe(0);
    await userEvent.click(canvas, { position: { x: 50, y: 50 } }); // B2
    await settle(300);
    expect(advanced).toBe(1);
    stop();
  });

  it('D208: not on another sheet; a range moves on with Next only', async () => {
    let advanced = 0;
    let stop = watchAdvance({ step: cellStep({ ref: 'B2', sheet: 'Totals' }), targets: [box], onAdvance: () => advanced++ });
    await userEvent.click(canvas, { position: { x: 50, y: 50 } }); // B2, but on Budget
    await settle(300);
    expect(advanced).toBe(0);
    stop();
    stop = watchAdvance({ step: cellStep({ ref: 'B2:D4', sheet: 'Budget' }), targets: [box], onAdvance: () => advanced++ });
    box.value = 'B2:D4';
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(300);
    expect(advanced).toBe(0);
    stop();
  });

  it('D208: keys typed into the Name Box or with Ctrl held are not typing into the cell', async () => {
    let advanced = 0;
    const stop = watchAdvance({ step: cellStep({ ref: 'A1', sheet: 'Budget' }), targets: [box], onAdvance: () => advanced++ });
    box.focus();
    await userEvent.keyboard('x');
    box.value = 'A1';
    canvas.focus();
    await userEvent.keyboard('{Control>}c{/Control}');
    await settle(300);
    expect(advanced).toBe(0);
    await userEvent.keyboard('7'); // typing on the grid, A1 selected
    await settle(300);
    expect(advanced).toBe(1);
    stop();
  });

  it('D208: typing into the cell ("Enter a value in B2") moves on at Enter or Tab with something typed, the cell selected', async () => {
    const editor = Object.assign(document.createElement('div'), { contentEditable: 'true', id: 'waffle-rich-text-editor' });
    canvas.parentElement!.append(editor);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        editor.textContent = '';
      }
    });
    let advanced = 0;
    const step: Step = { id: 's', kind: 'input', title: 'Enter a value in **B2**', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(box), cell: { ref: 'B2', sheet: 'Budget' } };
    const stop = watchAdvance({ step, targets: [box], onAdvance: () => advanced++ });
    box.value = 'B2';
    editor.focus();
    await userEvent.keyboard('{Enter}'); // nothing typed
    expect(advanced).toBe(0);
    await userEvent.keyboard('5{Tab}');
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

describe('#115 review fixes', () => {
  it('a Tab the app keeps (indenting) does not move a typing step on; Tab that leaves the field does', async () => {
    const code = Object.assign(document.createElement('div'), { contentEditable: 'true' });
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') e.preventDefault(); // indents, keeps focus
    });
    const next = document.createElement('input');
    root.append(code, next);
    let advanced = 0;
    const step: Step = { id: 's', kind: 'input', title: 'Enter code', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(code) };
    const stop = watchAdvance({ step, targets: [code], onAdvance: () => advanced++ });
    code.focus();
    await userEvent.keyboard('if x');
    await userEvent.keyboard('{Tab}');
    await settle(50);
    expect(advanced).toBe(0);
    stop();
    const plain = document.createElement('input');
    root.append(plain);
    const stop2 = watchAdvance({ step: { ...step, target: buildFingerprint(plain) }, targets: [plain], onAdvance: () => advanced++ });
    plain.focus();
    await userEvent.keyboard('Ada{Tab}');
    await settle(50);
    expect(advanced).toBe(1);
    stop2();
  });

  it('Enter in a filled Sheets cell editor moves the typing step on', async () => {
    const editor = Object.assign(document.createElement('div'), { contentEditable: 'true' });
    editor.setAttribute('aria-label', 'A1');
    canvas.parentElement!.append(editor);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editor.textContent = '';
      }
      if (e.key === 'Tab') e.preventDefault(); // focus stays: only the next-tick check could move on
    });
    let advanced = 0;
    const step: Step = { id: 's', kind: 'input', title: 'Enter A1', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(editor) };
    const stop = watchAdvance({ step, targets: [editor], onAdvance: () => advanced++ });
    editor.focus();
    await userEvent.keyboard('5{Enter}');
    expect(advanced).toBe(1);
    stop();
  });

  it('content that appears more than a second after a skipped click is not "in a menu"', async () => {
    const blank = document.createElement('div');
    blank.style.cssText = 'width:20px;height:20px';
    const late = document.createElement('div');
    late.hidden = true;
    const button = Object.assign(document.createElement('button'), { textContent: 'Save report' });
    late.append(button);
    root.append(blank, late);
    await userEvent.click(blank); // nothing to find it by: skipped (D47)
    await settle(1200);
    late.hidden = false; // loaded later, not opened by the click
    await settle();
    await userEvent.click(button);
    await settle();
    expect(steps().map((s) => [s.title, s.flags])).toEqual([['Click **Save report**', undefined]]);
  });

  it('a grid click that selects a cell opens no menu: what it shows is not flagged', async () => {
    const panel = document.createElement('div');
    panel.hidden = true;
    const button = Object.assign(document.createElement('button'), { textContent: 'Insert note' });
    panel.append(button);
    root.append(panel);
    canvas.addEventListener('mousedown', () => (panel.hidden = false));
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(400);
    await userEvent.click(button);
    await settle();
    expect(steps().map((s) => [s.kind, s.flags])).toEqual([
      ['cell', undefined],
      ['click', undefined],
    ]);
  });

  it('a slow sheet: typing before the second read records one cell step, not two', async () => {
    const editor = Object.assign(document.createElement('div'), { contentEditable: 'true' });
    editor.setAttribute('aria-label', 'A1');
    root.append(editor);
    // Only the slow update: the shared handler (which sets B2 at once) is kept out.
    canvas.addEventListener(
      'mousedown',
      (e) => {
        e.stopImmediatePropagation();
        setTimeout(() => {
          box.value = 'C3';
          editor.setAttribute('aria-label', 'C3');
        }, 100);
      },
      { capture: true },
    );
    await userEvent.click(canvas, { position: { x: 50, y: 50 } });
    await settle(150);
    editor.focus();
    await userEvent.keyboard('9');
    await settle(400);
    expect(steps().map((s) => `${s.kind}: ${s.title}`)).toEqual(['input: Enter a value in **C3** on **Budget**']);
  });
});

describe('D208 (#119): "Show me" on a cell step', () => {
  it('types the reference into the Name Box and presses Enter; names another sheet in quotes', () => {
    const seen: string[] = [];
    box.addEventListener('keydown', (e) => e.key === 'Enter' && seen.push(box.value));
    expect(selectViaNameBox(document, { ref: 'C5', sheet: 'Budget' })).toBe(true);
    expect(selectViaNameBox(document, { ref: 'B3', sheet: "Q1's totals" })).toBe(true);
    expect(seen).toEqual(['C5', "'Q1''s totals'!B3"]);
    box.remove();
    expect(selectViaNameBox(document, { ref: 'C5' })).toBe(false);
  });

  it('the selected cell\'s box is the union of the selection border pieces; none without them', () => {
    expect(activeCellRect(document)).toBeNull();
    const parts = [
      [100, 50, 120, 2],
      [100, 70, 120, 2],
      [100, 50, 2, 22],
      [218, 50, 2, 22],
    ].map(([x, y, w, h]) => {
      const d = document.createElement('div');
      d.className = 'range-border active-cell-border';
      d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      root.append(d);
      return d;
    });
    const r = activeCellRect(document)!;
    expect([r.x, r.y, r.width, r.height]).toEqual([100, 50, 120, 22]);
    parts.forEach((p) => p.remove());
  });

  it('D208: never selects while the cell editor holds typed text; the read-only copy of the cell doesn\'t count', () => {
    const copy = Object.assign(document.createElement('div'), { className: 'cell-input disabled-input', textContent: 'Female' });
    copy.setAttribute('contenteditable', 'false');
    const editor = Object.assign(document.createElement('div'), { id: 'waffle-rich-text-editor', className: 'cell-input' });
    editor.setAttribute('contenteditable', 'true');
    canvas.parentElement!.append(copy, editor);
    const seen: string[] = [];
    box.addEventListener('keydown', (e) => e.key === 'Enter' && seen.push(box.value));
    expect(selectViaNameBox(document, { ref: 'C5' })).toBe(true);
    editor.textContent = '12';
    expect(selectViaNameBox(document, { ref: 'D6' })).toBe(false);
    expect(seen).toEqual(['C5']);
  });
});
