/**
 * Pure geometry + lane-clustering math for projection edges.
 *
 * Extracted from ProjectionEdge.tsx (#967) so it can be unit-tested without a
 * DOM or React Flow: every function here takes plain data (node ovals, edge
 * lists, a `nodeLookup` Map of plain node records) and returns numbers/offsets.
 * The React component consumes these to place attachment points and lateral
 * bows; the geometry itself has no runtime dependencies.
 */

// #902 (DOF c): geometry-aware port attachment. `ovalOf` extracts a node's
// ellipse (center + semi-axes); `ovalBoundaryPoint` returns the point on that
// ellipse in the direction of a target point — so an edge attaches where it
// *faces* its counterpart and the attachment slides continuously around the
// oval, instead of every edge leaving from one fixed handle side.
export interface Oval { cx: number; cy: number; a: number; b: number }
export function ovalOf(n: { internals?: { positionAbsolute?: { x: number; y: number } }; position?: { x: number; y: number }; measured?: { width?: number; height?: number } } | undefined): Oval | null {
  const pos = n?.internals?.positionAbsolute ?? n?.position;
  if (!pos) return null;
  const w = n?.measured?.width ?? 150;
  const h = n?.measured?.height ?? 60;
  return { cx: pos.x + w / 2, cy: pos.y + h / 2, a: w / 2, b: h / 2 };
}
export function ovalBoundaryPoint(o: Oval, towardX: number, towardY: number): { x: number; y: number } {
  const dx = towardX - o.cx, dy = towardY - o.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const t = 1 / Math.sqrt((ux / o.a) ** 2 + (uy / o.b) ** 2); // ray/ellipse hit
  return { x: o.cx + ux * t, y: o.cy + uy * t };
}

// #282: exact point on the oval at a given ellipse-parameter angle — used when
// a port has a manual (dragged) placement override, which takes precedence
// over the auto facing-the-target attachment above.
export function ellipsePoint(o: Oval, angle: number): { x: number; y: number } {
  return { x: o.cx + o.a * Math.cos(angle), y: o.cy + o.b * Math.sin(angle) };
}

// Lever 2 (fan-out bundling): minimum angular separation (radians) kept between
// the attachment directions of edges that share a hub, so a fan doesn't collapse
// onto one oval point. Each member still routes through the obstacle router, so
// the de-crowded launch points carve genuinely distinct, node-avoiding corridors.
export const FAN_MIN_GAP_RAD = (24 * Math.PI) / 180;

// Given a hub oval and the ovals of the counterpart nodes of every edge sharing
// that hub, return the attachment *direction* (radians from the hub center) for
// the edge identified by `myId`. Each edge would naturally attach toward its own
// counterpart; when several counterparts sit in nearly the same direction those
// attachments overlap, so we de-crowd: sort by natural direction, push each at
// least `minGap` past the previous, then re-center on the bundle's mean so the
// fan keeps its overall aim. Returns null if the edge isn't part of a real
// multi-edge bundle. Order-preserving, so no two edges swap sides.
export function hubFanDirection(
  myId: string,
  hub: Oval,
  members: { id: string; other: Oval }[],
  minGap: number,
): number | null {
  if (members.length < 2) return null;
  const items = members
    .map((m) => ({ id: m.id, angle: Math.atan2(m.other.cy - hub.cy, m.other.cx - hub.cx) }))
    .sort((p, q) => p.angle - q.angle);
  // Greedy de-crowd, preserving order.
  const spread: { id: string; angle: number }[] = [];
  let prev = -Infinity;
  for (const it of items) {
    const a = it.angle < prev + minGap ? prev + minGap : it.angle;
    spread.push({ id: it.id, angle: a });
    prev = a;
  }
  // Re-center: shift the whole fan so its mean matches the natural mean aim.
  const meanNatural = items.reduce((s, i) => s + i.angle, 0) / items.length;
  const meanSpread = spread.reduce((s, i) => s + i.angle, 0) / spread.length;
  const shift = meanNatural - meanSpread;
  const mine = spread.find((s) => s.id === myId);
  return mine ? mine.angle + shift : null;
}

