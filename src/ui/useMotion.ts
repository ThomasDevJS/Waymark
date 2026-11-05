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
  return out;
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
 */
export function useFlipList<T extends HTMLElement>(keys: readonly string[]) {
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
    plan.current = only.size && ref.current?.isConnected && !reducedMotion() ? { before: measure(ref.current, 'data-flip'), only } : null;
    last.current = keys;
  }
  useLayoutEffect(() => {
    if (plan.current && ref.current) flipList(ref.current, 'data-flip', plan.current.before, { only: plan.current.only });
    plan.current = null;
  }, [sig]);
  return { ref, enter: (key: string) => (fresh.current.has(key) ? 'enter' : '') };
}
