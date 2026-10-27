/**
 * Custom React Flow edge for projections.
 *
 * Labels are staggered along the edge path to avoid overlap. Visibility
 * is toggleable: always-on (default) or hover-only for dense graphs.
 * Label Y offset is set via edge.data.labelOffset (0-1).
 *
 * Direction arrows render as a small chevron at the midpoint of the
 * path (toggle: graphSettings.showArrowheads). When an edge label is
 * visible alongside the arrow, the chevron shifts off the label by an
 * amount scaled to the actual path length and estimated label width —
 * so wide labels on short edges still clear the chevron. See #285.
 */

import { useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  useStore,
  useReactFlow,
  ViewportPortal,
  type EdgeProps,
} from "@xyflow/react";
import { routeAroundObstacles, renderStyledPathSafe, routeWaypoints, expandedCorners, type Rect } from "@/utils/edgeRouter";
import { useShowGraphCurves, curveFits } from "@/stores/showGraphCurvesStore";
import { curvePath, curveBends, pointAlong } from "@/utils/showGraphLayout";
import {
  ovalOf, ovalBoundaryPoint, ellipsePoint, fanAttachPoint, laneOffsetFor, offsetAttach,
} from "@/utils/edgeLanes";
import { usePortLayout } from "@/stores/portLayoutStore";
import { useEdgeAttach, type EdgeEnd } from "@/stores/edgeAttachStore";
import { useUIStore } from "@/stores/uiStore";
import { useModelStore } from "@/stores/modelStore";
import { EDGE_LINE_HIGHLIGHT_EXTRA, EDGE_LINE_HOVER_EXTRA, edgeArrowheadScale, useEdgeLineWidth } from "@/stores/edgeLineStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useNotificationStore } from "@/stores/notificationStore";

const FAN_SPACING_PX = 18;
// Label width estimate: monospace 10px font ≈ 6px per char, plus ~12px
// of horizontal padding from the label badge background.
const LABEL_CHAR_PX = 6;
const LABEL_PAD_PX = 12;
// Extra clearance between the label edge and the chevron tip.
const ARROW_LABEL_GAP_PX = 8;
// Hard cap on the shift fraction so the chevron stays well inside the
// edge even when the path is short relative to the label.
const ARROW_SHIFT_MAX_FRAC = 0.4;
// Tangent-sampling half-window for the arrow angle. Wide enough to straddle
// a short jog the router can inject right at the chevron (a smoothstep corner
// is ~borderRadius px) so the chevron follows the edge's overall direction
// instead of locking onto a 1px corner tangent. See #290.
const ARROW_TANGENT_SPAN_PX = 10;

// Bow a cubic bezier perpendicular to the source→target line so multiple
// edges sharing a port endpoint converge to one pixel but follow visibly
// distinct paths. The bow magnitude is the edge's signed index within its
// bundle (centered on 0). See #278 — "overlap only at a point."
function fannedBezierPath(
  sx: number, sy: number,
  tx: number, ty: number,
  bundleIndex: number,
  bundleSize: number,
): string {
  const o = (bundleIndex - (bundleSize - 1) / 2) * FAN_SPACING_PX;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const ox = o * px;
  const oy = o * py;
  const c1x = sx + dx / 3 + ox;
  const c1y = sy + dy / 3 + oy;
  const c2x = sx + 2 * dx / 3 + ox;
  const c2y = sy + 2 * dy / 3 + oy;
  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
}