// Attachment point on `hub` for `edgeId`, spread within the fan of edges sharing
// (node, handle) at this hub. `side` picks which end each candidate edge is
// keyed on. Returns null when there's no fan or geometry isn't ready.
export function fanAttachPoint(
  edgeId: string,
  hub: Oval,
  hubNode: string,
  hubHandle: string | null | undefined,
  side: "source" | "target",
  edges: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[],
  nodeLookup: Map<string, unknown>,
): { x: number; y: number } | null {
  const h = hubHandle ?? null;
  const members: { id: string; other: Oval }[] = [];
  for (const e of edges) {
    const node = side === "source" ? e.source : e.target;
    const handle = side === "source" ? (e.sourceHandle ?? null) : (e.targetHandle ?? null);
    if (node !== hubNode || handle !== h) continue;
    const otherId = side === "source" ? e.target : e.source;
    const other = ovalOf(nodeLookup.get(otherId) as any);
    if (other) members.push({ id: e.id, other });
  }
  const dir = hubFanDirection(edgeId, hub, members, FAN_MIN_GAP_RAD);
  if (dir == null) return null;
  return ovalBoundaryPoint(hub, hub.cx + Math.cos(dir), hub.cy + Math.sin(dir));
}

// #944: gap (px) between adjacent lanes of near-parallel edges.
export const LANE_GAP_PX = 16;
// Edges sharing a hub whose aims are within this angle are "near-parallel" and
// share a lane group.
export const LANE_ANGLE_THRESHOLD_RAD = (20 * Math.PI) / 180;

// This edge's index/size within the near-parallel cluster of edges sharing a
// hub node (source or target), or {index:0,size:1} if it has no near-parallel
// sibling. Single-linkage over aim angle. Same shape as the reverted 1b lane
// grouping, but now feeds a node-safe lateral bow (#944) instead of a raw bow.
export function clusterLane(
  edgeId: string,
  hubNode: string,
  hubHandle: string | null | undefined,
  side: "source" | "target",
  edges: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[],
  nodeLookup: Map<string, unknown>,
  angleThresh: number = LANE_ANGLE_THRESHOLD_RAD,
): { index: number; size: number } {
  const hub = ovalOf(nodeLookup.get(hubNode) as any);
  if (!hub) return { index: 0, size: 1 };
  const h = hubHandle ?? null;
  const members: { id: string; angle: number }[] = [];
  for (const e of edges) {
    const node = side === "source" ? e.source : e.target;
    const handle = side === "source" ? (e.sourceHandle ?? null) : (e.targetHandle ?? null);
    if (node !== hubNode || handle !== h) continue;
    const other = ovalOf(nodeLookup.get(side === "source" ? e.target : e.source) as any);
    if (other) members.push({ id: e.id, angle: Math.atan2(other.cy - hub.cy, other.cx - hub.cx) });
  }
  if (members.length < 2) return { index: 0, size: 1 };
  members.sort((a, b) => a.angle - b.angle);
  let start = 0;
  for (let i = 1; i <= members.length; i++) {
    const broke = i === members.length
      || members[i].angle - members[i - 1].angle > angleThresh;
    if (!broke) continue;
    const size = i - start;
    if (size > 1) {
      const idx = members.slice(start, i).findIndex((m) => m.id === edgeId);
      if (idx >= 0) return { index: idx, size };
    }
    start = i;
  }
  return { index: 0, size: 1 };
}

// #941: two edges sharing NO endpoint can still run tangent (independent
// crossing). Group edges whose node-center segments are near-parallel AND close,
// so the same node-safe bow separates them. Node-center segments (not the
// floating attachments) keep the grouping stable across re-renders.
export const PROX_ANGLE_RAD = (18 * Math.PI) / 180;
export const PROX_CLOSE_PX = 44;

// #941 follow-up: edges sharing a hub whose aims are within this TIGHT angle are
// near-collinear — they overlap along their whole length even though their far
// endpoints (and midpoints) are far apart, so midpoint-proximity misses them.
// A hub spread alone can't separate a ~400px collinear run; these also need a
// lateral bow. Tighter than LANE_ANGLE_THRESHOLD_RAD so genuinely divergent
// fan-outs (STATE→PREV, STATE→EM, ~30-45° apart) get a hub spread but NO bow.
export const BOW_ANGLE_RAD = (12 * Math.PI) / 180;

export function centerSeg(
  source: string, target: string, nodeLookup: Map<string, unknown>,
): { mx: number; my: number; dir: number } | null {
  const s = ovalOf(nodeLookup.get(source) as any);
  const t = ovalOf(nodeLookup.get(target) as any);
  if (!s || !t) return null;
  return { mx: (s.cx + t.cx) / 2, my: (s.cy + t.cy) / 2, dir: Math.atan2(t.cy - s.cy, t.cx - s.cx) };
}

