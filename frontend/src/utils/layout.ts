/**
 * Auto-layout using dagre for directed graph positioning.
 * Computes node positions based on graph topology (top-down flow).
 *
 * rankSep is computed dynamically: the maximum number of edges between
 * any two adjacent ranks determines the minimum vertical gap needed so
 * that edge labels (each ~20px tall) don't overlap.
 */

import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { LayoutStyle } from "@/stores/graphSettingsStore";
import { acyclicEdges } from "./roleRanks";
import { applyShowGraphPlacementWithCurves, knownSize } from "./showGraphLayout";
import { useShowGraphCurves } from "@/stores/showGraphCurvesStore";
import { placeCims } from "./cimPlacement";

interface LayoutOptions {
  direction?: "TB" | "BT" | "LR" | "RL";
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
  // Sizes for INSET composition frames (#427). When present, the frame is
  // added to the parent graph as a single fixed-size node (its children are
  // excluded and laid out independently by layoutInsetInternals).
  insetSizes?: Map<string, { width: number; height: number }>;
}

/** Height of one edge label including padding and buffer. */
const LABEL_SLOT = 24; // px per label (font 10 + padding + gap)

/**
 * Compute the minimum rankSep needed so that edge labels between any
 * two adjacent ranks don't overlap. For N parallel edges we need
 * N * LABEL_SLOT pixels of clear space.
 */
function computeMinRankSep(nodes: Node[], edges: Edge[], baseRankSep: number): number {
  // Quick pre-pass with dagre to get rank assignments
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 50, nodesep: 50 });
  for (const node of nodes) {
    if (node.type !== "compositionNode") {
      g.setNode(node.id, { width: 100, height: 40 });
    }
  }
  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }
  try {
    Dagre.layout(g);
  } catch {
    return baseRankSep;
  }

  // Get rank (Y position bucket) for each node
  const nodeRank: Record<string, number> = {};
  for (const id of g.nodes()) {
    const n = g.node(id);
    if (n) nodeRank[id] = Math.round(n.y / 10); // bucket by ~10px
  }

  // Count edges between each pair of ranks
  const rankPairCounts: Record<string, number> = {};
  for (const edge of edges) {
    const srcRank = nodeRank[edge.source];
    const tgtRank = nodeRank[edge.target];
    if (srcRank !== undefined && tgtRank !== undefined && srcRank !== tgtRank) {
      const key = `${Math.min(srcRank, tgtRank)}_${Math.max(srcRank, tgtRank)}`;
      rankPairCounts[key] = (rankPairCounts[key] || 0) + 1;
    }
  }

  const maxEdges = Math.max(1, ...Object.values(rankPairCounts));
  const needed = maxEdges * LABEL_SLOT + 40; // 40px extra for node padding
  return Math.max(baseRankSep, needed);
}

/** The width the Layered layout assumes for a node it hasn't seen drawn. */
export const LAYERED_NODE_WIDTH = 180;

/**
 * The width to lay a node out at: its drawn width, once it has been drawn,
 * when that is wider than the width assumed for every node. A long name makes
 * a wide box, and spacing it at the assumed width overlaps its neighbours
 * (#72). Narrower boxes keep the assumed width, so their layout is unchanged.
 */
function boxWidth(node: Node, assumed: number): number {
  return Math.max(assumed, knownSize(node).w ?? 0);
}

