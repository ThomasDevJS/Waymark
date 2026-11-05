/**
 * Motion helpers (D130). CSS does almost all of the motion; this file is the small rest that
 * needs to know where something was before a change (FLIP). It uses the Web Animations API,
 * which runs transform and opacity animations off the main thread and cleans up after itself
 * (no fill, no lasting will-change). No chrome.* calls: the pages and the content script share it.
 *
 * The values mirror the motion tokens in tokens.css (a unit test keeps them equal).
 */

export const DUR = { press: 80, fast: 120, base: 180, slow: 240 } as const;
export const EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
} as const;

/** True when the user asked for less motion (or there is no way to tell, e.g. happy-dom). */
export function reducedMotion(win: Window = window): boolean {
  try {
    return typeof win.matchMedia !== 'function' || win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/** True when this element can run Web Animations (happy-dom and old engines can't). */
function canAnimate(el: Element): el is Element & { animate: Element['animate'] } {
  return typeof (el as Partial<Element>).animate === 'function';
}

/** A box relative to its list, so scrolling the page between two measures moves nothing. */
export interface Pos {
  x: number;
  y: number;
}

/** Positions of a list's keyed children, relative to the list. Reads layout once per child. */
export function measure(list: Element, attr: string): Map<string, Pos> {
  const base = list.getBoundingClientRect();
  const out = new Map<string, Pos>();
  for (const child of Array.from(list.children)) {
    const key = child.getAttribute(attr);
    if (key) {
      const r = child.getBoundingClientRect();
      out.set(key, { x: r.left - base.left, y: r.top - base.top });
    }
  }
  return out;
}

/**
 * FLIP: children that moved since `before` (all of them, or only the keys in `only`) slide from
 * where they were to where they are now, on the compositor (transform only). New children are
 * left to their CSS entrance; removed ones are already gone. Returns the positions now.
 */
export function flipList(list: Element, attr: string, before: Map<string, Pos> | null, opts: { duration?: number; max?: number; only?: Set<string> } = {}): Map<string, Pos> {
  const now = measure(list, attr);
  if (!before || reducedMotion(list.ownerDocument.defaultView ?? window)) return now;
  const duration = opts.duration ?? DUR.slow;
  // A long jump (e.g. a step moved across a long list) glides only the last part of the way.
  const max = opts.max ?? 160;
  for (const child of Array.from(list.children)) {
    const key = child.getAttribute(attr);
    if (key && opts.only && !opts.only.has(key)) continue;
    const was = key ? before.get(key) : undefined;
    const is = key ? now.get(key) : undefined;
    if (!was || !is || !canAnimate(child)) continue;
    let dx = was.x - is.x;
    let dy = was.y - is.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    dx = Math.max(-max, Math.min(max, dx));
    dy = Math.max(-max, Math.min(max, dy));
    child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: EASE.standard });
  }
  return now;
}
