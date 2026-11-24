/**
 * "Like show_graph" layout (#19).
 *
 * Rather than imitate PsyNeuLink's show_graph(), ask it: the backend returns
 * show_graph's own Graphviz description of the composition, and Graphviz
 * (WebAssembly, in the page, so nothing needs installing) lays it out exactly
 * as show_graph would. Each PsyNeuView node then moves to where show_graph puts
 * the node of the same name, so rows, left-to-right order and the bottom-to-top
 * flow all match show_graph.
 *
 * PsyNeuView draws each node the size show_graph draws its oval, by Graphviz's
 * own rule for the name (utils/nodeBox.ts, #210), so show_graph's picture is
 * usually shown at its own size, and the node text at show_graph's proportion.
 * Where a box is bigger than its oval (a longer font, the type and role tags
 * on, an expanded node), the picture is enlarged, evenly, just enough that
 * every box fits where its oval was. The arrangement is unchanged: nothing is
 * re-laid-out, so the order within a row can't drift from show_graph's.
 *
 * Fetching and laying out are asynchronous, while the layout engines in
 * layout.ts are synchronous. So the work is split: `computeShowGraphPlacement`
 * does the asynchronous part and stores the result, and
 * `applyShowGraphPlacement` (called from `applyLayout`) reads it. Until a
 * placement for the current graph exists, the Layered layout stands in.
 */

import { currentSpacingFactor } from "@/stores/layoutSpacingStore";
import { withBusy } from "@/stores/busyStore";
import type { Edge, Node } from "@xyflow/react";
import type { Point, ShowGraphCurve } from "@/stores/showGraphCurvesStore";
import { boundaryDir, nodeShapeFor, type NodeShape, type ShapedNodeData } from "@/utils/nodeShape";

// Never shrink show_graph's picture, and cap the enlargement so one node with
// a very short name (a narrow oval) doesn't spread the whole graph out.
const MIN_SCALE = 1;
const MAX_SCALE = 3;

const DEFAULT_SIZE = { w: 180, h: 60 };

// An open frame's header row, as in layout.ts, and the least room between a
// member and the frame's other edges.
const FRAME_HEADER = 34;
const FRAME_MARGIN = 10;

export interface ShowGraphPlacement {
  /** Which graph and options this was computed for (see `placementKey`). */
  signature: string;
  /** show_graph's node centers and sizes, in points, y growing downward. */
  nodes: Map<string, { x: number; y: number; w: number; h: number }>;
  /** show_graph's cluster boxes (top-left + size), keyed by composition name. */
  clusters: Map<string, { x: number; y: number; w: number; h: number }>;
  /**
   * show_graph's drawn edges, in its order (#23): the nodes each joins and its
   * course as a cubic Bézier chain (3n+1 points), plus the arrow's tip when
   * Graphviz drew one. Points in the same orientation as `nodes`.
   */
  edges: { tail: string; head: string; spline: Point[]; tip?: Point }[];
  /**
   * Set when show_graph had to be asked differently to answer at all, e.g.
   * for learning as its PyTorch picture (#72); the page says so.
   */
  note?: string;
}

let current: ShowGraphPlacement | null = null;

export function getShowGraphPlacement(): ShowGraphPlacement | null {
  return current;
}

export function clearShowGraphPlacement(): void {
  current = null;
}

// The model store's nodes don't carry React Flow's measured sizes, so read a
// node's drawn size from the page when it has been drawn.
function drawnSize(id: string): { w: number; h: number } | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
  return el && el.offsetWidth > 0 ? { w: el.offsetWidth, h: el.offsetHeight } : null;
}

/** A node's size, where it is known: set, measured, or drawn on the page. */
export function knownSize(n: Node): { w?: number; h?: number } {
  const w = n.measured?.width ?? (n.style?.width as number | undefined) ?? n.width;
  const h = n.measured?.height ?? (n.style?.height as number | undefined) ?? n.height;
  if (w !== undefined && h !== undefined) return { w, h };
  const drawn = drawnSize(n.id);
  return { w: w ?? drawn?.w, h: h ?? drawn?.h };
}

