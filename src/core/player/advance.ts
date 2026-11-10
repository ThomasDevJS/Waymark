/**
 * Advance rules (SPEC: Player, "Advancing"): the learner progresses by doing the real action.
 *
 * | click    | a trusted click lands on the target, or on any tied candidate (instance 'any') |
 * | input    | change, or blur with a non-empty value, or Enter in a non-empty one-line field, or Next |
 * | select   | change on a native select; a click on the option for custom dropdowns          |
 * | check    | change on native inputs; a click on ARIA checkbox, radio or switch roles      |
 * | submit   | the form's submit event, or the page navigates away within 1.5 s of the click  |
 * | navigate | the URL matches the step's URL rule (handled by the controller)                |
 * | note     | Next                                                                            |
 * | hover    | the pointer is on the target, keyboard focus reaches it, or a click on it (D204) |
 * | cell     | a click on the step's Sheets cell or typing into it, with the cell selected (the player selected it, D206, D208); a range: Next |
 * | input+cell | Enter or Tab in Sheets' cell editor with something typed, the step's cell selected (D208) |
 * | input+   | also Tab out of a filled field (focus left it), and Tab or Enter in Sheets' cell editor (D207) |
 */
import type { Step } from '../model/schema';
import { isNativeCheck, isNativeSelect } from '../recorder/classify';
import { activeCellRect, isCellEditor, isCellSelected, isRange } from '../sheets';
import { resolveTargetFromPath, tagOf } from '../fingerprint/dom';
import { ariaRole } from '../debug/log';

/** After a click or a key, Sheets moves the selection in its own handlers: checked this much later (D208). */
const CELL_ACT_MS = 120;

export const SUBMIT_NAV_MS = 1500;
/** A press on the target and a click on its ancestor within this time are one click (D61). */
export const PRESS_LINK_MS = 1000;
/** ...and the release is at most this far from the press. */
export const PRESS_SLOP_PX = 4;
/** The debug log reports a click that missed the target when it lands this close to it (D110). */
export const NEAR_PX = 120;

export interface AdvanceWatch {
  step: Step;
  /** The matched element and, for instance 'any', every tied candidate. */
  targets: Element[];
  doc?: Document;
  /** True for events inside Waymark's overlay. */
  isOwnEvent?: (path: EventTarget[]) => boolean;
  onAdvance: () => void;
  now?: () => number;
  /** Debug log (D110): why the step advanced, or why a click near the target did not count. */
  debug?: (ev: string, data: () => Record<string, unknown>) => void;
}