export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  const {
    direction = "TB",
    nodeWidth = LAYERED_NODE_WIDTH,
    nodeHeight = 60,
    nodeSep = 60,
  } = options;

  // Compute dynamic rankSep based on edge density
  const baseRankSep = options.rankSep ?? 120;
  const rankSep = computeMinRankSep(nodes, edges, baseRankSep);

  const g = new Dagre.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: rankSep,
    nodesep: nodeSep,
  });

  const insetSizes = options.insetSizes;
  const insetFrameIds = new Set(
    nodes
      .filter((n) => n.type === "compositionNode" && (n.data as any)?.inset)
      .map((n) => n.id),
  );

  // Add nodes to dagre graph
  for (const node of nodes) {
    // Children of an INSET frame are laid out independently inside the frame
    // (layoutInsetInternals), so keep them out of the parent graph — the frame
    // stands in as one opaque, fixed-size unit (#427).
    if (node.parentId && insetFrameIds.has(node.parentId)) continue;

    const isGroup = node.type === "compositionNode";
    const isCIM = node.type === "cimNode";
    const insetSize = insetSizes?.get(node.id);
    g.setNode(node.id, {
      width: insetSize ? insetSize.width : isGroup ? 300 : isCIM ? 110 : boxWidth(node, nodeWidth),
      height: insetSize ? insetSize.height : isGroup ? 200 : isCIM ? 30 : nodeHeight,
    });

    // Set parent for nested nodes
    if (node.parentId) {
      g.setParent(node.id, node.parentId);
    }
  }

  // Add edges. #910: scheduler ordering edges (GSC before/after/with) are
  // scheduling metadata, not data flow — feeding them to the layered ranker
  // distorts the data-flow reading (internal nodes float to the top, OUTPUTs
  // land mid-canvas, fighting the role anchoring in #903). Lay out on real data
  // projections only; the scheduler edges still render as an overlay, they just
  // don't get a vote in node placement.
  // #1013: cycle-closing edges don't get a vote either. Role anchoring (#903)
  // pins the ends, but the middle was still being ranked against a graph that
  // has no ranking — six of the ten bundled reference models are recurrent, and
  // Botvinick's four CYCLE nodes produced a staircase with COLOR HIDDEN placed
  // below the RESPONSE it feeds.
  //
  // Dropping the edges that close a cycle leaves a graph acyclic by
  // construction, so depth is defined for every node. Those edges still render;
  // like the scheduler edges above, they simply don't influence placement.
  const rankable = acyclicEdges(
    nodes.filter((n) => g.hasNode(n.id)).map((n) => ({ id: n.id })),
    edges
      .filter((e) => e.type !== "gscEdge")
      .map((e) => ({
        source: e.source,
        target: e.target,
        feedback: Boolean((e.data as { feedback?: boolean } | undefined)?.feedback),
      })),
  );
  // #25: an open (nested) composition is a cluster in Dagre's compound graph,
  // and Dagre can't rank an edge that ends on a cluster with members — it
  // throws, and the caller's fallback stacked the members in one tall column.
  // So for ranking, an edge into an open frame goes to the frame's entry
  // members and an edge out of it leaves from its exit members. The edges
  // still draw to the frame; only the ranking sees them this way.
  const ends = openFrameEnds(nodes.filter((n) => g.hasNode(n.id)), rankable);
  const seen = new Set<string>();
  for (const edge of rankable) {
    for (const source of ends.exits(edge.source)) {
      for (const target of ends.entries(edge.target)) {
        const key = `${source}\u0000${target}`;
        if (source === target || seen.has(key)) continue;
        if (!g.hasNode(source) || !g.hasNode(target)) continue;
        seen.add(key);
        g.setEdge(source, target);
      }
    }
  }

  // #331: role-based rank anchoring. In the model's data flow, INPUT nodes are
  // sources and OUTPUT nodes are sinks, so a plain BT layout usually flows
  // bottom-to-top already (inputs low rank → bottom, outputs high rank → top).
  // But recurrent / feedback / control edges (e.g. an LC control node projecting
  // back into an input) give an input a stray in-edge and let it drift up the
  // canvas. Pin roles to the ends with virtual anchors so the flow reads
  // consistently: every INPUT node is tied one rank above a per-group source
  // anchor (the very bottom), every OUTPUT node one rank below a per-group sink
  // anchor (the very top). Weighted edges make the anchors win against stray
  // edges; anchors are never emitted (the return maps over real `nodes`).
  // Only meaningful for vertical (TB/BT) layouts; grouped by composition level
  // (parentId) so nested compositions anchor within their own frame.
  if (direction === "TB" || direction === "BT") {
    const rolesOf = (n: Node) =>
      ((n.data as { roles?: string[] } | undefined)?.roles) || [];
    const byGroup = new Map<string, Node[]>();
    for (const n of nodes) {
      if (!g.hasNode(n.id)) continue;
      const key = n.parentId ?? "__root__";
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(n);
      else byGroup.set(key, [n]);
    }
    let anchorSeq = 0;
    for (const [groupKey, members] of byGroup) {
      const parent = groupKey === "__root__" ? undefined : groupKey;
      // A SINGLETON node is both INPUT and OUTPUT — leave it to topology rather
      // than anchoring it to both ends at once.
      const inputs = members.filter(
        (n) => rolesOf(n).includes("INPUT") && !rolesOf(n).includes("OUTPUT"),
      );
      const outputs = members.filter(
        (n) => rolesOf(n).includes("OUTPUT") && !rolesOf(n).includes("INPUT"),
      );
      if (inputs.length > 0) {
        const src = `__role_src_${anchorSeq++}`;
        g.setNode(src, { width: 1, height: 1 });
        if (parent) g.setParent(src, parent);
        for (const n of inputs) g.setEdge(src, n.id, { minlen: 1, weight: 3 });
      }
      if (outputs.length > 0) {
        const sink = `__role_sink_${anchorSeq++}`;
        g.setNode(sink, { width: 1, height: 1 });
        if (parent) g.setParent(sink, parent);
        for (const n of outputs) g.setEdge(n.id, sink, { minlen: 1, weight: 3 });
      }
    }
  }

  Dagre.layout(g);

  // Bucket nodes by their dagre-assigned cross-axis position so we can
  // group them into ranks. For TB/BT layouts ranks are horizontal rows
  // distinguished by Y; for LR/RL they're vertical columns distinguished
  // by X. The view-state transform (refs #288) stretches each rank
  // along its layout axis to absorb label-width growth.
  const isVertical = direction === "TB" || direction === "BT";

  // Top-left corners, absolute. An open frame is a cluster: Dagre sizes it to
  // its members, so use that size rather than the default group box (#25).
  const isCluster = (id: string) => (g.children(id) as string[] | undefined)?.length ?? 0;
  const topLeft = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const d = g.node(node.id);
    if (!d) continue;
    const isGroup = node.type === "compositionNode";
    const insetSize = insetSizes?.get(node.id);
    const w = isCluster(node.id) ? d.width : insetSize ? insetSize.width : isGroup ? 300 : boxWidth(node, nodeWidth);
    const h = isCluster(node.id) ? d.height : insetSize ? insetSize.height : isGroup ? 200 : nodeHeight;
    topLeft.set(node.id, { x: d.x - w / 2, y: d.y - h / 2 });
  }

  // Apply computed positions back to nodes
  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;

    const rankCoord = isVertical ? dagreNode.y : dagreNode.x;
    const layoutRank = Math.round(rankCoord / 10);

    return {
      ...node,
      data: {
        ...(node.data as object),
        layoutRank,
      },
      // A member of an open frame is positioned relative to it, as React
      // Flow expects (#25): Dagre gives absolute positions for both.
      position: (() => {
        const abs = topLeft.get(node.id)!;
        const parent = node.parentId ? topLeft.get(node.parentId) : undefined;
        return parent ? { x: abs.x - parent.x, y: abs.y - parent.y + OPEN_FRAME_HEADER } : abs;
      })(),
    };
  });
}

