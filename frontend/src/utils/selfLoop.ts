/**
 * A projection from a node to itself, drawn as a loop on the node (#425), as
 * show_graph draws a RecurrentTransferMechanism's or an LCA's recurrent
 * projection.
 *
 * The loop leaves the node's outline at one point and comes back at another
 * (two distinct attachment points, design principle 3: no two arrows meet at
 * one point), on the side of the node the fewest other arrows use: the right,
 * as Graphviz puts it, unless the node's other arrows come and go there.
 */
import type { Oval } from "./edgeLanes";

interface Point {
  x: number;
  y: number;
}

/** The sides a loop can take, in order of preference: right (Graphviz's), left, below, above. */
const SIDES = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

/** Half the angle between the loop's two ends, around the side's direction. */
export const LOOP_SPREAD_RAD = (28 * Math.PI) / 180;

const angleGap = (a: number, b: number) => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

/** How far the nearest other arrow must be from a side's direction for the loop to take it. */
export const LOOP_CLEARANCE_RAD = LOOP_SPREAD_RAD + (20 * Math.PI) / 180;

/**
 * The direction (radians, screen coordinates: 0 is right, π/2 is down) of the
 * side the loop goes on: the first side, in order of preference, that the
 * node's other arrows keep clear of (LOOP_CLEARANCE_RAD), so the loop sits on
 * the right, where show_graph draws it, unless an arrow leaves there; failing
 * that, the side furthest from every other arrow. `others` are the centres of
 * the nodes at the far ends of the node's other arrows.
 */
export function selfLoopSide(oval: Oval, others: Point[]): number {
  const aims = others
    .filter((p) => Math.hypot(p.x - oval.cx, p.y - oval.cy) > 1e-6)
    .map((p) => Math.atan2(p.y - oval.cy, p.x - oval.cx));
  if (!aims.length) return SIDES[0];
  const gapAt = (side: number) => Math.min(...aims.map((a) => angleGap(a, side)));
  const clear = SIDES.find((side) => gapAt(side) >= LOOP_CLEARANCE_RAD);
  if (clear !== undefined) return clear;
  let best = SIDES[0];
  for (const side of SIDES) if (gapAt(side) > gapAt(best) + 1e-3) best = side;
  return best;
}

export interface SelfLoop {
  /** Where the loop leaves the node and where it comes back: two different points. */
  start: Point;
  end: Point;
  /** The SVG path, from start to end. */
  path: string;
  /** The loop's farthest point from the node, where its label sits. */
  apex: Point;
}

/**
 * The loop on `oval`'s `side`. `onOutline` moves a point on the oval onto the
 * node's drawn outline (an octagon's, say), along the same ray.
 */
export function selfLoopGeometry(
  oval: Oval,
  side: number,
  onOutline: (p: Point) => Point = (p) => p,
): SelfLoop {
  const rim = (angle: number): Point => {
    // The point on the oval in that screen direction.
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const t = 1 / Math.sqrt((ux / (oval.a || 1)) ** 2 + (uy / (oval.b || 1)) ** 2);
    return onOutline({ x: oval.cx + ux * t, y: oval.cy + uy * t });
  };
  const start = rim(side - LOOP_SPREAD_RAD);
  const end = rim(side + LOOP_SPREAD_RAD);
  // How far the loop reaches out: with the node's size, within reason.
  const reach = Math.min(70, Math.max(26, 0.6 * Math.min(oval.a, oval.b) + 14));
  const ux = Math.cos(side), uy = Math.sin(side);
  const pull = reach * (4 / 3);
  const c1 = { x: start.x + ux * pull, y: start.y + uy * pull };
  const c2 = { x: end.x + ux * pull, y: end.y + uy * pull };
  const path = `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`;
  // A cubic's midpoint: (P0 + 3 P1 + 3 P2 + P3) / 8.
  const apex = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
  return { start, end, path, apex };
}
