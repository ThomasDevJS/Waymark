/**
 * Where a solid shape is among matching pixels (e2e helper, pure). Anti-aliased text nearby can
 * leave scattered pixels of a similar colour (coloured subpixel fringes on CI's Chrome), which a
 * plain bounding box of all matches would include. The largest 4-connected group is the shape.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function largestBlob(points: readonly (readonly [number, number])[]): Box | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const left = new Set(points.map(([x, y]) => key(x, y)));
  let best: { n: number; box: Box } | null = null;
  for (const [sx, sy] of points) {
    if (!left.has(key(sx, sy))) continue;
    left.delete(key(sx, sy));
    const stack: [number, number][] = [[sx, sy]];
    let n = 0;
    let x0 = sx;
    let x1 = sx;
    let y0 = sy;
    let y1 = sy;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const k = key(x + dx, y + dy);
        if (left.has(k)) {
          left.delete(k);
          stack.push([x + dx, y + dy]);
        }
      }
    }
    if (!best || n > best.n) best = { n, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
  }
  return best?.box ?? null;
}