// Room at the top of an open frame for its label (#25).
const OPEN_FRAME_HEADER = 30;

/**
 * Where edges enter and leave each open frame (a composition shown with its
 * members), for ranking (#25). Entry members are the frame's INPUT nodes, or
 * if none, those with nothing feeding them inside the frame; exit members
 * likewise with OUTPUT. A member that is itself an open frame is resolved the
 * same way, so nesting goes all the way down. Any other node is its own
 * entry and exit.
 */
export function openFrameEnds(
  nodes: Node[],
  edges: { source: string; target: string }[],
): { entries: (id: string) => string[]; exits: (id: string) => string[] } {
  const members = new Map<string, Node[]>();
  for (const n of nodes) {
    if (n.parentId) (members.get(n.parentId) ?? members.set(n.parentId, []).get(n.parentId)!).push(n);
  }
  const rolesOf = (n: Node) => ((n.data as { roles?: string[] } | undefined)?.roles) || [];
  const pick = (frame: string, role: "INPUT" | "OUTPUT"): Node[] => {
    const inside = members.get(frame)!;
    const ids = new Set(inside.map((m) => m.id));
    const byRole = inside.filter((m) => rolesOf(m).includes(role));
    if (byRole.length) return byRole;
    const internal = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const free = inside.filter((m) =>
      role === "INPUT"
        ? !internal.some((e) => e.target === m.id)
        : !internal.some((e) => e.source === m.id),
    );
    return free.length ? free : inside;
  };
  const resolve = (id: string, role: "INPUT" | "OUTPUT", depth = 0): string[] => {
    if (!members.has(id) || depth > 20) return [id];
    return pick(id, role).flatMap((m) => resolve(m.id, role, depth + 1));
  };
  return {
    entries: (id) => resolve(id, "INPUT"),
    exits: (id) => resolve(id, "OUTPUT"),
  };
}

