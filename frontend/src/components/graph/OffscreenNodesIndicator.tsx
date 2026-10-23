/**
 * Tells you when part of the graph has left the viewport, and offers to fit (#1183).
 *
 * The canvas does not re-fit when its pane is resized — running a model grows
 * the results panel and shrinks the canvas, which can push nodes out of sight.
 * Re-framing automatically was the other option and was rejected: someone who
 * has zoomed in on a node to read its ports should not lose that because a run
 * finished. So the view never moves on its own; this says what happened and
 * puts the fit one click away.
 */

import { useReactFlow, useStore } from "@xyflow/react";
import { useFitGraph } from "@/hooks/useFitGraph";

import { offscreenNodeIds, type NodeBox } from "@/utils/offscreenNodes";

export function OffscreenNodesIndicator() {
  const fitGraph = useFitGraph();

  // A count, not a list — a primitive keeps this from re-rendering on every
  // frame of a pan, where the set of ids churns but the number rarely does.
  const count = useStore((state) => {
    const boxes: NodeBox[] = [];
    for (const node of state.nodeLookup.values()) {
      if (node.hidden) continue;
      const position = node.internals.positionAbsolute;
      boxes.push({
        id: node.id,
        x: position.x,
        y: position.y,
        width: node.measured?.width ?? 0,
        height: node.measured?.height ?? 0,
      });
    }
    return offscreenNodeIds(boxes, {
      transform: state.transform,
      width: state.width,
      height: state.height,
    }).length;
  });

  if (count === 0) return null;

  const label = `${count} node${count === 1 ? "" : "s"} off-screen`;

  return (
    <button
      type="button"
      data-testid="offscreen-nodes-indicator"
      onClick={fitGraph}
      title="Fit the whole graph into view"
      aria-label={`${label}. Fit the whole graph into view.`}
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 6,
        border: "1px solid var(--pnv-warning-tag-border)",
        background: "var(--pnv-warning-tint)",
        color: "var(--pnv-warning-tag-text)",
        fontSize: 12,
        cursor: "pointer",
        boxShadow: "var(--pnv-shadow-chip)",
      }}
    >
      <span aria-hidden="true">⌖</span>
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>Fit</span>
    </button>
  );
}
