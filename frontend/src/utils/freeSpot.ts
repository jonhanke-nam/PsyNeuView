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

/** The box around all of `boxes`, or null when there are none. */
export function boundsOf(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const btm = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

/**
 * Where a new node goes when nothing is selected (#411): in empty space
 * beside the graph, never in a gap inside it, where arrows run. Just right of
 * the graph's bounding box, centred on it top to bottom; if that isn't in
 * `visible` (the part of the graph showing), just below the graph, centred
 * left to right; then just left of it. If none of the three is showing, the
 * right-hand one, and the caller brings it into view. With no graph, the
 * middle of what is showing (or the origin).
 */
export function besideGraph(
  taken: Box[],
  size: { width: number; height: number },
  visible: Box | null,
  gap = 24,
): Point {
  const g = boundsOf(taken);
  if (!g) return visible ? { x: visible.x + visible.w / 2, y: visible.y + visible.h / 2 } : { x: 0, y: 0 };
  const right = { x: g.x + g.w + gap + size.width / 2, y: g.y + g.h / 2 };
  const below = { x: g.x + g.w / 2, y: g.y + g.h + gap + size.height / 2 };
  const left = { x: g.x - gap - size.width / 2, y: g.y + g.h / 2 };
  const shows = (c: Point) =>
    !visible ||
    (c.x - size.width / 2 >= visible.x &&
      c.x + size.width / 2 <= visible.x + visible.w &&
      c.y - size.height / 2 >= visible.y &&
      c.y + size.height / 2 <= visible.y + visible.h);
  return [right, below, left].find(shows) ?? right;
}