export function nodeSize(n: Node): { w: number; h: number } {
  const { w, h } = knownSize(n);
  return { w: w ?? DEFAULT_SIZE.w, h: h ?? DEFAULT_SIZE.h };
}

/** The graph's node ids: a new show_graph layout is needed when they change. */
export function graphSignature(nodes: Node[]): string {
  return nodes
    .filter((n) => n.type === "mechanismNode")
    .map((n) => n.id)
    .sort()
    .join("|");
}

/** Node sizes: the layout is re-applied (not re-fetched) when they change. */
export function sizeSignature(nodes: Node[]): string {
  return nodes
    .filter((n) => n.type === "mechanismNode")
    .map((n) => {
      const { w, h } = nodeSize(n);
      return `${Math.round(w)}x${Math.round(h)}`;
    })
    .join("|");
}

// A frame's id is the composition's name in the nested view, and
// `cluster::outer␟inner` in the flat view (see reframeClusters).
function clusterNameOf(frame: Node): string {
  if (frame.id.startsWith("cluster::")) {
    const segs = frame.id.slice("cluster::".length).split("␟");
    return segs[segs.length - 1].replace(/-\d+$/, "");
  }
  return frame.id;
}

interface GvObject {
  name: string;
  pos?: string;
  width?: string;
  height?: string;
  bb?: string;
  nodes?: number[];
}
interface GvEdge {
  tail: number;
  head: number;
  pos?: string;
  style?: string;
}
interface GvJson {
  bb: string;
  objects?: (GvObject & { _gvid?: number })[];
  edges?: GvEdge[];
}

type GraphvizInstance = { layout: (dot: string, format: "json", engine: "dot") => string };
let graphviz: Promise<GraphvizInstance> | null = null;

// Loaded on first use: the WebAssembly build is about 1 MB and most sessions
// never pick this layout.
function loadGraphviz(): Promise<GraphvizInstance> {
  if (!graphviz) {
    const loading: Promise<GraphvizInstance> = import("@hpcc-js/wasm-graphviz").then((m) =>
      m.Graphviz.load(),
    );
    loading.catch(() => {
      graphviz = null;
    });
    graphviz = loading;
  }
  return graphviz;
}

function parsePair(s: string): [number, number] {
  const [a, b] = s.split(",").map(Number);
  return [a, b];
}

/**
 * Turn Graphviz's JSON into PsyNeuView's orientation. Graphviz's y axis points
 * up, so it is flipped: y' = height − y.
 */
export function placementFromGraphviz(json: GvJson, signature: string): ShowGraphPlacement {
  const [, , , bbH] = json.bb.split(",").map(Number);
  const nodes = new Map<string, { x: number; y: number; w: number; h: number }>();
  const clusters = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const o of json.objects ?? []) {
    if (o.pos) {
      const [x, y] = parsePair(o.pos);
      nodes.set(o.name, {
        x,
        y: bbH - y,
        w: Number(o.width ?? 1) * 72,
        h: Number(o.height ?? 0.5) * 72,
      });
    } else if (o.bb && o.name.startsWith("cluster_")) {
      const [x1, y1, x2, y2] = o.bb.split(",").map(Number);
      clusters.set(o.name.slice("cluster_".length), {
        x: x1,
        y: bbH - y2,
        w: x2 - x1,
        h: y2 - y1,
      });
    }
  }
  // Edges: only the drawn ones. show_graph adds many invisible edges just to
  // steer the layout (style=invis); those aren't projections.
  const names = new Map<number, string>();
  (json.objects ?? []).forEach((o, i) => names.set(o._gvid ?? i, o.name));
  const edges: ShowGraphPlacement["edges"] = [];
  for (const e of json.edges ?? []) {
    if (e.style === "invis" || !e.pos) continue;
    const tail = names.get(e.tail);
    const head = names.get(e.head);
    if (!tail || !head) continue;
    const spline: Point[] = [];
    let tip: Point | undefined;
    for (const tok of e.pos.trim().split(/\s+/)) {
      if (tok.startsWith("e,")) {
        const [x, y] = parsePair(tok.slice(2));
        tip = { x, y: bbH - y };
      } else if (!tok.startsWith("s,")) {
        const [x, y] = parsePair(tok);
        spline.push({ x, y: bbH - y });
      }
    }
    if (spline.length >= 4) edges.push({ tail, head, spline, ...(tip ? { tip } : {}) });
  }
  return { signature, nodes, clusters, edges };
}

