/**
 * Where a new node can go without covering anything (#411).
 *
 * Placing a picked-up component from the keyboard has no click to say where
 * it goes, so it goes to the free spot nearest a point the app chooses (the
 * middle of the view, or the selected node). "Free" means a box of the new
 * node's size, centred there, keeps `gap` clear of every box already drawn:
 * nothing on the graph may overlap.
 *
 * The search walks out from the point in square rings of `step`, and stops
 * once no ring further out can hold a nearer spot than the best found.
 */

export interface Point {
  x: number;
  y: number;
}

/** A drawn box: top-left corner, width and height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clears = (a: Box, b: Box, gap: number) =>
  a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y;

/** Whether a box of `size`, centred at `c`, keeps `gap` clear of every box in `taken`. */
export function isFree(c: Point, size: { width: number; height: number }, taken: Box[], gap: number): boolean {
  const box = { x: c.x - size.width / 2, y: c.y - size.height / 2, w: size.width, h: size.height };
  return taken.every((t) => clears(box, t, gap));
}

/**
 * The centre nearest `want` where a box of `size` covers nothing in `taken`
 * (with `gap` to spare). `want` itself when it is already free.
 */
export function nearestFreeCentre(
  want: Point,
  size: { width: number; height: number },
  taken: Box[],
  { gap = 24, step = 20, maxRings = 200 }: { gap?: number; step?: number; maxRings?: number } = {},
): Point {
  let best: { p: Point; d: number } | null = null;
  for (let r = 0; r <= maxRings; r++) {
    // Every point on ring r is at least r * step away: none can beat the best.
    if (best && r * step > best.d) break;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const p = { x: want.x + i * step, y: want.y + j * step };
        const d = Math.hypot(i * step, j * step);
        if (best && d >= best.d) continue;
        if (isFree(p, size, taken, gap)) best = { p, d };
      }
    }
  }
  return best?.p ?? want;
}
