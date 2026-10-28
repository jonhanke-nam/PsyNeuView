/**
 * Custom React Flow edge for GraphStructureConditions.
 *
 * Renders a dashed, colored line with a label badge showing the condition type.
 * Visually distinct from projection edges (solid lines).
 *
 * GSC edges express scheduler *ordering* (e.g. "EM before CONTEXT"), which is
 * orthogonal to data flow, so they routinely point "backwards" relative to the
 * layout. They carry no port, so React Flow anchors them to the node's first
 * port handle (`bounds[0]`) on that port's fixed side; when that side faces
 * away from the other node, smoothstep routing loops far out into empty canvas
 * and the line reads as dangling (#651). We instead compute *floating*
 * endpoints on each node's boundary facing the other node, so the edge always
 * takes the short, direct route between the two nodes regardless of ports.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useStore,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import { useState } from "react";
import { routeAroundObstacles, type Rect } from "@/utils/edgeRouter";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";

/** Point on `node`'s bounding box where the ray toward (tx, ty) exits it. */
function boundaryPoint(node: InternalNode, tx: number, ty: number) {
  const pos = node.internals.positionAbsolute;
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  const cx = pos.x + w / 2;
  const cy = pos.y + h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx !== 0 ? w / 2 / Math.abs(dx) : Infinity,
    dy !== 0 ? h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function nodeCenter(node: InternalNode) {
  const pos = node.internals.positionAbsolute;
  return {
    x: pos.x + (node.measured?.width ?? 0) / 2,
    y: pos.y + (node.measured?.height ?? 0) / 2,
  };
}

/** Color mapping by GSC type: the graph-condition tokens (styles/palette.css). */
const GSC_COLORS: Record<string, string> = {
  BeforeNode: "var(--pnv-gsc-before)",
  BeforeNodes: "var(--pnv-gsc-before)",
  AfterNode: "var(--pnv-gsc-after)",
  AfterNodes: "var(--pnv-gsc-after)",
  AddEdgeTo: "var(--pnv-gsc-add-edge)",
  RemoveEdgeFrom: "var(--pnv-gsc-remove-edge)",
  WithNode: "var(--pnv-gsc-with)",
};

/** Short display labels */
const GSC_LABELS: Record<string, string> = {
  BeforeNode: "before",
  BeforeNodes: "before",
  AfterNode: "after",
  AfterNodes: "after",
  AddEdgeTo: "+edge",
  RemoveEdgeFrom: "−edge",
  WithNode: "with",
};

export function GSCEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps) {
  const gscType = (data as any)?.gscType || "unknown";
  const color = (data as any)?.color || GSC_COLORS[gscType] || "var(--pnv-gsc-other)";
  const label = GSC_LABELS[gscType] || gscType;

  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // #919: same obstacle-avoiding router as projections, so the dotted-blue
  // scheduler lines also weave around nodes instead of cutting through them.
  const avoidNodes = useGraphSettings((s) => s.avoidNodes);
  const edgeNodeClearance = useGraphSettings((s) => s.edgeNodeClearance);
  const nodeLookup = useStore((s) => s.nodeLookup);

  // Floating endpoints on the node boundaries facing each other. Falls back to
  // React Flow's port-anchored coords if a node hasn't been measured yet.
  let sx = sourceX, sy = sourceY, tx = targetX, ty = targetY;
  if (sourceNode && targetNode) {
    const sc = nodeCenter(sourceNode);
    const tc = nodeCenter(targetNode);
    const sp = boundaryPoint(sourceNode, tc.x, tc.y);
    const tp = boundaryPoint(targetNode, sc.x, sc.y);
    sx = sp.x; sy = sp.y; tx = tp.x; ty = tp.y;
  }

  let edgePath = `M ${sx} ${sy} L ${tx} ${ty}`;
  if (avoidNodes) {
    const obstacles: Rect[] = [];
    nodeLookup.forEach((n, nid) => {
      if (nid === source || nid === target) return;
      if (n.type === "compositionNode") return; // frames are containers
      const pos = n.internals?.positionAbsolute ?? n.position;
      if (!pos) return;
      obstacles.push({
        x: pos.x, y: pos.y,
        w: n.measured?.width ?? 150,
        h: n.measured?.height ?? 60,
      });
    });
    // Scheduler edges have no routing mode and read as straight ordering marks;
    // keep hard taut-string corners on the detour (#939 style API).
    const routed = routeAroundObstacles(
      { x: sx, y: sy }, { x: tx, y: ty }, obstacles, { style: "straight", margin: edgeNodeClearance },
    );
    if (routed) edgePath = routed;
  }
  const labelX = (sx + tx) / 2;
  const labelY = (sy + ty) / 2;

  const isRemove = gscType === "RemoveEdgeFrom";
  // #984: the label is clickable (pointerEvents: "all", cursor: pointer) but
  // is a div, so it misses the global `button:hover` rule and had no hover
  // feedback at all — it only changed once already selected.
  const [hovered, setHovered] = useState(false);
  // React Flow's `selected` covers a click on the edge itself; a condition
  // row in the Inspector or the Scheduler tab selects through the app store
  // (#1370), as ProjectionEdge does (#952).
  const selectedEdgeId = useModelStore((s) => s.selectedEdgeId);
  const isSelected = selected || selectedEdgeId === id;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url(#gsc-arrow-${id})`}
        style={{
          stroke: color,
          strokeWidth: isSelected || hovered ? 3 : 2,
          strokeDasharray: isRemove ? "4 4" : "6 3",
          opacity: isRemove ? 0.7 : 1,
        }}
      />
      {/* Arrowhead marker */}
      <defs>
        <marker
          id={`gsc-arrow-${id}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          {/* A style, not the fill attribute: an SVG attribute cannot read var(). */}
          <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: color }} />
        </marker>
      </defs>
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
            fontSize: "var(--pnv-fs-10)",
            fontWeight: 600,
            fontFamily: "monospace",
            color: "var(--pnv-on-primary)",
            background: color,
            padding: "1px 6px",
            borderRadius: 8,
            border: isSelected ? "2px solid var(--pnv-text-body)" : "1px solid var(--pnv-gsc-badge-edge)",
            boxShadow: hovered && !isSelected ? "var(--pnv-gsc-badge-hover-ring)" : undefined,
            whiteSpace: "nowrap",
            lineHeight: "16px",
            cursor: "pointer",
          }}
          className="nodrag nopan"
          data-testid="gsc-edge-badge"
          data-edge-id={id}
          data-selected={isSelected ? "true" : "false"}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {isRemove ? "✕ " : ""}{label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
