/**
 * Menus that open while the pointer rests on their trigger (D204, #94). The recorder records
 * clicks, never hovers, so the click on such a menu's item was recorded alone and its item was
 * hidden when the guide played. This tracker tells the recorder when a click needs a "Point at"
 * step before it. All of these must hold:
 * - the clicked item, or a container of it (at most 10 levels up, not `<body>`), was revealed:
 *   inserted (not a replacement: a record that also removes elements is a re-render), or shown by
 *   a change of its `hidden`, `aria-hidden`, `open`, `data-state`, inline style or class (judged
 *   from the old value against a short list of words, so a live page restyling itself does not
 *   count);
 * - the element the pointer last came onto before that reveal is a control (not plain content),
 *   is outside the container, got there by a move of the pointer (not a scroll or the page moving
 *   under it) at most QUICK_OPEN_MS before the reveal, or OPEN_DELAY_MS when the trigger's
 *   `aria-expanded` turned "true" with the reveal or its `aria-haspopup` is set (the trigger);
 * - the reveal came AFTER_STEP_MS or more after the last recorded step or typing (else that
 *   step caused it: a panel a click loaded, suggestions for what was typed);
 * - from the trigger to the click, the pointer stayed on the trigger, in the container, or on
 *   something around them (the menu stayed in use), and no step was recorded since the trigger;
 * - the trigger is not the clicked item, inside it, or around it.
 * So a tooltip (it is not the clicked item's container), a `title` (no change in the page) and a
 * row that highlights on hover (the pointer was already inside it) record no hover step. Menus
 * shown by CSS `:hover` alone change nothing in the page, and a menu marked open on an element
 * that also holds its trigger cannot be told from a highlighted row, so neither is detected (the
 * learner can still point at the trigger: the not-found card says so).
 */
import { composedParent, resolveTargetFromPath } from '../fingerprint/dom';

/** The pointer reached the trigger at most this long before the menu was revealed... */
export const OPEN_DELAY_MS = 2000;
/** ...or this long, unless the trigger announced the popup with the reveal. */
export const QUICK_OPEN_MS = 600;
/** A reveal this soon after a recorded step or typing is that step's doing. */
export const AFTER_STEP_MS = 1500;
/** The click came at most this long after the reveal. */
export const CLICK_WINDOW_MS = 20_000;
/** A pointerover this soon after a scroll is the page moving under the pointer. */
export const SCROLL_STILL_MS = 200;
const MAX_OVERS = 100;
const MAX_LEVELS = 10;
const MAX_REVEALS = 4;

export interface HoverTracker {
  /** A pointerover: where the pointer rests now (its path; the caller leaves Waymark's own UI out). */
  over(path: EventTarget[], at: number): void;
  /** A scroll or wheel: pointerovers right after it are not the pointer moving. */
  scrolled(at: number): void;
  /** What changed in the page (records from an observer with `attributeOldValue`). */
  mutated(records: MutationRecord[], at: number): void;
  /** The trigger the clicked element's menu opened from, or null. `since`: the last recorded step's (or typing's) time. */
  triggerFor(clicked: Element, at: number, since: number): Element | null;
  /** The element, or a container of it (10 levels up, not `<body>`), was revealed at `since` or later (#115). */
  revealedSince(el: Element, since: number): boolean;
}

const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0*)?\s*(?:!important)?\s*(?:;|$))/i;
/** The last word of a class token that shows its element (`open`, `is-open`, `menu--open`, `show`). */
const SHOW_WORDS = new Set(['open', 'opened', 'show', 'shown', 'showing', 'visible', 'expanded', 'hover', 'hovered']);
/** ...and of one whose removal shows it (`hidden`, `is-hidden`, `collapsed`; `d-none`). */
const HIDE_WORDS = new Set(['hidden', 'hide', 'closed', 'collapsed', 'invisible']);

const tokens = (s: string | null) => new Set((s ?? '').split(/\s+/).filter(Boolean));
const words = (token: string) => token.toLowerCase().split(/[-_]+/).filter(Boolean);
const showsToken = (t: string) => {
  const w = words(t);
  return SHOW_WORDS.has(w[w.length - 1] ?? '') && !w.includes('focus');
};
const hidesToken = (t: string) => {
  const w = words(t);
  const lastWord = w[w.length - 1] ?? '';
  return HIDE_WORDS.has(lastWord) || (lastWord === 'none' && (w[0] === 'd' || w[0] === 'display'));
};

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
      for (const t of after) if (!before.has(t) && showsToken(t)) return true;
      for (const t of before) if (!after.has(t) && hidesToken(t)) return true;
      return false;
    }
    default:
      return false;
  }
}