// #951: distance from point p to segment a→b, and the index of the closest
// segment in a polyline — where a new bend should be inserted.
function pointSegDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function nearestSegIndex(full: { x: number; y: number }[], p: { x: number; y: number }): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < full.length - 1; i++) {
    const d = pointSegDist(p, full[i], full[i + 1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best; // insert index into the waypoints array
}

// #947 (Alt-drag): persist per-port overrides to the layout sidecar, keyed by
// node varName like node positions — mirrors the #282 save-on-drop so a moved
// port survives reload. Per-edge overrides are session-scoped for now.
function persistPortOverrides(): void {
  const { filePath, nodes } = useModelStore.getState() as any;
  if (!filePath) return;
  const idToVar: Record<string, string> = {};
  for (const n of nodes) idToVar[n.id] = (n.data as any)?.varName || n.id;
  const overrides = usePortLayout.getState().overrides;
  const portPositions: Record<string, Record<string, number>> = {};
  for (const [nid, ports] of Object.entries(overrides)) portPositions[idToVar[nid] || nid] = ports;
  void fetch("/api/model/save-layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath, portPositions }),
  }).catch(() => {});
}

export function ProjectionEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  label,
  style,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [hoveredWp, setHoveredWp] = useState<number | null>(null); // #960: which bend handle is hovered
  // #961: which attachment dot is hovered. Bend handles already tracked this
  // per-point; the dots tracked only the *edge*, so hovering one grew both and
  // the two kinds of point answered the pointer differently.
  const [hoveredEnd, setHoveredEnd] = useState<EdgeEnd | null>(null);
  // #902 (DOF b): node-avoiding routing. `nodeLookup` is a stable Map ref that
  // changes when node internals do (i.e. when nodes move) — exactly when we need
  // to recompute obstacle boxes. Gated by the `avoidNodes` render setting (#912).
  const avoidNodes = useGraphSettings((s) => s.avoidNodes);
  const floatingPorts = useGraphSettings((s) => s.floatingPorts);
  const showPortDots = useGraphSettings((s) => s.showPortDots);
  const bundleEdges = useGraphSettings((s) => s.bundleEdges);
  const edgeLaneGap = useGraphSettings((s) => s.edgeLaneGap);
  const edgeNodeClearance = useGraphSettings((s) => s.edgeNodeClearance);
  const nodeLookup = useStore((s) => s.nodeLookup);
  // All edges — needed to find the siblings that share this edge's hub so a
  // fan-out can spread its attachment points (lever 2). Reactive to node moves.
  const rfEdges = useStore((s) => s.edges);
  // #282: manual per-port placement overrides (Alt-dragged). When present for
  // this edge's source/target port, they win over auto attachment.
  const portOverrides = usePortLayout((s) => s.overrides);
  // #947: per-edge attachment overrides (plain-dragged connection dot). Win over
  // the per-port override for THIS edge's end.
  const edgeAttach = useEdgeAttach((s) => s.overrides);
  // #951: user waypoints this edge routes through (absolute flow coords).
  const waypoints = useEdgeAttach((s) => s.waypoints[id]);
  const { screenToFlowPosition } = useReactFlow();
  const alwaysVisible = useUIStore((s) => s.edgeLabelsAlwaysVisible);
  const cursorHighlightedEdgeId = useModelStore((s) => s.cursorHighlightedEdgeId);
  // #952: the Inspector's selection lives in the app store; React Flow's own
  // `selected` prop flips off when a node grabs selection (e.g. on node drag),
  // which desynced the edge color from the Inspector. Key the highlight off the
  // app store so color stays consistent with what the Inspector shows.
  const selectedEdgeId = useModelStore((s) => s.selectedEdgeId);
  const setSelectedEdgeId = useModelStore((s) => s.setSelectedEdgeId);
  const showArrowheads = useGraphSettings((s) => s.showArrowheads);
  const edgeRouting = useGraphSettings((s) => s.edgeRouting);
  const lineWidth = useEdgeLineWidth(); // #107: Settings ▸ Appearance ▸ Lines between nodes
  const arrowheadSize = useGraphSettings((s) => s.arrowheadSize);
  const arrowheadPosition = useGraphSettings((s) => s.arrowheadPosition);
  const isSelected = selected || selectedEdgeId === id; // #952
  // #984: a revealed control must stay revealed while the pointer moves onto
  // it. The handle's 24px target extends past the edge's 20px hit band, so
  // gating purely on `hovered` unmounts the handle from under the cursor as
  // you reach for it. The connection dots already avoid this by setting
  // `hovered` themselves (see their onMouseEnter below).
  const handlesActive = isSelected || hovered || hoveredWp !== null || hoveredEnd !== null;
  // #41: shaping an edge belongs to a custom layout, like moving a node — in
  // Auto, nodes aren't draggable and edges aren't shapeable either. A press
  // still selects the edge; bends, handles and endpoint drags wait for Custom.
  const autoLayout = useModelStore((s) => s.autoLayout);
  const shapeable = !autoLayout;
  const isCursorHighlighted = !isSelected && cursorHighlightedEdgeId === id;
  const showLabel = isSelected || hovered || alwaysVisible || isCursorHighlighted;

  const labelOffset = (data as any)?.labelOffset ?? 0.5;
  // Only TRUE duplicate projections (same source AND same target) get fanned
  // apart — those overlap along their whole length, so straight lines would
  // collapse onto one another (#278). Edges that merely share a single port
  // (fan-in / fan-out from different nodes) follow the routing preference: as
  // straight lines they already form distinct tree branches that meet only at
  // the shared port pixel (#317).
  const bundleIndex = (data as any)?.pairBundleIndex ?? 0;
  const bundleSize = (data as any)?.pairBundleSize ?? 1;

  // #944/#946: lateral lane for near-parallel edges sharing a hub. `offset` !=0
  // ⇒ this edge is in a lane group; the router bows its node-safe path apart
  // (#944) AND its shared-hub attachment is spread so lane-mates don't converge
  // at the node (#946). `hub` says which end is the shared one.
  const lane = bundleEdges && bundleSize <= 1
    ? laneOffsetFor(id, source, sourceHandleId, target, targetHandleId, rfEdges as any, nodeLookup as any, edgeLaneGap)
    : { hubOffset: 0, hub: null as "source" | "target" | null, bowOffset: 0 };
  // #965: the bow (mid-length bend) is driven purely by real proximity — so a
  // divergent fan-out gets a hub spread but no spurious kink, while a genuinely
  // parallel pair still gets bowed apart.
  const bowOffset = lane.bowOffset;

  // #902 (DOF c): effective endpoints. When floating-port attachment is on,
  // attach at each oval's boundary facing the other node; otherwise use the
  // handle coords React Flow provides. Falls back to handles if a node box
  // isn't measured yet.
  let sx = sourceX, sy = sourceY, tx = targetX, ty = targetY;
  if (floatingPorts) {
    const sOval = ovalOf(nodeLookup.get(source) as any);
    const tOval = ovalOf(nodeLookup.get(target) as any);
    if (sOval && tOval) {
      // #947: per-edge override (plain drag) wins over #282 per-port override
      // (Alt drag); either one is a manual placement that suppresses auto-fan.
      const sOv = edgeAttach[id]?.s ?? (sourceHandleId ? portOverrides[source]?.[sourceHandleId] : undefined);
      const tOv = edgeAttach[id]?.t ?? (targetHandleId ? portOverrides[target]?.[targetHandleId] : undefined);
      // Fan-out/fan-in spreading (lever 2): only for real bundles, and only when
      // there's no manual override and this isn't a true-duplicate pair (those
      // keep their fannedBezier). A manual placement always wins; otherwise use
      // the spread direction if the edge is part of a hub fan, else the plain
      // facing-the-counterpart attachment.
      // Hub-laned edges spread via offsetAttach below; only 1a-spread when there
      // is no shared-hub lane.
      const canFan = bundleEdges && bundleSize <= 1 && lane.hub === null;
      const sFan = canFan && sOv == null
        ? fanAttachPoint(id, sOval, source, sourceHandleId, "source", rfEdges as any, nodeLookup as any)
        : null;
      const tFan = canFan && tOv == null
        ? fanAttachPoint(id, tOval, target, targetHandleId, "target", rfEdges as any, nodeLookup as any)
        : null;
      // #946: spread the shared-hub attachment along the oval by the lane offset.
      const sHub = lane.hub === "source" && sOv == null
        ? offsetAttach(sOval, tOval.cx, tOval.cy, lane.hubOffset) : null;
      const tHub = lane.hub === "target" && tOv == null
        ? offsetAttach(tOval, sOval.cx, sOval.cy, lane.hubOffset) : null;
      const sp = sOv != null ? ellipsePoint(sOval, sOv) : (sHub ?? sFan ?? ovalBoundaryPoint(sOval, tOval.cx, tOval.cy));
      const tp = tOv != null ? ellipsePoint(tOval, tOv) : (tHub ?? tFan ?? ovalBoundaryPoint(tOval, sOval.cx, sOval.cy));
      sx = sp.x; sy = sp.y; tx = tp.x; ty = tp.y;
    }
  }

  // #951: a manually-shaped edge routes through the user's waypoints in the
  // current style, with NO obstacle avoidance (Replace — manual means manual).
  // Node boxes this edge treats as obstacles (excludes its own endpoints and
  // composition frames) — same set the router uses; for manual routing + promote.
  const collectObstacles = (): Rect[] => {
    const obstacles: Rect[] = [];
    nodeLookup.forEach((n: any, nid: string) => {
      if (nid === source || nid === target || n.type === "compositionNode") return;
      const pos = n.internals?.positionAbsolute ?? n.position;
      if (!pos) return;
      obstacles.push({ x: pos.x, y: pos.y, w: n.measured?.width ?? 150, h: n.measured?.height ?? 60 });
    });
    return obstacles;
  };

  const manual = !!(waypoints && waypoints.length > 0);
  // #23: in the "Like show_graph" layout, follow show_graph's own course for
  // this edge — while both nodes are where that layout put them. Moving one
  // hands the edge back to normal routing; a hand-shaped edge stays manual.
  const sgCurve = useShowGraphCurves((st) => st.curves[id]);
  const posOf = (nid: string) => {
    const n = nodeLookup.get(nid) as any;
    return n?.internals?.positionAbsolute ?? n?.position;
  };
  const curve = !manual && sgCurve && curveFits(sgCurve, posOf(source), posOf(target), posOf) ? sgCurve : null;
  if (curve) {
    // Attach where the course meets each box, so the dots, label and arrow
    // sit on the drawn line.
    const [first, last] = [curve.points[0], curve.points[curve.points.length - 1]];
    sx = first.x; sy = first.y; tx = last.x; ty = last.y;
  }
  // Editable bends that keep the current shape when the edge is grabbed: the
  // curve's turning points, or the auto-route's corners.
  const autoBends = () =>
    curve
      ? curveBends(curve.points)
      : routeWaypoints({ x: sx, y: sy }, { x: tx, y: ty }, collectObstacles(), { lateralOffset: bowOffset, margin: edgeNodeClearance });
  let edgePath: string;
  if (curve) {
    edgePath = curvePath(curve.points);
  } else if (manual) {
    // #963: honor the user's bends but obstacle-avoid between them so no leg
    // passes behind a node.
    edgePath = renderStyledPathSafe(
      [{ x: sx, y: sy }, ...waypoints!, { x: tx, y: ty }],
      edgeRouting,
      collectObstacles(),
    );
  } else if (bundleSize > 1) {
    edgePath = fannedBezierPath(
      sx, sy, tx, ty,
      bundleIndex, bundleSize,
    );
  } else if (edgeRouting === "straight") {
    edgePath = `M ${sx} ${sy} L ${tx} ${ty}`;
  } else if (edgeRouting === "spline") {
    // #1023: control points along the source->target vector, so a clear edge
    // renders straight.
    //
    // #1006 fixed feedback edges bulging back across their own source by
    // deriving the bezier's handle facing from direction of travel — but it
    // snapped that to a cardinal direction, so a diagonal edge was forced to
    // leave straight up and arrive straight down. The horizontal offset between
    // the endpoints then became an S: the two control points landed on opposite
    // sides of the straight line, which is what an S-curve is. Every diagonal
    // got one; only exactly axis-aligned edges escaped.
    //
    // Placing the control points *on* the line removes the inflection at its
    // source. Spline mode is not "curves everywhere" — it is how bends render:
    // straight draws hard polyline corners, spline draws smooth curves through
    // the same bends. With nothing in the way the two coincide, which is right.
    //
    // Curves that have a reason are unaffected: a lane bow and a node detour
    // both come from routeAroundObstacles below, which overrides this path.
    edgePath = fannedBezierPath(sx, sy, tx, ty, 0, 1);
  } else {
    // #963: node-aware smooth-step. React Flow's getSmoothStepPath draws a
    // port-based orthogonal L that ignores obstacles, so a clear straight line
    // could still route its L behind a node. renderStyledPathSafe picks an elbow
    // that clears nodes (and routes around if the straight line is blocked). The
    // router below still overrides for genuine detours / lane bow.
    edgePath = renderStyledPathSafe(
      [{ x: sx, y: sy }, { x: tx, y: ty }], "smoothstep", collectObstacles(),
    );
  }

  // #914: route around EVERY node the edge would otherwise cross (visibility
  // graph, not just the single worst obstacle). Only true-duplicate bundles keep
  // their fannedBezierPath; fan-out lanes (1a) route through here so their
  // de-crowded launch points still avoid every node (1c — never pass behind a
  // node). Returns null when the straight line is already clear.
  if (avoidNodes && bundleSize <= 1 && !manual && !curve) {
    const obstacles: Rect[] = [];
    nodeLookup.forEach((n, nid) => {
      if (nid === source || nid === target) return;
      // Composition frames are containers, not obstacles — edges legitimately
      // cross their boundary to reach nodes inside (#914).
      if (n.type === "compositionNode") return;
      // Absolute position (nested nodes are positioned relative to their frame;
      // edge endpoints are in absolute flow coords, so we must match).
      const pos = n.internals?.positionAbsolute ?? n.position;
      if (!pos) return;
      obstacles.push({
        x: pos.x, y: pos.y,
        w: n.measured?.width ?? 150,
        h: n.measured?.height ?? 60,
      });
    });
    // #939: render the detour in the *selected* edge style, so a routed edge
    // obeys the dropdown exactly like a clear one (straight = hard polyline,
    // spline = smooth curve, smooth-step = rounded-corner polyline).
    const routed = routeAroundObstacles(
      { x: sx, y: sy }, { x: tx, y: ty }, obstacles,
      { style: edgeRouting, lateralOffset: bowOffset, margin: edgeNodeClearance },
    );
    if (routed) edgePath = routed;
  }

  // Label sits at the staggered offset along the straight source→target
  // line (matches existing behavior; not strictly on-curve, but close
  // enough for the bow magnitudes in play).
  const onCurve = curve ? pointAlong(curve.points, labelOffset) : null;
  const labelX = onCurve ? onCurve.x : sx + (tx - sx) * labelOffset;
  const labelY = onCurve ? onCurve.y : sy + (ty - sy) * labelOffset;

  const tooltip = (data as any)?.tooltip as string | undefined;

  // Sample the rendered path to find midpoint + tangent for the arrow.
  // Using the SVG path's own getPointAtLength handles bezier and
  // smoothstep uniformly, including the L-shaped corner case.
  const pathRef = useRef<SVGPathElement | null>(null);
  const [arrow, setArrow] = useState<{ x: number; y: number; angle: number } | null>(null);

  useEffect(() => {
    if (!showArrowheads) {
      setArrow(null);
      return;
    }
    const el = pathRef.current;
    if (!el) return;
    let total = 0;
    try {
      total = el.getTotalLength();
    } catch {
      return;
    }
    if (!total || !Number.isFinite(total)) return;

    // Where along the path the chevron sits. With no visible label it sits
    // at the user-configured position (#319; default midpoint). With a
    // label, shift by ~half the label width plus a small gap so the chevron
    // clears the badge — scaled to the actual path length (long edges get a
    // small fractional shift, short edges a large one), then clamped to
    // leave room near the endpoints.
    let t = arrowheadPosition;
    if (showLabel && label) {
      const labelW = String(label).length * LABEL_CHAR_PX + LABEL_PAD_PX;
      const shiftPx = labelW / 2 + ARROW_LABEL_GAP_PX;
      const shiftFrac = Math.min(ARROW_SHIFT_MAX_FRAC, shiftPx / total);
      const dir = labelOffset >= 0.5 ? -1 : 1;
      t = labelOffset + dir * shiftFrac;
      t = Math.min(0.9, Math.max(0.1, t));
    }

    const want = Math.max(0, Math.min(total, total * t));
    // Sample the tangent over a window scaled to the path (capped), not a
    // fixed ±1px: a near-vertical smoothstep edge between stacked nodes whose
    // centers differ by a pixel injects a degenerate corner right at the
    // midpoint, and a 1px window locked the arrow onto that corner's sideways
    // tangent instead of pointing along the edge (#290).
    const span = Math.min(total / 2, Math.max(ARROW_TANGENT_SPAN_PX, total * 0.08));

    // #948: the requested position can land right on a sudden turn (a smooth-step
    // corner or taut-string kink), where the chevron looks misplaced. Measure the
    // local turn angle at a candidate length (0 = straight) and search a window
    // around the requested spot for the straightest point, tie-breaking toward the
    // requested position — so the arrow sits on a clean stretch, not a corner.
    const turnAt = (L: number): number => {
      const a = Math.max(0, L - span), b = Math.min(total, L + span);
      const ph = el.getPointAtLength(L), pa = el.getPointAtLength(a), pb = el.getPointAtLength(b);
      let d = Math.abs(Math.atan2(pb.y - ph.y, pb.x - ph.x) - Math.atan2(ph.y - pa.y, ph.x - pa.x));
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d;
    };
    const searchR = Math.min(total * 0.25, 60);
    const STEPS = 8;
    let at = want, bestScore = Infinity;
    for (let k = -STEPS; k <= STEPS; k++) {
      const L = want + (k / STEPS) * searchR;
      if (L < span || L > total - span) continue;
      const score = turnAt(L) + 0.002 * Math.abs(L - want); // straightest, then nearest
      if (score < bestScore) { bestScore = score; at = L; }
    }

    const ahead = Math.min(total, at + span);
    const behind = Math.max(0, at - span);
    const ptHere = el.getPointAtLength(at);
    const ptAhead = el.getPointAtLength(ahead);
    const ptBehind = el.getPointAtLength(behind);
    const angle = Math.atan2(ptAhead.y - ptBehind.y, ptAhead.x - ptBehind.x);
    setArrow({ x: ptHere.x, y: ptHere.y, angle: (angle * 180) / Math.PI });
  }, [edgePath, showArrowheads, showLabel, label, labelOffset, arrowheadPosition]);

  // #947: drag a connection dot to place this edge's attachment. Plain drag pins
  // just THIS edge (edgeAttachStore); Alt/Option drag moves the whole PORT
  // (portLayoutStore, #282) so every edge on it follows. The angle is the cursor
  // projected onto the node oval (flow coords), same convention as #282.
  const startDotDrag = (end: EdgeEnd) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const alt = e.altKey;
    const nodeId = end === "s" ? source : target;
    const handleId = end === "s" ? sourceHandleId : targetHandleId;
    const move = (ev: PointerEvent) => {
      const oval = ovalOf(nodeLookup.get(nodeId) as any);
      if (!oval) return;
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const angle = Math.atan2((p.y - oval.cy) / oval.b, (p.x - oval.cx) / oval.a);
      if (alt) {
        if (handleId) usePortLayout.getState().setOverride(nodeId, handleId, angle);
      } else {
        useEdgeAttach.getState().setEnd(id, end, angle);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (alt) persistPortOverrides(); // per-port survives reload (#282); per-edge is session-scoped for now
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // #951: drag anywhere on an edge to bend it — creates a waypoint at the press
  // point (inserted on the nearest segment) and drags it; a click without motion
  // just selects the edge. stopPropagation keeps React Flow from panning.
  const startEdgeShape = (e: React.PointerEvent) => {
    if (e.altKey) return;
    if (!shapeable) {
      // Select, and leave the drag to React Flow (it pans).
      setSelectedEdgeId(id);
      return;
    }
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let idx = -1;
    const move = (ev: PointerEvent) => {
      if (idx < 0) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return; // #957: threshold
        const p0 = screenToFlowPosition({ x: startX, y: startY });
        let wps = useEdgeAttach.getState().waypoints[id] || [];
        // #951 (promote-on-grab): if this edge has no user waypoints yet but is
        // auto-routed around nodes, materialize those auto corners as editable
        // waypoints first — preserving the shape and making every corner behave
        // the same as a user bend.
        if (wps.length === 0 && (curve || (avoidNodes && bundleSize <= 1))) {
          const auto = autoBends();
          if (auto.length) {
            useEdgeAttach.getState().setWaypoints(id, auto);
            wps = auto;
          }
        }
        // #957: if the drag starts near an existing bend, MOVE it rather than
        // inserting a new one — so a slight miss on the handle doesn't spawn a
        // duplicate. Otherwise insert a new bend on the nearest segment.
        let near = -1, nearD = 16;
        for (let i = 0; i < wps.length; i++) {
          const d = Math.hypot(wps[i].x - p0.x, wps[i].y - p0.y);
          if (d < nearD) { nearD = d; near = i; }
        }
        if (near >= 0) {
          idx = near;
        } else {
          const full = [{ x: sx, y: sy }, ...wps, { x: tx, y: ty }];
          idx = nearestSegIndex(full, p0);
          useEdgeAttach.getState().insertWaypoint(id, idx, p0);
        }
      }
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      useEdgeAttach.getState().moveWaypoint(id, idx, p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (idx < 0) setSelectedEdgeId(id); // a click, not a bend
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // #951/#961: handles show on every corner of an active edge — the user's
  // waypoints if shaped, else the auto-route corners. Grabbing (or deleting)
  // an auto corner first materializes the whole route as waypoints so the shape
  // is preserved and the index lines up.
  const promoteIfNeeded = () => {
    if (!(useEdgeAttach.getState().waypoints[id]?.length)) {
      const auto = autoBends();
      if (auto.length) useEdgeAttach.getState().setWaypoints(id, auto);
    }
  };
  const startWaypointDrag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    // #964: promote on first MOVE, not on pointerdown — a pure click/double-click
    // must not re-render mid-gesture (that swallowed the dblclick-to-delete).
    let promoted = false;
    const move = (ev: PointerEvent) => {
      if (!promoted) { promoteIfNeeded(); promoted = true; }
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      useEdgeAttach.getState().moveWaypoint(id, index, p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // #965/#966 (C): corners to show as handles on an active edge. User waypoints
  // are freely editable (forced: false); geometry-driven bends (node detour,
  // lane bow) are "forced" — shown as a distinct dot that promotes to a user
  // waypoint on grab, so every bend has a dot and its origin is legible.
  const cornerPts: { x: number; y: number; forced: boolean }[] = manual
    // #1019: take the handles from the same expansion the renderer draws, not
    // from the raw waypoint list. The renderer inserts corners between
    // consecutive waypoints to route around nodes; listing only the user's
    // waypoints left those corners visible in the edge with no dot on them —
    // a bend that appeared as you dragged, at a position you did not pick, and
    // could not then grab. Inserted corners come back forced:true, so they
    // render as the promote-on-grab dot like any other geometry-driven bend.
    ? expandedCorners(
        [{ x: sx, y: sy }, ...(waypoints as { x: number; y: number }[]), { x: tx, y: ty }],
        collectObstacles(),
      )
    : (handlesActive && (curve || (avoidNodes && bundleSize <= 1))
        ? autoBends().map((p) => ({ x: p.x, y: p.y, forced: true }))
        : []);

  const effectiveStroke = isSelected
    ? "var(--pnv-primary)"
    : isCursorHighlighted
    ? "var(--pnv-cursor-highlight)"
    : hovered
    // #961: hover highlight — a light blue that reads on dark edges (the old
    // dark-grey bold was nearly invisible).
    ? "var(--pnv-edge-hover)"
    : (style?.stroke as string | undefined) ?? "var(--pnv-edge-default)";

  // #319: the line width scales each projection's per-type base width
  // (Mapping 2, Inactive 1.5, Dangling 2.5, …) rather than flattening them to
  // one value, so the type distinctions survive. An ordinary (Mapping) line is
  // drawn at exactly the chosen width (#107).
  const baseStrokeWidth = typeof style?.strokeWidth === "number" ? style.strokeWidth : 2;
  const scaledStrokeWidth = baseStrokeWidth * (lineWidth / 2);
  // The arrowhead grows and shrinks with the line (#107); at the default
  // width it is the size chosen in the Style tab.
  const headSize = arrowheadSize * edgeArrowheadScale(lineWidth);
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        // #23: marks an edge drawn along show_graph's own course.
        className={curve ? "pnv-edge-showgraph" : undefined}
        // show_graph's edge it follows, by its ends' names (#73).
        data-showgraph-ends={curve?.ends?.join("\u0000")}
        interactionWidth={0}
        style={{
          // Spread per-type style first (color, dasharray, base width), then
          // override width + stroke so the dynamic values actually win — the
          // previous order let ...style clobber them, making thickness, hover,
          // and selection-recolor inert (#319).
          ...style,
          strokeWidth: hovered ? scaledStrokeWidth + EDGE_LINE_HOVER_EXTRA : isCursorHighlighted ? scaledStrokeWidth + EDGE_LINE_HIGHLIGHT_EXTRA : scaledStrokeWidth,
          stroke: effectiveStroke,
        }}
      />
      {/* Wide invisible hit area ON TOP of BaseEdge — carries hover + the #951
          drag-to-bend. BaseEdge's own interaction path is disabled
          (interactionWidth=0) so this one reliably receives the pointerdown;
          selection is handled in startEdgeShape (click without motion). */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onPointerDown={startEdgeShape}
        onDoubleClick={() => { if (shapeable && waypoints && waypoints.length) useEdgeAttach.getState().clearWaypoints(id); }}
        // The cursor comes from index.css (#1301): the arrow under the
        // arrow setting, a grab hand under "hand". Not a hand in Auto (#41):
        // there is nothing to grab.
        className={shapeable ? "projection-edge-hit" : "projection-edge-hit projection-edge-hit-auto"}
        data-shapeable={shapeable ? "true" : "false"}
        style={{ pointerEvents: "stroke" }}
      >
        <title>{`${tooltip ? tooltip + "\n" : ""}${shapeable
          ? "drag: bend · double-click: reset route"
          : "Layout: Auto. Switch to Custom (graph toolbar) to reshape edges"}`}</title>
      </path>
      {/* Hidden measurement path — same geometry as the visible edge,
          referenced for getPointAtLength to position the chevron. */}
      <path ref={pathRef} d={edgePath} fill="none" stroke="none" style={{ pointerEvents: "none" }} />
      {showArrowheads && arrow && (
        <polygon
          points={`0,0 ${-2 * headSize},${-headSize * 0.6} ${-2 * headSize},${headSize * 0.6}`}
          data-testid="edge-arrowhead"
          data-head-size={headSize}
          fill={effectiveStroke}
          transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
          style={{ pointerEvents: "none" }}
        />
      )}
      {/* #945/#953: connection dots at the edge's real floating attachment
          points (output = green at source, input = blue at target). Rendered in
          a ViewportPortal so they sit ABOVE the node layer — otherwise the node's
          DOM covers them and steals the drag (#953). Each is an invisible 16px
          grab target (drag/hover) wrapping the small visible dot. */}
      {floatingPorts && showPortDots && (
        <ViewportPortal>
          {([
            { x: sx, y: sy, color: "var(--pnv-port-output)", end: "s" as EdgeEnd, label: `output — ${source}${sourceHandleId ? " · " + sourceHandleId : ""}` },
            { x: tx, y: ty, color: "var(--pnv-port-input)", end: "t" as EdgeEnd, label: `input — ${target}${targetHandleId ? " · " + targetHandleId : ""}` },
          ]).map((d) => {
            // #961: a dot's own hover grows it, matching how a bend handle
            // answers the pointer. Edge hover still lifts both a little, so the
            // pair stays findable without singling one out.
            const hot = hoveredEnd === d.end;
            const r = hot ? 5 : hovered ? 4 : 3.2;
            return (
              <div key={d.end} style={{ position: "absolute", transform: `translate(${d.x}px, ${d.y}px)`, pointerEvents: "none" }}>
                <div
                  className="nodrag nopan" // #975 — same d3-zoom handoff as the bend handles
                  title={shapeable
                    ? `${d.label}\ndrag: move this edge · Option-drag: move the whole port`
                    : d.label}
                  onPointerDown={shapeable ? startDotDrag(d.end) : undefined}
                  onMouseEnter={() => {
                    setHovered(true);
                    setHoveredEnd(d.end);
                  }}
                  onMouseLeave={() => {
                    setHovered(false);
                    setHoveredEnd(null);
                  }}
                  style={{ position: "absolute", left: -8, top: -8, width: 16, height: 16, borderRadius: "50%", cursor: shapeable ? "grab" : "default", pointerEvents: "all" }}
                >
                  <div style={{ position: "absolute", left: 8 - r, top: 8 - r, width: 2 * r, height: 2 * r, borderRadius: "50%", background: d.color, border: `${hot ? 1.5 : 1}px solid var(--pnv-surface)`, boxSizing: "border-box", pointerEvents: "none" }} />
                </div>
              </div>
            );
          })}
        </ViewportPortal>
      )}
      {/* #951/#961/#965 (C): bend handles on an active edge, shown on ALL corners.
          User waypoints = solid blue (drag to move, double-click to remove).
          Forced/geometry bends = a distinct dashed-grey ring (auto separation);
          drag to take manual control (promotes), but not double-click-deletable
          (it's rule-driven). Above nodes via ViewportPortal. */}
      {shapeable && handlesActive && cornerPts.length > 0 && (
        <ViewportPortal>
          {cornerPts.map((wp, i) => {
            const hot = hoveredWp === i; // #960: this handle is hovered
            const r = hot ? 18 : 14;
            const color = wp.forced ? "var(--pnv-edge-bend-forced)" : "var(--pnv-primary)"; // forced = muted grey, user = blue
            return (
              // zIndex keeps bend handles above the connection dots so every one
              // (incl. the outermost near an endpoint) is reachable (#960).
              <div key={`wp-${i}`} style={{ position: "absolute", transform: `translate(${wp.x}px, ${wp.y}px)`, pointerEvents: "none", zIndex: 20 }}>
                {/* 22px invisible grab target (so a slight miss still grabs the
                    bend, not the edge, #957) around the visible handle. */}
                <div
                  // #975: `nopan` is what actually stops the canvas from panning.
                  // stopPropagation on the React synthetic pointerdown doesn't —
                  // React Flow pans via d3-zoom, which listens natively on the
                  // pane and never sees React's synthetic propagation. Without
                  // this the handle tracks the cursor until d3-zoom's own drag
                  // threshold trips, then the canvas takes the gesture over.
                  className="nodrag nopan"
                  // #1365: stable hook for e2e; a `title*="bend"` lookup also
                  // matches unrelated toolbar tooltips.
                  data-testid="edge-bend-handle"
                  data-bend-kind={wp.forced ? "forced" : "user"}
                  title={wp.forced
                    ? "auto bend (geometry) · drag to take manual control"
                    : "drag: move bend · double-click: remove"}
                  onPointerDown={startWaypointDrag(i)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!wp.forced) {
                      useEdgeAttach.getState().removeWaypoint(id, i);
                      return;
                    }
                    // #964: a forced bend is the router keeping this edge clear
                    // of something, so it cannot be deleted — but silently
                    // ignoring the gesture is the confusing part. Double-click
                    // removes a bend everywhere else, so say why it does not
                    // here, and point at what does work.
                    useNotificationStore
                      .getState()
                      .addNotification(
                        "info",
                        "This bend keeps the edge clear of what's in its way, so it can't be removed. Drag it to take manual control of the route.",
                        6000,
                      );
                  }}
                  onMouseEnter={() => setHoveredWp(i)}
                  onMouseLeave={() => setHoveredWp((v) => (v === i ? null : v))}
                  style={{ position: "absolute", left: -12, top: -12, width: 24, height: 24, borderRadius: "50%", cursor: "grab", pointerEvents: "all", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <div style={{ width: r, height: r, borderRadius: "50%", background: hot ? color : "var(--pnv-surface)", border: `2px ${wp.forced ? "dashed" : "solid"} ${color}`, boxSizing: "border-box", transition: "width 0.1s, height 0.1s, background 0.1s" }} />
                </div>
              </div>
            );
          })}
        </ViewportPortal>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              fontSize: 10,
              color: isSelected ? "var(--pnv-primary)" : isCursorHighlighted ? "var(--pnv-cursor-highlight)" : "var(--pnv-text-secondary)",
              fontFamily: "monospace",
              fontWeight: isSelected || isCursorHighlighted ? 600 : 400,
              background: "var(--pnv-edge-label-bg)",
              padding: "2px 6px",
              borderRadius: 4,
              border: isSelected
                ? "1px solid var(--pnv-primary)"
                : isCursorHighlighted
                ? "1px solid var(--pnv-cursor-highlight)"
                : "1px solid var(--pnv-border-light)",
              whiteSpace: "nowrap",
              lineHeight: "14px",
              opacity: showLabel ? 1 : 0,
              transition: "opacity 0.15s",
              boxShadow: showLabel ? "var(--pnv-shadow-chip)" : "none",
            }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