/** Identifies a layout: the graph's nodes and the show_graph options used. */
export function placementKey(nodes: Node[], req: ShowGraphRequest): string {
  // The file too (#386): two models can share every node name (Cohen & Huston
  // 1994 and the conflict-monitoring model do) and still differ, so one
  // model's layout is never taken for another's.
  return `${req.filePath}#${graphSignature(nodes)}#${req.compositionName}#${JSON.stringify(req.options)}`;
}

export interface ShowGraphRequest {
  filePath: string;
  compositionName: string;
  options: Record<string, boolean | string>;
}

/** show_graph's description, and a note when it was asked differently (#72). */
async function fetchDot(req: ShowGraphRequest): Promise<{ dot: string; note?: string }> {
  const resp = await fetch("/api/model/show-graph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: req.filePath,
      composition_name: req.compositionName,
      options: req.options,
      format: "dot",
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `show_graph request failed (${resp.status})`);
  }
  return (await resp.json()) as { dot: string; note?: string };
}

/** How many of PsyNeuView's nodes show_graph drew. */
function matchedCount(nodes: Node[], placement: ShowGraphPlacement): number {
  return nodes.filter((n) => n.type === "mechanismNode" && placement.nodes.has(n.id)).length;
}

/** How well a placement fits: the nodes it draws, and the open frames it has a box for. */
function fit(nodes: Node[], placement: ShowGraphPlacement): number {
  const frames = nodes.filter((n) => n.type === "compositionNode" && placement.clusters.has(clusterNameOf(n)));
  return matchedCount(nodes, placement) + frames.length;
}

// The layout menu and the background watcher (useShowGraphLayout) can ask for
// the same layout at the same moment; they share one fetch.
const inFlight = new Map<string, Promise<ShowGraphPlacement>>();
// The layout asked for last. A slower answer for an earlier graph (the model
// before a switch) must not become the layout in use after it (#386).
let newestKey: string | null = null;

