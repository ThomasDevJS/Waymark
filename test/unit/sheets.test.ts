/** D206 (#114): Google Sheets cell steps, read from and checked against the Name Box. */
import { describe, expect, it } from 'vitest';
import { activeSheet, isCellSelected, isSheetsGrid, normalizeRef, readCell } from '../../src/core/sheets';
import { makePack, packFormatFor, parsePack } from '../../src/core/sharing/pack';
import { stepTitle } from '../../src/core/text/templates';
import { recorderStep } from '../../src/background/recording';
import { GuideSchema, type Guide, type Step } from '../../src/core/model/schema';
import { applyRemovals, packStrings } from '../../src/core/sharing/review';

const target = { instance: 'unique' as const, matchCount: 1, tag: 'input', id: 't-name-box', cssPath: 'input#t-name-box', xpath: '/html[1]/body[1]/input[1]', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } };
const step = (kind: Step['kind'], id: string, extra: Partial<Step> = {}): Step => ({ id, kind, title: 't', url: { kind: 'pattern', value: '/' }, advance: 'action', target, ...extra });
const guide = (id: string, steps: Step[]): Guide => ({
  id,
  schemaVersion: 1,
  revisionId: `${id}-r1`,
  title: 'Guide',
  lang: 'en',
  tags: [],
  appOrigins: ['https://docs.google.com'],
  startUrl: 'https://docs.google.com/spreadsheets/d/x/edit',
  matchUrls: [{ kind: 'prefix', value: '/spreadsheets/' }],
  steps,
  version: 1,
  source: 'local',
  updatedAt: '2026-11-09T00:00:00.000Z',
});

/** The Sheets parts a cell step relies on: the grid container, the Name Box, the tabs. */
function sheetsPage(value: string, tabs: [string, boolean][] = [['Budget', true]]) {
  const grid = document.createElement('div');
  grid.id = 'waffle-grid-container';
  const canvas = document.createElement('canvas');
  grid.append(canvas);
  const box = Object.assign(document.createElement('input'), { id: 't-name-box', value });
  const tabBar = document.createElement('div');
  for (const [name, active] of tabs) {
    const t = document.createElement('div');
    t.className = `docs-sheet-tab${active ? ' docs-sheet-active-tab' : ''}`;
    const n = Object.assign(document.createElement('span'), { className: 'docs-sheet-tab-name', textContent: name });
    t.append(n);
    tabBar.append(t);
  }
  document.body.replaceChildren(box, grid, tabBar);
  return { box, canvas, grid };
}

describe('Name Box references', () => {
  it('cells and ranges, any case, with or without $; nothing else', () => {
    expect(normalizeRef('b8')).toBe('B8');
    expect(normalizeRef(' $B$8 ')).toBe('B8');
    expect(normalizeRef('b5:d9')).toBe('B5:D9');
    expect(normalizeRef('AA100')).toBe('AA100');
    for (const bad of ['', 'Totals', 'B0', 'B', '8', 'ABCD1', 'B5:', 'Sheet1!B5', 'B5;D9']) expect(normalizeRef(bad)).toBeNull();
  });

  it('reads the selection with its sheet, and only on a page with the Sheets grid', () => {
    const { canvas, grid } = sheetsPage('c5', [
      ['Budget', false],
      ['Totals', true],
    ]);
    expect(readCell(document)).toEqual({ ref: 'C5', sheet: 'Totals' });
    expect(activeSheet(document)).toBe('Totals');
    expect(isSheetsGrid([canvas, grid, document.body], document)).toBe(true);
    expect(isSheetsGrid([document.body], document)).toBe(false);
    document.getElementById('t-name-box')!.remove();
    expect(isSheetsGrid([canvas, grid, document.body], document)).toBe(false);
  });

  it('a named range or an empty box is no cell', () => {
    sheetsPage('Totals');
    expect(readCell(document)).toBeNull();
  });

  it('selected: the same cell on the same sheet; a step without a sheet matches any sheet', () => {
    sheetsPage('B8');
    expect(isCellSelected(document, { ref: 'B8', sheet: 'Budget' })).toBe(true);
    expect(isCellSelected(document, { ref: 'B8' })).toBe(true);
    expect(isCellSelected(document, { ref: 'B8', sheet: 'Totals' })).toBe(false);
    expect(isCellSelected(document, { ref: 'B9', sheet: 'Budget' })).toBe(false);
    const { box } = sheetsPage('B5:D9');
    expect(isCellSelected(document, { ref: 'B5' })).toBe(false); // a range is not its first cell
    box.value = '$b$5:$d$9';
    expect(isCellSelected(document, { ref: 'B5:D9' })).toBe(true);
  });
});

