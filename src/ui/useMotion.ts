/**
 * Preact side of the motion helpers (D130), for the extension pages.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { flipList, measure, reducedMotion, type Pos } from './motion';

/**
 * Keys whose order among the items kept on both sides changed: what really moved. Items that
 * only shifted because something above was added or removed are not in it.
 */
export function reordered(prev: readonly string[], next: readonly string[]): Set<string> {
  const kept = new Set(next);
  const a = prev.filter((k) => kept.has(k));
  const was = new Set(a);
  const b = next.filter((k) => was.has(k));
  const out = new Set<string>();
  // Moved items are those outside a longest common subsequence; for the small moves the
  // editor makes (one step up or down) comparing ranks is exact and cheap.
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.add(a[i]!).add(b[i]!);
  // One item moved several places (dragged, or Move to top): only it glides. Every row between
  // would glide too otherwise, up to the whole list (the bench's dropped frames, D205 review).
  if (out.size > 2) {
    const single = singleMove(a, b);
    if (single) return new Set([single]);
  }
  return out;
}

/** The key that alone moved from `a` to `b` (same keys), or null when more than one did. */
function singleMove(a: readonly string[], b: readonly string[]): string | null {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let j = a.length - 1;
  while (j > i && a[j] === b[j]) j--;
  if (i >= j) return null;
  const same = (x: number, y: number, n: number) => {
    for (let k = 0; k < n; k++) if (a[x + k] !== b[y + k]) return false;
    return true;
  };
  if (b[i] === a[j] && same(i, i + 1, j - i)) return a[j]!; // moved up from j to i
  if (a[i] === b[j] && same(i + 1, i, j - i)) return a[i]!; // moved down from i to j
  return null;
}

/**
 * Lists whose items get reordered (Move up / down): when the keys change, the items that moved
 * slide from their old place. Children carry `data-flip="<key>"`; `keys` lists them in order.
 * Nothing is measured unless the order changed, and only the items that moved animate: the
 * bench showed that measuring on every render, or gliding every row shifted by a delete,
 * dropped frames at 4× slower CPU. Rows shifted by a delete or Undo snap.
 *
 * `enter(key)` is the class for an item that is new in this render ('enter': it rises in). Only
 * new keys get it: a moved row is re-inserted by Preact, which would restart a CSS entrance.
 *
 * `glide: false` keeps only the entrances: lists whose order changes on its own (search results
 * sorted by score change order with every keystroke) must not slide rows under the cursor.
 */
export function useFlipList<T extends HTMLElement>(keys: readonly string[], opts: { glide?: boolean } = {}) {
  const ref = useRef<T>(null);
  const last = useRef<readonly string[] | null>(null);
  const fresh = useRef<Set<string>>(new Set());
  const plan = useRef<{ before: Map<string, Pos>; only: Set<string> } | null>(null);
  const sig = keys.join('\n');
  if (last.current === null || sig !== last.current.join('\n')) {
    const prev = new Set(last.current ?? []);
    fresh.current = new Set(keys.filter((k) => !prev.has(k)));
    const only = last.current ? reordered(last.current, keys) : new Set<string>();
    // Still rendering: the DOM shows the old order, so this is where the items were.
    plan.current = opts.glide !== false && only.size && ref.current?.isConnected && !reducedMotion() ? { before: measure(ref.current, 'data-flip'), only } : null;
    last.current = keys;
  }
  useLayoutEffect(() => {
    const p = plan.current;
    plan.current = null;
    if (!p) return;
    // In the next frame's animation callbacks, before its layout and paint: the new order is
    // never painted unmoved, and its layout is read where the frame does it anyway instead of
    // forced inside the click (which showed up as long tasks at 4× slower CPU).
    const id = requestAnimationFrame(() => {
      if (ref.current) flipList(ref.current, 'data-flip', p.before, { only: p.only });
    });
    return () => cancelAnimationFrame(id);
  }, [sig]);
  return { ref, enter: (key: string) => (fresh.current.has(key) ? 'enter' : '') };
}