// --- Alternative engines (#415) ------------------------------------------
//
// `applyDagreLayout` is the layered/sugiyama engine (the toolbar's TB/BT/LR/RL
// are orientations of it). These add genuinely different strategies. They
// only reposition *top-level* nodes (no parentId): React Flow keeps child
// positions relative to their parent group, so children ride along when the
// group moves and each composition keeps its internal layout. Unlike Dagre
// they don't stamp `data.layoutRank`, so the rank-stretch view transform
// (#288) becomes a no-op — correct, since rank stretching is a layered idea.

function nodeSize(node: Node): { w: number; h: number } {
  if (node.type === "compositionNode") {
    // A frame's real size when it has one (an inset frame is sized to its
    // members before Radial and Force run); else the default group box (#35).
    const w = node.style?.width, h = node.style?.height;
    return typeof w === "number" && typeof h === "number" ? { w, h } : { w: 300, h: 200 };
  }
  if (node.type === "cimNode") return { w: 110, h: 30 };
  return { w: 180, h: 60 };
}

// Apply center positions to top-level nodes, normalized so the bounding box
// starts at a small padding. Children (parented) are left untouched.
function repositionTopLevel(
  nodes: Node[],
  centers: Map<string, { x: number; y: number }>,
): Node[] {
  const PAD = 40;
  const topLeft = new Map<string, { x: number; y: number }>();
  let minX = Infinity;
  let minY = Infinity;
  for (const node of nodes) {
    const c = centers.get(node.id);
    if (!c) continue;
    const { w, h } = nodeSize(node);
    const x = c.x - w / 2;
    const y = c.y - h / 2;
    topLeft.set(node.id, { x, y });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  if (!isFinite(minX)) return nodes;
  return nodes.map((node) => {
    const p = topLeft.get(node.id);
    if (!p) return node;
    return { ...node, position: { x: p.x - minX + PAD, y: p.y - minY + PAD } };
  });
}

// Radial / tree: rank top-level nodes by BFS distance from the source nodes
// (no incoming edges) and place each rank on a concentric ring. Good for
// clearly hierarchical pipelines.
/**
 * The edges between top-level nodes that Radial and Force arrange (#35). A
 * frame's members keep their places inside it, so an edge to or from a member
 * counts as one to or from its outermost frame. Without this a frame whose
 * edges all end on its members looked unconnected: Force pushed it away with
 * nothing pulling it back (EGO flattened: thousands of pixels off, beyond the
 * furthest zoom), and Radial left it on the outer ring.
 */
export function topLevelEdges(nodes: Node[], edges: Edge[]): { source: string; target: string }[] {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const top = (id: string) => {
    let cur = id;
    for (let i = 0; i < 50 && parentOf.get(cur); i++) cur = parentOf.get(cur)!;
    return cur;
  };
  const seen = new Set<string>();
  const out: { source: string; target: string }[] = [];
  for (const e of edges) {
    if (!parentOf.has(e.source) || !parentOf.has(e.target)) continue;
    const source = top(e.source);
    const target = top(e.target);
    const key = `${source}\u0000${target}`;
    if (source === target || seen.has(key)) continue;
    seen.add(key);
    out.push({ source, target });
  }
  return out;
}

export function applyRadialLayout(nodes: Node[], edges: Edge[]): Node[] {
  const top = nodes.filter((n) => !n.parentId);
  if (top.length === 0) return nodes;
  const ids = new Set(top.map((n) => n.id));

  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of top) {
    adj.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of topLevelEdges(nodes, edges)) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  let roots = top.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  if (roots.length === 0) roots = [top[0].id];

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r, 0);
    queue.push(r);
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const nb of adj.get(cur) ?? []) {
      if (!depth.has(nb)) {
        depth.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  // Disconnected nodes land on the outermost ring.
  let maxDepth = 0;
  depth.forEach((d) => (maxDepth = Math.max(maxDepth, d)));
  for (const n of top) if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);

  const rings = new Map<number, string[]>();
  for (const n of top) {
    const d = depth.get(n.id)!;
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d)!.push(n.id);
  }

  const RING_GAP = 280;
  const centers = new Map<string, { x: number; y: number }>();
  for (const [d, members] of rings) {
    if (d === 0 && members.length === 1) {
      centers.set(members[0], { x: 0, y: 0 });
      continue;
    }
    const radius = d === 0 ? 160 : d * RING_GAP;
    members.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / members.length - Math.PI / 2;
      centers.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
  }
  return repositionTopLevel(nodes, centers);
}