export function proximityLane(
  edgeId: string, source: string, target: string,
  edges: { id: string; source: string; target: string }[],
  nodeLookup: Map<string, unknown>,
): { index: number; size: number } {
  const mine = centerSeg(source, target, nodeLookup);
  if (!mine) return { index: 0, size: 1 };
  const members: string[] = [];
  for (const e of edges) {
    const g = centerSeg(e.source, e.target, nodeLookup);
    if (!g) continue;
    let dd = Math.abs(g.dir - mine.dir);
    if (dd > Math.PI) dd = 2 * Math.PI - dd;
    // Same-direction only: anti-parallel edges have opposite perpendiculars, so
    // opposite lane offsets would bow them the SAME way in world space (they
    // wouldn't separate) — leave those for a later increment.
    if (dd > PROX_ANGLE_RAD) continue;
    if (Math.hypot(g.mx - mine.mx, g.my - mine.my) > PROX_CLOSE_PX) continue;
    members.push(e.id);
  }
  if (members.length < 2) return { index: 0, size: 1 };
  members.sort();
  return { index: members.indexOf(edgeId), size: members.length };
}

// #965: two decoupled separations, by their actual geometry:
//  - hubOffset/hub — launch separation for edges sharing a source/target hub
//    (spread their attachment points; fan-outs then diverge to their targets).
//  - bowOffset — lateral bow for edges that genuinely run CLOSE along their
//    length (proximity), independent of any shared hub — the only case that
//    needs a mid-length bend. A divergent fan-out gets a hub spread but no bow
//    (no spurious kink); a parallel pair gets both.
export function laneOffsetFor(
  edgeId: string,
  source: string, sourceHandle: string | null | undefined,
  target: string, targetHandle: string | null | undefined,
  edges: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[],
  nodeLookup: Map<string, unknown>,
  laneGap: number = LANE_GAP_PX,
): { hubOffset: number; hub: "source" | "target" | null; bowOffset: number } {
  const centered = (l: { index: number; size: number }) => (l.index - (l.size - 1) / 2) * laneGap;
  let hubOffset = 0;
  let hub: "source" | "target" | null = null;
  const bySource = clusterLane(edgeId, source, sourceHandle, "source", edges, nodeLookup);
  const byTarget = clusterLane(edgeId, target, targetHandle, "target", edges, nodeLookup);
  if (bySource.size > 1) { hubOffset = centered(bySource); hub = "source"; }
  else if (byTarget.size > 1) { hubOffset = centered(byTarget); hub = "target"; }

  // Bow selection, in priority order:
  //  1. Near-collinear shared-hub siblings (tight aim). Their launch points are
  //     already spread by the hub offset, but over a long collinear run that
  //     spread is negligible and they re-converge / touch mid-length. Bow them
  //     using the SAME hub's tight cluster so the bow index order matches the
  //     hub-spread order — launch and mid-bend go the same lateral way, so the
  //     pair DIVERGES (never crosses, never shares a tangent point/waypoint).
  //  2. Otherwise, independent edges running tangent get a proximity bow (#941).
  let bowOffset = 0;
  if (hub) {
    const tight = hub === "source"
      ? clusterLane(edgeId, source, sourceHandle, "source", edges, nodeLookup, BOW_ANGLE_RAD)
      : clusterLane(edgeId, target, targetHandle, "target", edges, nodeLookup, BOW_ANGLE_RAD);
    if (tight.size > 1) bowOffset = centered(tight);
  }
  if (!bowOffset) {
    const byProx = proximityLane(edgeId, source, target, edges, nodeLookup);
    if (byProx.size > 1) bowOffset = centered(byProx);
  }
  return { hubOffset, hub, bowOffset };
}

// #946: attachment point on `hub` facing (towardX,towardY), shifted along the
// oval boundary by ~arcPx (signed) so lane-mates land at distinct points on the
// node instead of converging. Stays on the oval (rotates the facing direction
// by arc/radius), keeping the connection dots on the boundary.
export function offsetAttach(hub: Oval, towardX: number, towardY: number, arcPx: number): { x: number; y: number } {
  const base = ovalBoundaryPoint(hub, towardX, towardY);
  if (!arcPx) return base;
  const theta = Math.atan2(towardY - hub.cy, towardX - hub.cx);
  const r = Math.hypot(base.x - hub.cx, base.y - hub.cy) || 1;
  const th = theta + arcPx / r;
  return ovalBoundaryPoint(hub, hub.cx + Math.cos(th), hub.cy + Math.sin(th));
}