interface Over {
  ref: WeakRef<Element>;
  at: number;
  /** A control (not plain content the pointer crossed). */
  control: boolean;
  /** Came right after a scroll: the page moved, not the pointer. */
  still: boolean;
}

export function createHoverTracker(): HoverTracker {
  const overs: Over[] = [];
  const revealed = new WeakMap<Element, number[]>();
  const expandedAt = new WeakMap<Element, number>();
  let scrolledAt = -Infinity;
  const mark = (el: Element, at: number) => {
    const times = revealed.get(el) ?? [];
    times.push(at);
    if (times.length > MAX_REVEALS) times.shift();
    revealed.set(el, times);
  };
  const removesElements = (r: MutationRecord) => {
    for (const n of r.removedNodes) if (n instanceof Element) return true;
    return false;
  };

  /** The trigger said it opened a popup with this reveal (not an `aria-expanded` that stays "true"). */
  const announced = (h: Element, changedAt: number): boolean => {
    const e = expandedAt.get(h);
    if (e !== undefined && Math.abs(changedAt - e) <= QUICK_OPEN_MS) return true;
    const p = h.getAttribute('aria-haspopup');
    return p !== null && p !== 'false';
  };

  /** The element the pointer moved onto before `box` was revealed, if the menu then stayed in use. */
  const triggerOf = (box: Element, changedAt: number, since: number): Element | null => {
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
    const h = o?.ref.deref();
    if (!o || !h || o.at <= since || o.still || !o.control) return null;
    if (changedAt - o.at > (announced(h, changedAt) ? OPEN_DELAY_MS : QUICK_OPEN_MS)) return null;
    // The pointer was inside the container already: a highlight, not a menu opening.
    if (!h.isConnected || box.contains(h)) return null;
    // From the trigger to the click, the pointer kept the menu open.
    for (let j = k + 1; j < overs.length; j++) {
      const p = overs[j]!.ref.deref();
      if (!p || !p.isConnected || h.contains(p) || box.contains(p) || p.contains(h) || p.contains(box)) continue;
      return null;
    }
    return h;
  };

  return {
    over(path, at) {
      const t = resolveTargetFromPath(path);
      if (!t) return;
      if (overs[overs.length - 1]?.ref.deref() === t.element) return;
      overs.push({ ref: new WeakRef(t.element), at, control: !t.lowConfidence, still: at - scrolledAt < SCROLL_STILL_MS });
      if (overs.length > MAX_OVERS) overs.shift();
    },
    scrolled(at) {
      scrolledAt = at;
    },
    mutated(records, at) {
      for (const r of records) {
        if (r.type === 'childList') {
          if (removesElements(r)) continue; // a re-render, or a polled list replacing its rows
          for (const n of r.addedNodes) if (n instanceof Element) mark(n, at);
        } else if (r.type === 'attributes' && r.target instanceof Element) {
          if (r.attributeName === 'aria-expanded') {
            if (r.oldValue !== 'true' && r.target.getAttribute('aria-expanded') === 'true') expandedAt.set(r.target, at);
          } else if (isReveal(r, r.target)) mark(r.target, at);
        }
      }
    },
    revealedSince(el, since) {
      const root = el.ownerDocument;
      let a: Element | null = el;
      for (let i = 0; a && i < MAX_LEVELS; i++, a = composedParent(a)) {
        if (a === root.documentElement || a === root.body) break;
        if (revealed.get(a)?.some((t) => t >= since)) return true;
      }
      return false;
    },
    triggerFor(clicked, at, since) {
      const root = clicked.ownerDocument;
      let box: Element | null = clicked;
      for (let i = 0; box && i < MAX_LEVELS; i++, box = composedParent(box)) {
        if (box === root.documentElement || box === root.body) break;
        for (const changedAt of [...(revealed.get(box) ?? [])].reverse()) {
          if (at - changedAt > CLICK_WINDOW_MS || changedAt - since < AFTER_STEP_MS) continue;
          const h = triggerOf(box, changedAt, since);
          if (h && h !== clicked && !clicked.contains(h) && !h.contains(clicked)) return h;
        }
      }
      return null;
    },
  };
}