/** Fetch show_graph's description, lay it out, and store the result. */
export function computeShowGraphPlacement(
  req: ShowGraphRequest,
  nodes: Node[],
): Promise<ShowGraphPlacement> {
  const key = placementKey(nodes, req);
  newestKey = key;
  let pending = inFlight.get(key);
  if (!pending) {
    // Graphviz runs in the page: the wheel shows while it lays out (#38).
    pending = withBusy("show_graph layout", computeOnce(req, nodes, key)).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

async function computeOnce(
  req: ShowGraphRequest,
  nodes: Node[],
  key: string,
): Promise<ShowGraphPlacement> {
  const gv = await loadGraphviz();
  const layOut = async (r: ShowGraphRequest) => {
    const { dot, note } = await fetchDot(r);
    return { placement: placementFromGraphviz(JSON.parse(gv.layout(dot, "json", "dot")) as GvJson, key), note };
  };

  let { placement, note } = await layOut(req);
  // PsyNeuView draws some models' learning parts (a TARGET, a prediction
  // error, the learning mechanism) as ordinary nodes, which show_graph hides
  // unless asked. If show_graph missed nodes, ask again with learning shown
  // and keep whichever drew more of them.
  const mechs = nodes.filter((n) => n.type === "mechanismNode").length;
  if (matchedCount(nodes, placement) < mechs && !req.options.show_learning) {
    try {
      const withLearning = await layOut({ ...req, options: { ...req.options, show_learning: true } });
      if (matchedCount(nodes, withLearning.placement) > matchedCount(nodes, placement)) {
        ({ placement, note } = withLearning);
      }
    } catch {
      // Keep the first layout.
    }
  }
  // That PyTorch picture has no box for the nested composition (#72). Where
  // the canvas shows it open, or folded to one node, show_graph's picture
  // without learning fits better: keep whichever fits.
  if (note && req.options.show_learning) {
    try {
      const plain = await layOut({ ...req, options: { ...req.options, show_learning: false } });
      if (fit(nodes, plain.placement) > fit(nodes, placement)) {
        placement = plain.placement;
        note = `${note} It has no box for the nested composition, so the layout follows show_graph without learning.`;
      } else {
        note = `${note} The layout follows that picture.`;
      }
    } catch {
      // Keep the PyTorch picture.
    }
  }
  if (note) placement.note = note;
  if (key === newestKey) current = placement;
  return placement;
}

// Clear space kept between neighbouring boxes once enlarged: across a row,
// and between rows (where the arrows run). Graphviz's own least separations
// (nodesep 0.25in, ranksep 0.5in), so a picture whose boxes are no bigger than
// its ovals is shown at its own size (#210).
const GAP_X = 18;
const GAP_Y = 36;

/**
 * How much show_graph's picture must grow so that PsyNeuView's boxes, which
 * are bigger than show_graph's ovals, don't touch: enough for each pair of
 * neighbours in a row, and for each pair of neighbouring rows. Both
 * directions grow by the same amount, keeping show_graph's proportions.
 */
export function scaleFor(
  nodes: Node[],
  placement: ShowGraphPlacement,
  // #278: Spacing between nodes. 1 is show_graph's own; the least gaps
  // between boxes scale with it, so boxes still never touch.
  spacing = 1,
): { sx: number; sy: number } {
  const gapX = GAP_X * spacing;
  const gapY = GAP_Y * spacing;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const n of nodes) {
    if (n.type !== "mechanismNode") continue;
    const o = placement.nodes.get(n.id);
    if (!o) continue;
    const { w, h } = nodeSize(n);
    placed.push({ x: o.x, y: o.y, w, h });
  }
  const rows = new Map<number, typeof placed>();
  for (const p of placed) {
    const key = Math.round(p.y);
    (rows.get(key) ?? rows.set(key, []).get(key)!).push(p);
  }
  let scale = MIN_SCALE * spacing;
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const [a, b] = [row[i - 1], row[i]];
      const dx = b.x - a.x;
      if (dx > 0) scale = Math.max(scale, ((a.w + b.w) / 2 + gapX) / dx);
    }
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    const tallest = (y: number) => Math.max(...rows.get(y)!.map((p) => p.h));
    const dy = ys[i] - ys[i - 1];
    if (dy > 0) scale = Math.max(scale, ((tallest(ys[i]) + tallest(ys[i - 1])) / 2 + gapY) / dy);
  }
  scale = Math.min(scale, MAX_SCALE);
  return { sx: scale, sy: scale };
}

/** Nodes placed like show_graph, and how a show_graph point maps onto them. */
interface Placed {
  nodes: Node[];
  /** show_graph point -> flow coordinates, as the nodes were moved. */
  toFlow: (p: Point) => Point;
  /** Each placed node's box in flow coordinates (absolute top-left + size). */
  boxes: Map<string, { x: number; y: number; w: number; h: number }>;
}

/**
 * Move nodes to their show_graph positions, enlarged by `scaleFor`. Frames
 * take their cluster's box; a frame's members are positioned relative to it
 * (React Flow's convention). Nodes show_graph doesn't draw are stacked in a
 * column to the right. Returns null when the placement doesn't fit this graph,
 * so the caller can fall back.
 */
export function applyShowGraphPlacement(
  nodes: Node[],
  placement: ShowGraphPlacement | null = current,
): Node[] | null {
  return place(nodes, placement)?.nodes ?? null;
}

/**
 * The placement and, for each edge show_graph draws, its course on the canvas
 * (#23). Edges show_graph doesn't draw, or that can't be matched, get none and
 * route as usual.
 */
