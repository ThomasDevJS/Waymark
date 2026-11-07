/**
 * Reordering steps in the editor (D205, #108): pure helpers for the drag handle, its keyboard
 * mode and Move to top / bottom. No DOM: the editor measures the cards and passes numbers in.
 */

/** `items` with the item at `from` moved so that it ends up at index `to` (clamped). Same array when nothing moves. */
export function moveItem<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from < 0 || from >= items.length) return items;
  const dest = Math.max(0, Math.min(items.length - 1, to));
  if (dest === from) return items;
  const copy = items.slice();
  const [it] = copy.splice(from, 1);
  copy.splice(dest, 0, it as T);
  return copy;
}

/** A card's box along the list, in the same coordinates as the pointer (top and height). */
export interface Span {
  top: number;
  height: number;
}

/**
 * Where the dragged card lands: its final index, given the cards' boxes in list order (the dragged
 * one included, at `from`) and the pointer's position. A card moves out of the way once the
 * pointer passes its middle.
 */
export function dropIndex(spans: readonly Span[], from: number, y: number): number {
  let to = 0;
  for (let i = 0; i < spans.length; i++) {
    if (i === from) continue;
    const s = spans[i]!;
    if (y > s.top + s.height / 2) to++;
  }
  return to;
}

/** Pixels per frame to scroll when the pointer is near an edge of the scrolling area (0 elsewhere). */
export function edgeScroll(y: number, top: number, bottom: number, zone = 48, max = 16): number {
  if (bottom - top < zone * 3) return 0; // too small to have edges
  if (y < top + zone) return -Math.ceil(max * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) return Math.ceil(max * Math.min(1, (y - (bottom - zone)) / zone));
  return 0;
}
