/**
 * Menus that open while the pointer rests on their trigger (D204, #94). The recorder records
 * clicks, never hovers, so the click on such a menu's item was recorded alone and its item was
 * hidden when the guide played. This tracker tells the recorder when a click needs a "Point at"
 * step before it. All of these must hold:
 * - the clicked item, or a container of it (at most 10 levels up), was revealed: inserted, or
 *   shown by a change of its `hidden`, `aria-hidden`, `open`, `data-state`, inline style or class
 *   (judged from the old value, so a live page restyling itself does not count);
 * - the element the pointer last came to rest on before that reveal is outside the container,
 *   and it got there at most QUICK_OPEN_MS before the reveal (the trigger); OPEN_DELAY_MS when the
 *   trigger says it opens a popup;
 * - the reveal came AFTER_STEP_MS or more after the last recorded step (else the step caused it),
 *   unless the trigger says it opens a popup;
 * - from the trigger to the click, the pointer stayed on the trigger, in the container, or on
 *   something around them (the menu stayed open), and no step was recorded since the trigger;
 * - the trigger is not the clicked item or inside it, nor around it.
 * So a tooltip (it is not the clicked item's container), a `title` (no change in the page) and a
 * row that highlights on hover (the pointer was already inside it) record no hover step. Menus
 * shown by CSS `:hover` alone change nothing in the page, and a menu marked open on an element
 * that also holds its trigger cannot be told from a highlighted row, so neither is detected (the
 * learner can still point at the trigger: the not-found card says so).
 */
import { composedParent, resolveTargetFromPath } from '../fingerprint/dom';

/** The pointer reached the trigger at most this long before the menu was revealed... */
export const OPEN_DELAY_MS = 2000;
/** ...or this long, when the trigger does not say it opens a popup (`aria-haspopup`, `aria-expanded`). */
export const QUICK_OPEN_MS = 600;
/**
 * A reveal this soon after a recorded step is the step's doing (a panel the click loaded) unless
 * the trigger says it opens a popup.
 */
export const AFTER_STEP_MS = 1500;
/** The click came at most this long after the reveal. */
export const CLICK_WINDOW_MS = 20_000;
const MAX_OVERS = 100;
const MAX_LEVELS = 10;
const MAX_REVEALS = 4;

export interface HoverTracker {
  /** A pointerover: where the pointer rests now (its path; the caller leaves Waymark's own UI out). */
  over(path: EventTarget[], at: number): void;
  /** What changed in the page (records from an observer with `attributeOldValue`). */
  mutated(records: MutationRecord[], at: number): void;
  /** The trigger the clicked element's menu opened from, or null. `since`: the last recorded step's time. */
  triggerFor(clicked: Element, at: number, since: number): Element | null;
}

const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0*)?\s*(?:!important)?\s*(?:;|$))/i;
const SHOW_CLASS = /open|show|visible|expand|active|hover|focus|enter/i;
const HIDE_CLASS = /hid|clos|collaps|invisible|none/i;

/** The trigger says it opens a popup, or that it is open now. */
function announcesPopup(h: Element): boolean {
  const p = h.getAttribute('aria-haspopup');
  return (p !== null && p !== 'false') || h.getAttribute('aria-expanded') === 'true';
}

const tokens = (s: string | null) => new Set((s ?? '').split(/\s+/).filter(Boolean));

/** Whether an attribute change shows its element, judged from the old and the new value. */
export function isReveal(r: Pick<MutationRecord, 'attributeName' | 'oldValue'>, el: Element): boolean {
  const now = r.attributeName ? el.getAttribute(r.attributeName) : null;
  const old = r.oldValue;
  switch (r.attributeName) {
    case 'hidden':
      return old !== null && now === null;
    case 'aria-hidden':
      return old === 'true' && now !== 'true';
    case 'open':
      return old === null && now !== null;
    case 'data-state':
      return !/open/i.test(old ?? '') && /open/i.test(now ?? '');
    case 'style':
      return HIDDEN_STYLE.test(old ?? '') && !HIDDEN_STYLE.test(now ?? '');
    case 'class': {
      const before = tokens(old);
      const after = tokens(now);
      for (const t of after) if (!before.has(t) && SHOW_CLASS.test(t)) return true;
      for (const t of before) if (!after.has(t) && HIDE_CLASS.test(t)) return true;
      return false;
    }
    default:
      return false;
  }
}

export function createHoverTracker(): HoverTracker {
  const overs: { el: Element; at: number }[] = [];
  const revealed = new WeakMap<Element, number[]>();
  const mark = (el: Element, at: number) => {
    const times = revealed.get(el) ?? [];
    times.push(at);
    if (times.length > MAX_REVEALS) times.shift();
    revealed.set(el, times);
  };
  return {
    over(path, at) {
      const t = resolveTargetFromPath(path);
      if (!t) return;
      if (overs[overs.length - 1]?.el === t.element) return;
      overs.push({ el: t.element, at });
      if (overs.length > MAX_OVERS) overs.shift();
    },
    mutated(records, at) {
      for (const r of records) {
        if (r.type === 'childList') {
          for (const n of r.addedNodes) if (n instanceof Element) mark(n, at);
        } else if (r.type === 'attributes' && r.target instanceof Element && isReveal(r, r.target)) {
          mark(r.target, at);
        }
      }
    },
    triggerFor(clicked, at, since) {
      const root = clicked.ownerDocument;
      let box: Element | null = clicked;
      for (let i = 0; box && i < MAX_LEVELS; i++, box = composedParent(box)) {
        if (box === root.documentElement || box === root.body) break;
        for (const changedAt of [...(revealed.get(box) ?? [])].reverse()) {
          if (at - changedAt > CLICK_WINDOW_MS || changedAt <= since) continue;
          const h = triggerOf(box, changedAt, since);
          if (h && h !== clicked && !clicked.contains(h) && !h.contains(clicked)) return h;
        }
      }
      return null;
    },
  };

  /** The element the pointer rested on when `box` was revealed, if the menu then stayed in use. */
  function triggerOf(box: Element, changedAt: number, since: number): Element | null {
    let k = -1;
    for (let j = overs.length - 1; j >= 0; j--) {
      // The trigger's pointerover is always handled before the reveal it causes. One that comes
      // after a reveal is the page moving under a still pointer (content inserted above it).
      if (overs[j]!.at <= changedAt) {
        k = j;
        break;
      }
    }
    const o = overs[k];
    if (!o || o.at <= since) return null;
    const h = o.el;
    const popup = announcesPopup(h);
    if (changedAt - o.at > (popup ? OPEN_DELAY_MS : QUICK_OPEN_MS)) return null;
    if (!popup && changedAt - since < AFTER_STEP_MS) return null;
    // The pointer was inside the container already: a highlight, not a menu opening.
    if (!h.isConnected || box.contains(h)) return null;
    // From the trigger to the click, the pointer kept the menu open.
    for (let j = k + 1; j < overs.length; j++) {
      const p = overs[j]!.el;
      if (!p.isConnected || h.contains(p) || box.contains(p) || p.contains(h) || p.contains(box)) continue;
      return null;
    }
    return h;
  }
}