export function applyShowGraphPlacementWithCurves(
  nodes: Node[],
  edges: Edge[],
  placement: ShowGraphPlacement | null = current,
): { nodes: Node[]; curves: Record<string, ShowGraphCurve> } | null {
  const placed = place(nodes, placement);
  if (!placed || !placement) return null;
  return { nodes: placed.nodes, curves: edgeCurves(edges, placement, placed) };
}

/**
 * Whether the placement is for this graph, so the Like show_graph layout
 * places it rather than the Layered stand-in. Not when it was computed for
 * some other graph (a different model, or before a reload).
 */
export function placementFits(nodes: Node[], placement: ShowGraphPlacement | null = current): boolean {
  if (!placement) return false;
  const mechs = nodes.filter((n) => n.type === "mechanismNode");
  const matched = mechs.filter((n) => placement.nodes.has(n.id));
  return mechs.length > 0 && matched.length >= mechs.length / 2;
}

function place(nodes: Node[], placement: ShowGraphPlacement | null): Placed | null {
  if (!placement || !placementFits(nodes, placement)) return null;

  const { sx, sy } = scaleFor(nodes, placement, currentSpacingFactor("showgraph"));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absTopLeft = new Map<string, { x: number; y: number }>();
  const frameSize = new Map<string, { w: number; h: number }>();

  for (const n of nodes) {
    if (n.type === "compositionNode") {
      const box = placement.clusters.get(clusterNameOf(n));
      if (box) {
        absTopLeft.set(n.id, { x: box.x * sx, y: box.y * sy });
        frameSize.set(n.id, { w: box.w * sx, h: box.h * sy });
      }
      continue;
    }
    const { w, h } = nodeSize(n);
    const o = placement.nodes.get(n.id);
    // A composition folded to one node, when show_graph drew it open: put it
    // at the middle of show_graph's box for it.
    const box = o ? undefined : placement.clusters.get(n.id);
    const cx = o ? o.x : box ? box.x + box.w / 2 : undefined;
    const cy = o ? o.y : box ? box.y + box.h / 2 : undefined;
    if (cx !== undefined && cy !== undefined) {
      absTopLeft.set(n.id, { x: cx * sx - w / 2, y: cy * sy - h / 2 });
    }
  }

  // A frame's header (its name and buttons) runs along its top edge, but
  // show_graph's cluster has nothing there, and boxes enlarged from its ovals
  // can reach up into it (#71). Grow each frame, innermost first, until its
  // members sit below the header and inside its other edges. Rows are at
  // least GAP_Y apart, so the header still clears the row above.
  const depth = (n: Node): number => {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    return parent ? 1 + depth(parent) : 0;
  };
  const frames = nodes.filter((n) => frameSize.has(n.id)).sort((a, b) => depth(b) - depth(a));
  for (const f of frames) {
    const p = absTopLeft.get(f.id)!;
    const s = frameSize.get(f.id)!;
    let [left, top, right, bottom] = [p.x, p.y, p.x + s.w, p.y + s.h];
    for (const m of nodes) {
      const mp = m.parentId === f.id ? absTopLeft.get(m.id) : undefined;
      if (!mp) continue;
      const ms = frameSize.get(m.id) ?? nodeSize(m);
      left = Math.min(left, mp.x - FRAME_MARGIN);
      right = Math.max(right, mp.x + ms.w + FRAME_MARGIN);
      top = Math.min(top, mp.y - FRAME_HEADER);
      bottom = Math.max(bottom, mp.y + ms.h + FRAME_MARGIN);
    }
    absTopLeft.set(f.id, { x: left, y: top });
    frameSize.set(f.id, { w: right - left, h: bottom - top });
  }

  // Unplaced top-level nodes: a column to the right of everything placed.
  let maxX = -Infinity;
  let minY = Infinity;
  for (const [id, p] of absTopLeft) {
    const w = frameSize.get(id)?.w ?? nodeSize(byId.get(id)!).w;
    maxX = Math.max(maxX, p.x + w);
    minY = Math.min(minY, p.y);
  }
  if (!isFinite(maxX)) return null;
  const spareX = maxX + 80;
  let spareY = minY;

  const PAD = 40;
  let shiftX = Infinity;
  let shiftY = Infinity;
  for (const p of absTopLeft.values()) {
    shiftX = Math.min(shiftX, p.x);
    shiftY = Math.min(shiftY, p.y);
  }
  const toFlow = (p: Point): Point => ({ x: p.x * sx - shiftX + PAD, y: p.y * sy - shiftY + PAD });

  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [id, p] of absTopLeft) {
    const n = byId.get(id)!;
    const { w, h } = frameSize.get(id) ?? nodeSize(n);
    boxes.set(id, { x: p.x - shiftX + PAD, y: p.y - shiftY + PAD, w, h });
  }

  const placedNodes = nodes.map((n) => {
    let abs = absTopLeft.get(n.id);
    if (!abs) {
      // Members of a frame keep the position they were given; only loose
      // top-level nodes need somewhere to go.
      if (n.parentId) return n;
      abs = { x: spareX, y: spareY };
      spareY += nodeSize(n).h + 30;
    }
    const size = frameSize.get(n.id);
    const parentAbs = n.parentId ? absTopLeft.get(n.parentId) : undefined;
    // Parent frame not in show_graph: leave the member where it was.
    if (n.parentId && !parentAbs) return n;
    const position = parentAbs
      ? { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y }
      : { x: abs.x - shiftX + PAD, y: abs.y - shiftY + PAD };
    return {
      ...n,
      position,
      ...(size ? { style: { ...n.style, width: size.w, height: size.h } } : {}),
    };
  });
  return { nodes: placedNodes, toFlow, boxes };
}

