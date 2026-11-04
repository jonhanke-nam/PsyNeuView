/**
 * Node shapes, matching PsyNeuLink's show_graph (#192, #193).
 *
 * show_graph draws an ordinary mechanism as an oval and gives a few kinds of
 * node a shape of their own (`showgraph.py`): a feedback sender is an
 * octagon, a node on a cycle a double circle, a controller a double octagon,
 * and a nested composition a rectangle. The canvas keeps those shapes so a
 * picture here reads like show_graph's, and each shape says what it means in
 * a tooltip on the node and in the legend.
 *
 * The geometry here is in the node's own box, so ports and floating edge
 * ends can sit on the shape's outline rather than on the oval it replaces.
 * show_graph's egg (an OptimizationControlMechanism's agent_rep) has no node
 * on the canvas to draw it on yet.
 */

export type NodeShape = "oval" | "octagon" | "doubleoctagon" | "doublecircle" | "rectangle";

/** What of a node decides its shape (a subset of MechanismData). */
export interface ShapedNodeData {
  type?: string;
  roles?: string[];
  isController?: boolean;
}

/** show_graph's precedence: composition, controller, feedback sender, cycle, mechanism. */
export function nodeShapeFor(d: ShapedNodeData | undefined | null): NodeShape {
  if (!d) return "oval";
  if (d.type === "Composition") return "rectangle";
  if (d.isController) return "doubleoctagon";
  const roles = d.roles || [];
  if (roles.includes("FEEDBACK_SENDER")) return "octagon";
  if (roles.includes("CYCLE")) return "doublecircle";
  return "oval";
}

/** The shapes the legend lists, in the order it lists them. */
export const SHAPE_ORDER: NodeShape[] = ["oval", "octagon", "doublecircle", "doubleoctagon", "rectangle"];

export const SHAPE_INFO: Record<NodeShape, { label: string; meaning: string; drawn: string }> = {
  oval: {
    label: "mechanism",
    meaning: "An ordinary mechanism.",
    drawn: "an oval, as show_graph draws it",
  },
  octagon: {
    label: "feedback sender",
    meaning: "Its output travels back along a feedback connection to an earlier node, closing a loop.",
    drawn: "an octagon, as show_graph draws it",
  },
  doublecircle: {
    label: "on a cycle",
    meaning: "It sits on a loop of connections that runs as a cycle.",
    drawn: "a double outline, show_graph's double circle",
  },
  doubleoctagon: {
    label: "controller",
    meaning: "It sets the control signals that adjust other nodes in this composition.",
    drawn: "a double octagon, as show_graph draws it",
  },
  rectangle: {
    label: "collapsed composition",
    meaning: "A nested composition folded into one node; expand it with + or a double-click.",
    drawn: "a rectangle, as show_graph draws a nested composition",
  },
};

/** The tooltip for a node of this shape; none for a plain mechanism. */
export function shapeTooltip(shape: NodeShape): string | undefined {
  if (shape === "oval") return undefined;
  const { label, meaning, drawn } = SHAPE_INFO[shape];
  return `${label[0].toUpperCase()}${label.slice(1)}: ${meaning} Drawn as ${drawn}.`;
}

/** Shapes drawn as an SVG outline rather than a CSS border. */
export function isDrawnOutline(shape: NodeShape): boolean {
  return shape === "octagon" || shape === "doubleoctagon" || shape === "doublecircle";
}

// Graphviz's octagon is a regular octagon stretched to the label's box: its
// flat sides lie on the box and each corner is cut back by tan 22.5° of the
// half-extent.
const K = Math.tan(Math.PI / 8); // 0.414
const OCTAGON: [number, number][] = [
  [1, -K], [1, K], [K, 1], [-K, 1], [-1, K], [-1, -K], [-K, -1], [K, -1],
];
const RECTANGLE: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

/** The shape's corners in its box, -1..1 on each axis; null for a round shape. */
export function shapePolygon(shape: NodeShape): [number, number][] | null {
  switch (shape) {
    case "octagon":
    case "doubleoctagon":
      return OCTAGON;
    case "rectangle":
      return RECTANGLE;
    default:
      return null;
  }
}

/**
 * Where a ray from the box's centre in direction (dx, dy) leaves the shape,
 * -1..1 on each axis. For a round shape that is the inscribed ellipse, the
 * point the oval maths already gives.
 */
export function boundaryDir(shape: NodeShape, dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const poly = shapePolygon(shape);
  if (!poly) return [ux, uy];
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const ex = x2 - x1, ey = y2 - y1;
    const det = ux * ey - uy * ex;
    if (Math.abs(det) < 1e-12) continue;
    const t = (x1 * ey - y1 * ex) / det;
    const s = (x1 * uy - y1 * ux) / det;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  if (!Number.isFinite(best)) return [ux, uy];
  return [ux * best, uy * best];
}

/**
 * How far in from the box's edge the outline sits at `t` (-1..1 along that
 * edge), as a fraction of the box's half-extent. A port placed at `t` along
 * the top edge sits this far down, so it lands on the drawn outline.
 */
export function boundaryInward(shape: NodeShape, t: number): number {
  const a = Math.min(1, Math.abs(t));
  switch (shape) {
    case "rectangle":
      return 0;
    case "octagon":
    case "doubleoctagon":
      // Flat to the corner at K, then down the 45° diagonal to the side.
      return Math.min(1 - K, Math.max(0, a - K));
    default:
      return 1 - Math.sqrt(1 - a * a);
  }
}

/** A node's box as the edge maths sees it: centre and half-extents. */
export interface NodeBox { cx: number; cy: number; a: number; b: number }

/**
 * Move a point on a node's inscribed oval out to the node's real outline,
 * along the ray from the node's centre. A round shape keeps the point.
 */
export function onShapeBoundary(box: NodeBox, shape: NodeShape, p: { x: number; y: number }): { x: number; y: number } {
  if (!shapePolygon(shape)) return p;
  const [nx, ny] = boundaryDir(shape, (p.x - box.cx) / (box.a || 1), (p.y - box.cy) / (box.b || 1));
  return { x: box.cx + nx * box.a, y: box.cy + ny * box.b };
}

/**
 * SVG `points` for the shape's polygon in a w×h box, `inset` px inside it
 * (half a stroke, so the stroke stays within the box).
 */
export function polygonPoints(shape: NodeShape, w: number, h: number, inset: number): string {
  const poly = shapePolygon(shape);
  if (!poly) return "";
  const hw = Math.max(0, w / 2 - inset), hh = Math.max(0, h / 2 - inset);
  return poly.map(([x, y]) => `${w / 2 + x * hw},${h / 2 + y * hh}`).join(" ");
}
