/**
 * Google Sheets cells (D206, #114). Sheets draws its grid on a canvas, so a cell has no element
 * to find again. Its Name Box (the box at the top left, `#t-name-box`) is an ordinary input that
 * always shows the selected cell or range ("B8", "B5:D9"), after a click, the arrow keys, or a
 * name typed into it. A "Select cell" step targets the Name Box and checks its value: no pixel
 * guessing on the canvas, so a wrong cell is never shown.
 *
 * Detected by the page's own elements (the grid container and the Name Box), not by its address,
 * so the fixture page in the tests stands in for Sheets.
 */

/** A cell or a range in A1 notation, `$` allowed (absolute references). */
const A1 = /^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?$/;

export interface CellRef {
  /** "B8" or "B5:D9", upper case, without `$`. */
  ref: string;
  /** The sheet tab's name, when the page shows one. */
  sheet?: string;
}

/** "b8", "$B$8" → "B8"; anything else (a named range, empty) → null. */
export function normalizeRef(v: string): string | null {
  const s = v.trim().toUpperCase();
  return A1.test(s) ? s.replace(/\$/g, '') : null;
}

export function nameBox(doc: Document): HTMLInputElement | null {
  const el = doc.getElementById('t-name-box');
  return el instanceof HTMLInputElement ? el : null;
}

/** The click landed on the Sheets grid (the canvas and the layers over it). */
export function isSheetsGrid(path: readonly EventTarget[], doc: Document): boolean {
  if (!nameBox(doc)) return false;
  return path.some((n) => n instanceof Element && n.id === 'waffle-grid-container');
}

export function activeSheet(doc: Document): string | undefined {
  const name = doc.querySelector('.docs-sheet-active-tab .docs-sheet-tab-name')?.textContent?.trim();
  return name ? name.slice(0, 200) : undefined;
}

/** What the Name Box shows now, with the active sheet; null when it shows no cell reference. */
export function readCell(doc: Document): CellRef | null {
  const box = nameBox(doc);
  const ref = box ? normalizeRef(box.value) : null;
  if (!ref) return null;
  const sheet = activeSheet(doc);
  return sheet ? { ref, sheet } : { ref };
}

/**
 * The selection is the step's cell, and its sheet when the step names one. A sheet that can't be
 * read then counts as another sheet: never advance on what might be the wrong cell.
 */
export function isCellSelected(doc: Document, want: CellRef): boolean {
  const now = readCell(doc);
  if (!now || now.ref !== normalizeRef(want.ref)) return false;
  return !want.sheet || now.sheet === want.sheet;
}

/**
 * Sheets' cell editor (#115): the field typing on the grid goes into, named after the selected
 * cell. Enter and Tab commit it and clear it, so they count as finishing the typing step.
 */
export function isCellEditor(el: Element, doc: Document): boolean {
  if (!nameBox(doc) || !doc.getElementById('waffle-grid-container')) return false;
  if (el.id === 'waffle-rich-text-editor') return true; // Sheets' own (checked on a public sheet)
  const label = normalizeRef(el.getAttribute('aria-label') ?? '');
  return (!!label && label === readCell(doc)?.ref) || !!el.closest('#waffle-grid-container');
}

/**
 * A cell step (D208): select the cell the way a person would, by typing its reference into the
 * Name Box and pressing Enter. Another sheet is named in the reference (`'Totals'!B3`). It changes
 * the selection only, never a value: only on a page with Sheets' Name Box and grid, and never while
 * the cell editor holds typed text (Enter would commit it).
 */
export function selectViaNameBox(doc: Document, cell: CellRef): boolean {
  if (!isSheetsPage(doc) || isEditingCell(doc)) return false;
  const box = nameBox(doc);
  const ref = normalizeRef(cell.ref);
  if (!box || !ref) return false;
  const other = cell.sheet && activeSheet(doc) !== cell.sheet;
  box.focus();
  box.value = other ? `'${cell.sheet!.replace(/'/g, "''")}'!${ref}` : ref;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  for (const type of ['keydown', 'keypress', 'keyup']) {
    box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit));
  }
  return true;
}

/** Where the selected cell is on screen: the union of Sheets' selection border pieces, or null. */
export function activeCellRect(doc: Document): DOMRect | null {
  const parts = [...doc.querySelectorAll('.active-cell-border')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (!parts.length) return null;
  const left = Math.min(...parts.map((r) => r.left));
  const top = Math.min(...parts.map((r) => r.top));
  const right = Math.max(...parts.map((r) => r.right));
  const bottom = Math.max(...parts.map((r) => r.bottom));
  return right - left < 4 || bottom - top < 4 ? null : new DOMRect(left, top, right - left, bottom - top);
}

/** A page with Sheets' Name Box and grid (D208: the only page Waymark selects anything on). */
export function isSheetsPage(doc: Document): boolean {
  return !!nameBox(doc) && !!doc.getElementById('waffle-grid-container');
}

/**
 * Sheets' cell editor holds typed text: a cell is being typed into (D208). Only the editable one
 * counts: Sheets keeps a read-only copy (`.cell-input.disabled-input`) holding the selected cell's
 * value at all times (checked on a public sheet).
 */
export function isEditingCell(doc: Document): boolean {
  const editable = (e: Element) => e.getAttribute('contenteditable') === 'true' || e.getAttribute('contenteditable') === '' || e instanceof HTMLTextAreaElement;
  const editors = new Set<Element>([...doc.querySelectorAll('#waffle-rich-text-editor, .cell-input')].filter(editable));
  const active = doc.activeElement;
  if (active && active !== nameBox(doc) && editable(active) && isCellEditor(active, doc)) editors.add(active);
  for (const e of editors) if ((e.textContent ?? (e as HTMLTextAreaElement).value ?? '').trim()) return true;
  return false;
}

/** A range ("B5:D9"), not a single cell. */
export const isRange = (ref: string) => ref.includes(':');