// Points sampled along each Bézier segment of show_graph's course.
const SAMPLES_PER_SEGMENT = 12;

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** show_graph's course as a polyline: the Bézier chain sampled, then the arrow tip. */
export function sampleCourse(spline: Point[], tip?: Point): Point[] {
  const out: Point[] = [spline[0]];
  for (let i = 0; i + 3 < spline.length; i += 3) {
    for (let k = 1; k <= SAMPLES_PER_SEGMENT; k++) {
      out.push(bezierPoint(spline[i], spline[i + 1], spline[i + 2], spline[i + 3], k / SAMPLES_PER_SEGMENT));
    }
  }
  if (tip) out.push(tip);
  return out;
}

type Box = { x: number; y: number; w: number; h: number };

/** One cubic Bézier piece: its start, two control points and end. */
export type Cubic = [Point, Point, Point, Point];

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** A straight piece from `a` to `b`, as a cubic. */
function linePiece(a: Point, b: Point): Cubic {
  return [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
}

/**
 * show_graph's course as Graphviz draws it: its cubic Bézier pieces, then a
 * straight piece on to the arrow's tip (#416).
 */
export function coursePieces(spline: Point[], tip?: Point): Cubic[] {
  const out: Cubic[] = [];
  for (let i = 0; i + 3 < spline.length; i += 3) out.push([spline[i], spline[i + 1], spline[i + 2], spline[i + 3]]);
  const end = out.length ? out[out.length - 1][3] : undefined;
  if (tip && end && Math.hypot(tip.x - end.x, tip.y - end.y) > 0.01) out.push(linePiece(end, tip));
  return out;
}

/** Split a piece at `t` into the two pieces either side (de Casteljau). */
export function splitCubic([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t);
  const m = lerp(d, e, t);
  return [[p0, a, d, m], [m, e, c, p3]];
}

/**
 * Whether a point is inside the node's drawn outline: the oval (or circle)
 * that fills its box, or the polygon of an octagon or rectangle (#192).
 */
function insideShape(p: Point, b: Box, shape: NodeShape): boolean {
  const rx = b.w / 2, ry = b.h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (p.x - (b.x + rx)) / rx, dy = (p.y - (b.y + ry)) / ry;
  const r = Math.hypot(dx, dy);
  if (r === 0) return true;
  const [nx, ny] = boundaryDir(shape, dx, dy);
  return r <= Math.hypot(nx, ny);
}

// Steps each piece is scanned in for where it crosses an outline, before the
// crossing is found exactly by halving.
const CUT_SCAN = 32;

/**
 * The pieces from where they first leave a node's outline: the piece that
 * crosses it is cut there. A course that starts outside the outline gets a
 * straight lead-in from the outline, on the line from the node's centre.
 * Null when the course never leaves it.
 */
function leaveOutline(pieces: Cubic[], inside: (p: Point) => boolean, center: Point): Cubic[] | null {
  const start = pieces[0][0];
  if (!inside(start)) {
    if (!inside(center)) return pieces;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inside(lerp(center, start, mid))) lo = mid;
      else hi = mid;
    }
    const edge = lerp(center, start, hi);
    return Math.hypot(start.x - edge.x, start.y - edge.y) > 0.01 ? [linePiece(edge, start), ...pieces] : pieces;
  }
  for (let i = 0; i < pieces.length; i++) {
    for (let k = 1; k <= CUT_SCAN; k++) {
      if (inside(bezierPoint(...pieces[i], k / CUT_SCAN))) continue;
      let lo = (k - 1) / CUT_SCAN, hi = k / CUT_SCAN;
      for (let j = 0; j < 30; j++) {
        const mid = (lo + hi) / 2;
        if (inside(bezierPoint(...pieces[i], mid))) lo = mid;
        else hi = mid;
      }
      return [splitCubic(pieces[i], hi)[1], ...pieces.slice(i + 1)];
    }
  }
  return null;
}