// Force-directed (Fruchterman–Reingold): repel all top-level nodes, attract
// along edges, cool over a fixed iteration budget. Seeded from current
// positions for run-to-run stability. Good for exploring unfamiliar models.
export function applyForceLayout(nodes: Node[], edges: Edge[]): Node[] {
  const top = nodes.filter((n) => !n.parentId);
  const n = top.length;
  if (n === 0) return nodes;
  const ids = new Set(top.map((t) => t.id));

  const pos = new Map<string, { x: number; y: number }>();
  top.forEach((node, i) => {
    const { w, h } = nodeSize(node);
    const seedX = node.position ? node.position.x + w / 2 : Math.cos((2 * Math.PI * i) / n) * 240;
    const seedY = node.position ? node.position.y + h / 2 : Math.sin((2 * Math.PI * i) / n) * 240;
    pos.set(node.id, { x: seedX, y: seedY });
  });

  const eList = topLevelEdges(nodes, edges).filter((e) => ids.has(e.source) && ids.has(e.target));
  const k = Math.sqrt((900 * 900) / n); // ideal edge length
  let temp = 320;
  const ITERS = 250;

  for (let it = 0; it < ITERS; it++) {
    const disp = new Map<string, { x: number; y: number }>();
    for (const t of top) disp.set(t.id, { x: 0, y: 0 });

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = top[i].id;
        const b = top[j].id;
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const rep = (k * k) / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        const da = disp.get(a)!;
        const db = disp.get(b)!;
        da.x += ux * rep;
        da.y += uy * rep;
        db.x -= ux * rep;
        db.y -= uy * rep;
      }
    }

    for (const e of eList) {
      const pa = pos.get(e.source)!;
      const pb = pos.get(e.target)!;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const att = (dist * dist) / k;
      const ux = dx / dist;
      const uy = dy / dist;
      const ds = disp.get(e.source)!;
      const dt = disp.get(e.target)!;
      ds.x -= ux * att;
      ds.y -= uy * att;
      dt.x += ux * att;
      dt.y += uy * att;
    }

    for (const t of top) {
      const d = disp.get(t.id)!;
      const dl = Math.hypot(d.x, d.y) || 0.01;
      const p = pos.get(t.id)!;
      p.x += (d.x / dl) * Math.min(dl, temp);
      p.y += (d.y / dl) * Math.min(dl, temp);
    }
    temp *= 0.96;
  }
  separateBoxes(top, pos);
  return repositionTopLevel(nodes, pos);
}