describe('cell steps in guides and packs', () => {
  it('titles: a cell, a range, with the sheet; markdown in a sheet name is escaped', () => {
    expect(stepTitle('cell', { name: 'B8' })).toBe('Select cell **B8**');
    expect(stepTitle('cell', { name: 'B5:D9', sheet: 'Totals' })).toBe('Select cells **B5:D9** on **Totals**');
    expect(stepTitle('cell', { name: 'B8', sheet: 'Q1 *draft*' })).toBe('Select cell **B8** on **Q1 \\*draft\\***');
  });

  it('the schema keeps only A1 references (upper case, no $)', () => {
    expect(GuideSchema.safeParse(guide('g', [step('cell', 's1', { cell: { ref: 'B8', sheet: 'Budget' } })])).success).toBe(true);
    for (const ref of ['b8', '$B$8', 'Totals', '']) expect(GuideSchema.safeParse(guide('g', [step('cell', 's1', { cell: { ref } })])).success).toBe(false);
  });

  it('pack format: 3 with a cell step, 2 with only a hover step, 1 otherwise; an older reader says "newer"', () => {
    expect(packFormatFor([guide('a', [step('click', 's1')])])).toBe(1);
    expect(packFormatFor([guide('a', [step('hover', 's1')])])).toBe(2);
    expect(packFormatFor([guide('a', [step('hover', 's1')]), guide('b', [step('cell', 's2', { cell: { ref: 'B8' } })])])).toBe(3);
    const pack = makePack([guide('a', [step('cell', 's1', { cell: { ref: 'B8', sheet: 'Budget' } })])]);
    const r = parsePack(JSON.stringify(pack));
    expect(r.ok && r.pack.guides[0]!.steps[0]!.cell).toEqual({ ref: 'B8', sheet: 'Budget' });
    expect(parsePack(JSON.stringify({ ...pack, formatVersion: 4 }))).toEqual({ ok: false, error: expect.stringContaining('newer version') });
  });

  it('a recorded cell step keeps its cell; a cell step without one, or a cell on another kind, is dropped', () => {
    expect(recorderStep(step('cell', 's1', { cell: { ref: 'B8', sheet: 'Budget' } }))?.cell).toEqual({ ref: 'B8', sheet: 'Budget' });
    expect(recorderStep(step('cell', 's1'))).toBeNull();
    expect(recorderStep(step('click', 's1', { cell: { ref: 'B8' } }))).toBeNull();
  });
});

describe('review fixes (D206)', () => {
  it('review fix: a step that names a sheet does not advance when the sheet can\'t be read', () => {
    sheetsPage('B8', []);
    expect(isCellSelected(document, { ref: 'B8', sheet: 'Budget' })).toBe(false);
    expect(isCellSelected(document, { ref: 'B8' })).toBe(true);
  });

  it('review fix: the export review lists a cell step\'s sheet name and can remove it', () => {
    const g = guide('g', [step('cell', 's1', { cell: { ref: 'B8', sheet: 'Salaries' } })]);
    const item = packStrings([g]).find((x) => x.field === 'cell.sheet');
    expect(item).toMatchObject({ value: 'Salaries', removable: true });
    const [out] = applyRemovals([g], new Set([item!.key]));
    expect(out!.steps[0]!.cell).toEqual({ ref: 'B8' });
    expect(GuideSchema.safeParse(out).success).toBe(true);
  });

  it('review fix: the schema needs the cell exactly on cell steps', () => {
    expect(GuideSchema.safeParse(guide('g', [step('cell', 's1')])).success).toBe(false);
    expect(GuideSchema.safeParse(guide('g', [step('click', 's1', { cell: { ref: 'B8' } })])).success).toBe(false);
  });
});