const reversed = (pieces: Cubic[]): Cubic[] => pieces.map(([a, b, c, d]): Cubic => [d, c, b, a]).reverse();

/**
 * Cut a course to run from the source's outline to the target's (#416).
 * The pieces are kept exactly, only cut where they cross an outline, so the
 * line drawn is show_graph's own. Enlarged, show_graph's ovals and
 * PsyNeuView's nodes differ: a course that starts short of an outline gets a
 * straight lead-in from it. Null when nothing is left outside both (the nodes
 * overlap, or the course never leaves one).
 */
export function cutToOutlines(
  pieces: Cubic[],
  source: Box,
  target: Box,
  sourceShape: NodeShape = "oval",
  targetShape: NodeShape = "oval",
): Cubic[] | null {
  if (!pieces.length) return null;
  const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const fromSource = leaveOutline(pieces, (p) => insideShape(p, source, sourceShape), center(source));
  if (!fromSource) return null;
  const fromTarget = leaveOutline(reversed(fromSource), (p) => insideShape(p, target, targetShape), center(target));
  return fromTarget ? reversed(fromTarget) : null;
}

/** The pieces as a polyline, `perPiece` points to a piece. */
export function samplePieces(pieces: Cubic[], perPiece = SAMPLES_PER_SEGMENT): Point[] {
  const out: Point[] = pieces.length ? [pieces[0][0]] : [];
  for (const c of pieces) for (let k = 1; k <= perPiece; k++) out.push(bezierPoint(...c, k / perPiece));
  return out;
}

/** The pieces as an SVG path. */
export function piecesPath(pieces: Cubic[]): string {
  if (!pieces.length) return "";
  const n = (v: number) => Math.round(v * 100) / 100;
  const pt = (p: Point) => `${n(p.x)} ${n(p.y)}`;
  return `M ${pt(pieces[0][0])}` + pieces.map(([, c1, c2, e]) => ` C ${pt(c1)} ${pt(c2)} ${pt(e)}`).join("");
}