/**
 * Push overlapping top-level boxes apart (#35). Force treats nodes as points,
 * so a node could land on top of a big frame (EGO flattened: STATE and
 * PREDICTION inside EM's box). Each overlapping pair is separated along the
 * axis that needs the smaller move, and the smaller box moves, so a frame stays
 * where the simulation put it.
 */
function separateBoxes(top: Node[], centers: Map<string, { x: number; y: number }>) {
  const GAP = 30;
  const size = new Map(top.map((n) => [n.id, nodeSize(n)]));
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const [a, b] = [top[i].id, top[j].id];
        const pa = centers.get(a)!, pb = centers.get(b)!;
        const sa = size.get(a)!, sb = size.get(b)!;
        const ox = (sa.w + sb.w) / 2 + GAP - Math.abs(pa.x - pb.x);
        const oy = (sa.h + sb.h) / 2 + GAP - Math.abs(pa.y - pb.y);
        if (ox <= 0 || oy <= 0) continue;
        const mover = sa.w * sa.h <= sb.w * sb.h ? pa : pb;
        const other = mover === pa ? pb : pa;
        if (ox < oy) mover.x += (mover.x >= other.x ? 1 : -1) * ox;
        else mover.y += (mover.y >= other.y ? 1 : -1) * oy;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

// --- INSET nested-composition mode (#427) --------------------------------
//
// An INSET composition shows its internals (like NESTED) but lays them out as
// an *independent* mini-graph and is treated as a single opaque unit by the
// parent layout (matching PsyNeuLink show_graph's INSET mode). This helper
// runs the independent sub-layout: for each inset frame it lays out the direct
// children with their own Dagre pass, writes back positions relative to the
// frame (offset for the header), and returns each frame's resulting size so
// the parent pass can reserve space for it as one node.
//
// Cross-boundary projections already reference the composition (frame) id —
// the backend resolves CIM endpoints to the owning composition — so boundary
// edges attach to the frame with no rerouting here.
const INSET_HEADER = 40; // px reserved at the top of the frame for its label
const INSET_PAD = 20; // px padding around the inset sub-graph

export function layoutInsetInternals(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutOptions["direction"] = "TB",
): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>();
  const frames = nodes.filter(
    (n) => n.type === "compositionNode" && (n.data as any)?.inset,
  );

  // #718: process the deepest frames first so a frame's nested-frame children
  // are already laid out and sized when we lay the frame out — giving true
  // box-in-box containment for multi-level nesting.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthOf = (n: Node): number => {
    let d = 0;
    let cur: Node | undefined = n;
    while (cur?.parentId) {
      d++;
      cur = byId.get(cur.parentId);
    }
    return d;
  };
  const ordered = [...frames].sort((a, b) => depthOf(b) - depthOf(a));

  for (const frame of ordered) {
    const children = nodes.filter((n) => n.parentId === frame.id);
    if (children.length === 0) continue;
    const childIds = new Set(children.map((c) => c.id));
    const internalEdges = edges.filter(
      (e) => childIds.has(e.source) && childIds.has(e.target),
    );

    // Lay out a detached copy (parentId stripped so Dagre doesn't treat the
    // absent frame as a compound cluster). Pass the sizes computed so far so a
    // nested-frame child lays out at its real, content-fitted footprint rather
    // than the default group box.
    const detached = children.map((c) => ({ ...c, parentId: undefined }));
    const laid = applyDagreLayout(detached, internalEdges, { direction, insetSizes: sizes });
    const posById = new Map(laid.map((c) => [c.id, c.position]));

    let minX = Infinity, minY = Infinity;
    for (const p of posById.values()) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
    }
    if (!isFinite(minX)) continue;

    let maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      const p = posById.get(child.id);
      if (!p) continue;
      const rx = p.x - minX + INSET_PAD;
      const ry = p.y - minY + INSET_HEADER;
      child.position = { x: rx, y: ry };
      // A nested frame's footprint is the size computed in an earlier (deeper)
      // iteration; otherwise the node's own width/height.
      const childSize = sizes.get(child.id);
      const w = childSize?.width ?? (child.style?.width as number) ?? boxWidth(child, 180);
      const h = childSize?.height ?? (child.style?.height as number) ?? 60;
      if (rx + w > maxX) maxX = rx + w;
      if (ry + h > maxY) maxY = ry + h;
    }
    const width = maxX + INSET_PAD;
    const height = maxY + INSET_PAD;
    sizes.set(frame.id, { width, height });
    // Set the frame's rendered size now so its parent's sub-layout + autoSize
    // pass see the real footprint (box-in-box).
    frame.style = { ...frame.style, width, height };
  }
  return sizes;
}

