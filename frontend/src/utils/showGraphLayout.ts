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
 * PsyNeuView's boxes are bigger than show_graph's ovals, so show_graph's picture
 * is enlarged, evenly, just enough that every box fits where its oval was. The
 * arrangement is unchanged: nothing is re-laid-out, so the order within a row
 * can't drift from show_graph's.
 *
 * Fetching and laying out are asynchronous, while the layout engines in
 * layout.ts are synchronous. So the work is split: `computeShowGraphPlacement`
 * does the asynchronous part and stores the result, and
 * `applyShowGraphPlacement` (called from `applyLayout`) reads it. Until a
 * placement for the current graph exists, the Layered layout stands in.
 */

import type { Node } from "@xyflow/react";

// Never shrink show_graph's picture, and cap the enlargement so one node with
// a very short name (a narrow oval) doesn't spread the whole graph out.
const MIN_SCALE = 1;
const MAX_SCALE = 3;

const DEFAULT_SIZE = { w: 180, h: 60 };

export interface ShowGraphPlacement {
  /** Which graph and options this was computed for (see `placementKey`). */
  signature: string;
  /** show_graph's node centers and sizes, in points, y growing downward. */
  nodes: Map<string, { x: number; y: number; w: number; h: number }>;
  /** show_graph's cluster boxes (top-left + size), keyed by composition name. */
  clusters: Map<string, { x: number; y: number; w: number; h: number }>;
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

export function nodeSize(n: Node): { w: number; h: number } {
  const w = n.measured?.width ?? (n.style?.width as number | undefined) ?? n.width;
  const h = n.measured?.height ?? (n.style?.height as number | undefined) ?? n.height;
  if (w !== undefined && h !== undefined) return { w, h };
  const drawn = drawnSize(n.id);
  return { w: w ?? drawn?.w ?? DEFAULT_SIZE.w, h: h ?? drawn?.h ?? DEFAULT_SIZE.h };
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
interface GvJson {
  bb: string;
  objects?: GvObject[];
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
  return { signature, nodes, clusters };
}

/** Identifies a layout: the graph's nodes and the show_graph options used. */
export function placementKey(nodes: Node[], req: ShowGraphRequest): string {
  return `${graphSignature(nodes)}#${req.compositionName}#${JSON.stringify(req.options)}`;
}

export interface ShowGraphRequest {
  filePath: string;
  compositionName: string;
  options: Record<string, boolean | string>;
}

async function fetchDot(req: ShowGraphRequest): Promise<string> {
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
  return ((await resp.json()) as { dot: string }).dot;
}

/** How many of PsyNeuView's nodes show_graph drew. */
function matchedCount(nodes: Node[], placement: ShowGraphPlacement): number {
  return nodes.filter((n) => n.type === "mechanismNode" && placement.nodes.has(n.id)).length;
}

// The layout menu and the background watcher (useShowGraphLayout) can ask for
// the same layout at the same moment; they share one fetch.
const inFlight = new Map<string, Promise<ShowGraphPlacement>>();

/** Fetch show_graph's description, lay it out, and store the result. */
export function computeShowGraphPlacement(
  req: ShowGraphRequest,
  nodes: Node[],
): Promise<ShowGraphPlacement> {
  const key = placementKey(nodes, req);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = computeOnce(req, nodes, key).finally(() => inFlight.delete(key));
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
  const layOut = async (r: ShowGraphRequest) =>
    placementFromGraphviz(JSON.parse(gv.layout(await fetchDot(r), "json", "dot")) as GvJson, key);

  let placement = await layOut(req);
  // PsyNeuView draws some models' learning parts (a TARGET, a prediction
  // error, the learning mechanism) as ordinary nodes, which show_graph hides
  // unless asked. If show_graph missed nodes, ask again with learning shown
  // and keep whichever drew more of them.
  const mechs = nodes.filter((n) => n.type === "mechanismNode").length;
  if (matchedCount(nodes, placement) < mechs && !req.options.show_learning) {
    try {
      const withLearning = await layOut({ ...req, options: { ...req.options, show_learning: true } });
      if (matchedCount(nodes, withLearning) > matchedCount(nodes, placement)) placement = withLearning;
    } catch {
      // Keep the first layout.
    }
  }
  current = placement;
  return placement;
}

// Clear space kept between neighbouring boxes once enlarged: across a row,
// and between rows (where the arrows and their labels run).
const GAP_X = 40;
const GAP_Y = 70;

/**
 * How much show_graph's picture must grow so that PsyNeuView's boxes, which
 * are bigger than show_graph's ovals, don't touch: enough for each pair of
 * neighbours in a row, and for each pair of neighbouring rows. Both
 * directions grow by the same amount, keeping show_graph's proportions.
 */
export function scaleFor(
  nodes: Node[],
  placement: ShowGraphPlacement,
): { sx: number; sy: number } {
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
  let scale = MIN_SCALE;
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const [a, b] = [row[i - 1], row[i]];
      const dx = b.x - a.x;
      if (dx > 0) scale = Math.max(scale, ((a.w + b.w) / 2 + GAP_X) / dx);
    }
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    const tallest = (y: number) => Math.max(...rows.get(y)!.map((p) => p.h));
    const dy = ys[i] - ys[i - 1];
    if (dy > 0) scale = Math.max(scale, ((tallest(ys[i]) + tallest(ys[i - 1])) / 2 + GAP_Y) / dy);
  }
  scale = Math.min(scale, MAX_SCALE);
  return { sx: scale, sy: scale };
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
  if (!placement) return null;
  const mechs = nodes.filter((n) => n.type === "mechanismNode");
  const matched = mechs.filter((n) => placement.nodes.has(n.id));
  // Computed for some other graph (a different model, or before a reload).
  if (mechs.length === 0 || matched.length < mechs.length / 2) return null;

  const { sx, sy } = scaleFor(nodes, placement);
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

  return nodes.map((n) => {
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
}