/** Drop points that add nothing to the shape (Ramer–Douglas–Peucker). */
export function simplify(points: Point[], tolerance = 1.5): Point[] {
  if (points.length <= 2) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let worst = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/**
 * Match show_graph's drawn edges to PsyNeuView's by the nodes they join, in
 * order (several projections between the same pair), and put each course on
 * the canvas.
 */
function edgeCurves(edges: Edge[], placement: ShowGraphPlacement, placed: Placed): Record<string, ShowGraphCurve> {
  const pending = new Map<string, ShowGraphPlacement["edges"]>();
  for (const e of placement.edges) {
    const key = `${e.tail}\u0000${e.head}`;
    (pending.get(key) ?? pending.set(key, []).get(key)!).push(e);
  }
  const curves: Record<string, ShowGraphCurve> = {};
  const byId = new Map(placed.nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const tail = memberAtPort(edge.source, edge.sourceHandle, "OUTPUT_CIM_", byId, placed.nodes);
    const head = memberAtPort(edge.target, edge.targetHandle, "INPUT_CIM_", byId, placed.nodes);
    if (tail === head) continue;
    const queue = pending.get(`${tail}\u0000${head}`);
    const course = queue?.shift();
    const sBox = placed.boxes.get(edge.source);
    const tBox = placed.boxes.get(edge.target);
    const [tailBox, headBox] = [placed.boxes.get(tail), placed.boxes.get(head)];
    if (!course || !sBox || !tBox || !tailBox || !headBox) continue;
    // #416: show_graph's Bézier pieces, drawn exactly. The placement only
    // scales and shifts show_graph's picture, and a scaled Bézier is still a
    // Bézier, so mapping the control points maps the curve.
    const onCanvas = coursePieces(course.spline, course.tip).map((c) => c.map(placed.toFlow) as Cubic);
    const shapeOf = (id: string) => nodeShapeFor(byId.get(id)?.data as ShapedNodeData | undefined);
    const pieces = cutToOutlines(onCanvas, tailBox, headBox, shapeOf(tail), shapeOf(head));
    if (!pieces) continue;
    const inner = [tail, head]
      .filter((id) => id !== edge.source && id !== edge.target)
      .map((id) => ({ id, at: { x: placed.boxes.get(id)!.x, y: placed.boxes.get(id)!.y } }));
    curves[edge.id] = {
      pieces,
      points: samplePieces(pieces),
      source: { x: sBox.x, y: sBox.y },
      target: { x: tBox.x, y: tBox.y },
      ends: [tail, head],
      ...(inner.length ? { inner } : {}),
    };
  }
  return curves;
}

/**
 * The node show_graph draws a projection to or from, for an edge that
 * attaches to an open frame's port (#73). PsyNeuView ends such an edge at the
 * frame, on the port of the composition's interface named for the member it
 * carries to (`INPUT_CIM_<member>_<port>`) or from (`OUTPUT_CIM_<member>_<port>`);
 * show_graph draws it straight to that member. A member that is itself an
 * open frame is followed inward the same way. Any other node is itself.
 */
export function memberAtPort(
  id: string,
  handle: string | null | undefined,
  prefix: "INPUT_CIM_" | "OUTPUT_CIM_",
  byId: Map<string, Node>,
  nodes: Node[],
): string {
  if (byId.get(id)?.type !== "compositionNode" || !handle?.startsWith(prefix)) return id;
  const rest = handle.slice(prefix.length);
  // The longest name that fits, so `a_b` wins over `a` for `a_b_InputPort-0`.
  const member = nodes
    .filter((n) => n.parentId === id && rest.startsWith(`${n.id}_`))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (!member) return id;
  return memberAtPort(member.id, rest.slice(member.id.length + 1), prefix, byId, nodes);
}

/** The point `fraction` of the way along the polyline, by length. */
export function pointAlong(points: Point[], fraction: number): Point {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lens.push(l);
    total += l;
  }
  let want = total * Math.min(1, Math.max(0, fraction));
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? want / lens[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    want -= lens[i];
  }
  return points[0];
}

/**
 * A few editable bends that keep a curve's shape, for when it is grabbed:
 * its main turning points, or its middle if it is nearly straight.
 */
export function curveBends(points: Point[]): Point[] {
  const corners = simplify(points, 8).slice(1, -1);
  if (corners.length === 0) return [pointAlong(points, 0.5)];
  return corners.slice(0, 4);
}