// Dispatch to the engine for `style` (#415). Dagre is the default/fallback.
// CIMs aren't laid out: they are placed on top of the layout, against a
// composition frame (cimPlacement.ts), so lay out the rest and put them back.
// Otherwise a layout run over the drawn graph moves them (#72).
export function applyLayout(
  style: LayoutStyle,
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): Node[] {
  const cims = new Set(nodes.filter((n) => n.type === "cimNode").map((n) => n.id));
  if (cims.size === 0) return layOut(style, nodes, edges, options);
  const laid = layOut(
    style,
    nodes.filter((n) => !cims.has(n.id)),
    edges.filter((e) => !cims.has(e.source) && !cims.has(e.target)),
    options,
  );
  return placeCims([...laid, ...nodes.filter((n) => cims.has(n.id))]);
}

function layOut(
  style: LayoutStyle,
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
): Node[] {
  // Independent sub-layout for any INSET frames first (#427); the returned
  // sizes let the parent pass treat each inset as one opaque node. This
  // mutates inset children to frame-relative positions, which the engines
  // below leave untouched (they only reposition top-level nodes).
  const insetSizes = layoutInsetInternals(nodes, edges, options.direction);

  // show_graph's edge courses (#23) belong to its layout alone.
  if (style !== "showgraph") useShowGraphCurves.getState().clear();

  switch (style) {
    case "radial":
      return applyRadialLayout(nodes, edges);
    case "force":
      return applyForceLayout(nodes, edges);
    case "showgraph": {
      // #19: positions come from show_graph's own layout, computed
      // asynchronously (useShowGraphLayout). Until it arrives, or if it was
      // computed for a different graph, the Layered layout stands in. #23:
      // edges then follow show_graph's own courses.
      const placed = applyShowGraphPlacementWithCurves(nodes, edges);
      if (placed) {
        useShowGraphCurves.getState().setCurves(placed.curves);
        return placed.nodes;
      }
      useShowGraphCurves.getState().clear();
      return applyDagreLayout(nodes, edges, { ...options, direction: "BT", insetSizes });
    }
    case "layered":
    default:
      return applyDagreLayout(nodes, edges, { ...options, insetSizes });
  }
}
