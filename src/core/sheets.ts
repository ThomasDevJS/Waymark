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