/** Distance in px from a point to the nearest target box (0 inside one). */
function distanceTo(targets: Element[], x: number, y: number): number {
  let best = Infinity;
  for (const t of targets) {
    const r = t.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return Math.round(best);
}

function hits(path: EventTarget[], targets: Element[]): Element | null {
  for (const t of targets) if (path.includes(t)) return t;
  return null;
}

function hasValue(el: Element): boolean {
  const v = (el as HTMLInputElement).value;
  if (typeof v === 'string') return v.length > 0; // checked for emptiness only, never stored
  return (el.textContent ?? '').trim().length > 0;
}

export function watchAdvance(w: AdvanceWatch): () => void {
  const doc = w.doc ?? document;
  const now = w.now ?? (() => Date.now());
  const own = w.isOwnEvent ?? (() => false);
  let fired = false;
  // Never throws into the player; does nothing without a logger.
  const dbg = (ev: string, data: () => Record<string, unknown>) => {
    if (!w.debug) return;
    try {
      w.debug(ev, data);
    } catch {
      // ignore
    }
  };
  const advance = (why: string) => {
    if (fired) return;
    fired = true;
    dbg('advance', () => ({ kind: w.step.kind, why }));
    w.onAdvance();
  };
  const listeners: [EventTarget, string, (e: Event) => void][] = [];
  const on = (target: EventTarget, type: string, fn: (e: Event) => void) => {
    target.addEventListener(type, fn, { capture: true });
    listeners.push([target, type, fn]);
  };
  const trusted = (e: Event) => e.isTrusted && !own(e.composedPath());
  const kind = w.step.kind;
  const primary = w.targets[0];

  // A menu that opens while the pointer rests on its trigger (D204): pointing at it is the action.
  // Keyboard users reach it with Tab (focus opens such menus too), and a tap or click counts.
  // Focus counts only when it is keyboard focus (`:focus-visible`): menus and dialogs often give
  // focus back to their trigger by script after the previous step, with the menu closed.
  if (kind === 'hover') {
    const onTarget = (why: string, keyboard = false) => (e: Event) => {
      if (!trusted(e) || !hits(e.composedPath(), w.targets)) return;
      const focused = e.composedPath()[0];
      if (keyboard && !(focused instanceof Element && focused.matches(':focus-visible'))) return;
      advance(why);
    };
    on(doc, 'pointerover', onTarget('the pointer is on the target'));
    on(doc, 'focusin', onTarget('the target has keyboard focus', true));
    on(doc, 'click', onTarget('a click on the target'));
    // The pointer already there when the step is drawn: no event will come, and the menu is open.
    const already = setTimeout(() => {
      if (w.targets.some((t) => t.matches(':hover'))) advance('the pointer was already on the target');
    }, 0);
    return () => {
      clearTimeout(already);
      for (const [t, type, fn] of listeners) t.removeEventListener(type, fn, { capture: true });
    };
  }

  // A Google Sheets cell (D206, D208). The player selects the cell itself when the step is drawn,
  // so the selection can't count: a cell step moves on when the learner acts on that cell (a click
  // on the grid, or typing into it, with the cell still selected; checked after Sheets' own
  // handlers) or presses Next. Typing into a cell ("Enter a value in B8") moves on at Enter or
  // Tab in Sheets' cell editor with something typed, the cell still the selected one.
  if (w.step.cell && (kind === 'cell' || kind === 'input')) {
    const want = w.step.cell;
    const later = (fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, CELL_ACT_MS);
      timers.add(t);
    };
    const timers = new Set<ReturnType<typeof setTimeout>>();
    // A range: a click collapses it, so only Next moves the step on.
    if (kind === 'cell' && isRange(want.ref)) {
      return () => {
        fired = true;
      };
    }
    if (kind === 'cell') {
      // Where the press landed: on a heavy sheet the Name Box may still show the step's cell 120 ms
      // after a click on another one, so the press must also be inside the selected cell's box
      // (review of D208).
      let press: { x: number; y: number } | null = null;
      on(doc, 'pointerdown', (e) => {
        const p = e as PointerEvent;
        press = trusted(e) ? { x: p.clientX, y: p.clientY } : null;
      });
      const pressInCell = () => {
        const r = activeCellRect(doc);
        return !!press && !!r && press.x >= r.left && press.x <= r.right && press.y >= r.top && press.y <= r.bottom;
      };
      const acted = (why: string) => (e: Event) => {
        if (!trusted(e)) return;
        const byPointer = e.type === 'pointerup';
        if (e.type === 'keydown') {
          const k = e as KeyboardEvent;
          if (k.ctrlKey || k.metaKey || k.altKey) return; // a shortcut (copy, undo), not typing
          if (k.key.length !== 1 && k.key !== 'Enter' && k.key !== 'F2') return; // typing, or opening the cell's editor
          // Into the cell: the grid or Sheets' cell editor, not the Name Box or another field.
          const t = e.composedPath()[0];
          if (!(t instanceof Element) || !(isCellEditor(t, doc) || t.closest('#waffle-grid-container'))) return;
        } else if (!e.composedPath().some((n) => n instanceof Element && n.id === 'waffle-grid-container')) return;
        later(() => {
          if (isCellSelected(doc, want) && (!byPointer || pressInCell())) advance(why);
        });
      };
      on(doc, 'pointerup', acted('a click on the step\'s cell'));
      on(doc, 'keydown', acted('typing into the step\'s cell'));
    } else {
      on(doc, 'keydown', (e) => {
        const k = e as KeyboardEvent;
        if ((k.key !== 'Enter' && k.key !== 'Tab') || k.isComposing || !trusted(e)) return;
        // Alt or Ctrl+Enter adds a line in the cell; they commit nothing.
        if (k.altKey || k.ctrlKey || k.metaKey || k.shiftKey) return;
        const t = e.composedPath()[0];
        if (!(t instanceof Element) || !isCellEditor(t, doc) || !hasValue(t) || !isCellSelected(doc, want)) return;
        // Tab while typing a formula picks a suggestion; it doesn't commit.
        if (k.key === 'Tab' && (t.textContent ?? '').trimStart().startsWith('=')) return;
        // Checked at keydown, before Sheets commits the cell and clears its editor.
        advance(`${k.key} in the step's cell with something typed`);
      });
    }
    return () => {
      fired = true;
      timers.forEach(clearTimeout);
      for (const [t, type, fn] of listeners) t.removeEventListener(type, fn, { capture: true });
    };
  }

  if (kind === 'click' || (kind === 'select' && primary && !isNativeSelect(primary)) || (kind === 'check' && primary && !isNativeCheck(primary))) {
    // A control that opens something over itself on mousedown (MUI's select and its backdrop)
    // gets no click: the click goes to the common ancestor of the press and the release (D61).
    // Only a release at the press point counts: dragging off a button is how people cancel a
    // click, and a release on another control (a card link around the button) is that control's.
    let pressed: { path: EventTarget[]; at: number; x: number; y: number } | null = null;
    on(doc, 'pointerdown', (e) => {
      const m = e as PointerEvent;
      pressed = trusted(e) && hits(e.composedPath(), w.targets) ? { path: e.composedPath(), at: now(), x: m.clientX, y: m.clientY } : null;
    });
    on(doc, 'click', (e) => {
      if (!trusted(e)) {
        if (!e.isTrusted && hits(e.composedPath(), w.targets)) dbg('click.untrusted', () => ({ why: 'a click made by a script does not count' }));
        return;
      }
      const path = e.composedPath();
      if (hits(path, w.targets)) return advance('a click on the target');
      const p = pressed;
      pressed = null;
      const m = e as MouseEvent;
      if (
        p &&
        now() - p.at <= PRESS_LINK_MS &&
        Math.hypot(m.clientX - p.x, m.clientY - p.y) <= PRESS_SLOP_PX &&
        path[0] instanceof Element &&
        p.path.includes(path[0]) &&
        resolveTargetFromPath(path)?.lowConfidence === true
      )
        return advance('pressed on the target, the click went to an ancestor (D61)');
      if (!w.debug) return;
      const dist = distanceTo(w.targets, m.clientX, m.clientY);
      if (dist > NEAR_PX && !p) return;
      dbg('click.miss', () => {
        const el = path[0] instanceof Element ? path[0] : null;
        const why = !p
          ? 'the click was not on the target, and the press was not on it either'
          : now() - p.at > PRESS_LINK_MS
            ? `pressed on the target over ${PRESS_LINK_MS} ms before the click`
            : Math.hypot(m.clientX - p.x, m.clientY - p.y) > PRESS_SLOP_PX
              ? 'released away from the press (a drag cancels a click)'
              : !el || !p.path.includes(el)
                ? 'pressed on the target, released on another element'
                : 'released on a control of its own, which takes the click';
        return { why, distancePx: dist, tag: el ? tagOf(el) : null, role: ariaRole(el?.getAttribute('role')), inside: !!el && w.targets.some((t) => t.contains(el) || el.contains(t)) };
      });
    });
  }
  // change and submit are not composed: also listen on the open shadow roots the targets live in.
  const roots: EventTarget[] = [doc];
  for (const t of w.targets) {
    const r = t.getRootNode();
    if (r instanceof ShadowRoot && !roots.includes(r)) roots.push(r);
  }
  const onChange = (e: Event) => {
    if (trusted(e) && hits(e.composedPath(), w.targets)) advance(`a change on the target (${e.type})`);
  };
  if (kind === 'select' || kind === 'check' || kind === 'input') for (const r of roots) on(r, 'change', onChange);
  if (kind === 'input') {
    on(doc, 'focusout', (e) => {
      const t = hits(e.composedPath(), w.targets);
      if (trusted(e) && t && hasValue(t)) advance('left the field with something in it');
      else if (t && w.debug) dbg('input.wait', () => ({ why: trusted(e) ? 'left the field empty' : 'not a real focus change' }));
    });
    // Apps like TodoMVC take the value on Enter and clear the field: no change, no blur (D60).
    // Checked at keydown, before the app clears it. A textarea or rich editor gets a new line.
    on(doc, 'keydown', (e) => {
      const k = e as KeyboardEvent;
      if (k.isComposing || k.ctrlKey || k.metaKey || k.altKey || !trusted(e)) return;
      // Tab out of a filled field, for an app that clears it on Tab (Sheets' cell editor, #115):
      // the value is noted before the app sees the key; the step moves on only once focus has
      // left the field, or in Sheets' cell editor (it commits the cell). A Tab the app keeps
      // (indenting in a code or rich-text editor) never does.
      if (k.key === 'Tab') {
        const t = hits(e.composedPath(), w.targets);
        if (!t || !hasValue(t)) return;
        setTimeout(() => {
          const active = doc.activeElement;
          const left = !active || !(t === active || t.contains(active));
          if (left || isCellEditor(t, doc)) advance(left ? 'Tab out of a filled field' : 'Tab in a filled spreadsheet cell (#115)');
        }, 0);
        return;
      }
      if (k.key !== 'Enter' || k.shiftKey) return;
      const t = hits(e.composedPath(), w.targets);
      if (t && tagOf(t) === 'input' && hasValue(t)) advance('Enter in a filled one-line field (D60)');
      else if (t && isCellEditor(t, doc) && hasValue(t)) advance('Enter in a filled spreadsheet cell (#115)');
      else if (t && w.debug) dbg('input.wait', () => ({ why: tagOf(t) === 'input' ? 'Enter in an empty field' : 'Enter in a multi-line field adds a line' }));
    });
  }
  if (kind === 'submit') {
    let clickedAt = -Infinity;
    on(doc, 'click', (e) => {
      if (trusted(e) && hits(e.composedPath(), w.targets)) clickedAt = now();
    });
    const forms = new Set<HTMLFormElement>();
    for (const t of w.targets) {
      const f = (t as HTMLButtonElement).form ?? t.closest('form');
      if (f) forms.add(f);
      if (tagOf(t) === 'form') forms.add(t as HTMLFormElement);
    }
    for (const r of roots) {
      on(r, 'submit', (e) => {
        if (e.isTrusted && forms.has(e.composedPath()[0] as HTMLFormElement)) advance('the form was submitted');
        else if (w.debug) dbg('submit.other', () => ({ why: e.isTrusted ? 'another form was submitted' : 'a submit made by a script' }));
      });
    }
    // "The page navigates away within 1.5 s of the click": only a real cross-document
    // navigation counts (not pushState or a hash change, and not a cancelled beforeunload).
    const leaving = () => {
      const since = now() - clickedAt;
      if (since <= SUBMIT_NAV_MS) advance(`the page left ${Math.round(since)} ms after the click`);
      else dbg('submit.nav', () => ({ why: Number.isFinite(since) ? `the page left ${Math.round(since)} ms after the click (over ${SUBMIT_NAV_MS} ms)` : 'the page left without a click on the target' }));
    };
    const win = doc.defaultView;
    if (win) {
      on(win, 'pagehide', leaving);
      const nav = (win as Window & { navigation?: EventTarget }).navigation;
      if (nav)
        on(nav, 'navigate', (e) => {
          const dest = (e as Event & { destination?: { sameDocument?: boolean } }).destination;
          if (dest && dest.sameDocument === false) leaving();
        });
    }
  }
  dbg('advance.watch', () => ({
    kind,
    targets: w.targets.length,
    listeners: [...new Set(listeners.map(([t, type]) => `${type}@${t === doc ? 'document' : t instanceof ShadowRoot ? 'shadow' : 'window'}`))],
    tags: [...new Set(w.targets.map((t) => tagOf(t)))],
  }));
  return () => {
    fired = true; // a check still pending (the Tab rule's next tick) must not move a later step on
    for (const [t, type, fn] of listeners) t.removeEventListener(type, fn, { capture: true });
  };
}
