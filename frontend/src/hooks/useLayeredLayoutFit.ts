/**
 * The Layered layout spaces a box at its drawn width when that is wider than
 * the width it assumes (#72). A newly opened graph is laid out before it is
 * drawn, though, so its wide boxes are spaced at the assumed width and can
 * overlap. Once the graph is drawn, lay it out again if any box is wider.
 */

import { useEffect, useMemo } from "react";
import type { Node } from "@xyflow/react";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { autoSizeGroups, useModelStore } from "@/stores/modelStore";
import { applyLayout, LAYERED_NODE_WIDTH } from "@/utils/layout";
import { graphSignature, knownSize } from "@/utils/showGraphLayout";
import { placeCims } from "@/utils/cimPlacement";

// How many frames to wait for the graph to be drawn.
const MAX_FRAMES = 60;

export function useLayeredLayoutFit() {
  const layoutStyle = useGraphSettings((s) => s.layoutStyle);
  const nodes = useModelStore((s) => s.nodes);
  const signature = useMemo(() => graphSignature(nodes), [nodes]);

  useEffect(() => {
    if (layoutStyle !== "layered" || !signature) return;
    let frame = 0;
    let frames = 0;
    const check = () => {
      const { nodes, edges, setNodes, autoLayout } = useModelStore.getState();
      if (!autoLayout) return;
      const widths = nodes
        .filter((n: Node) => n.type === "mechanismNode")
        .map((n: Node) => knownSize(n).w);
      if (widths.some((w) => w === undefined)) {
        if (++frames < MAX_FRAMES) frame = requestAnimationFrame(check);
        return;
      }
      if (widths.some((w) => w! > LAYERED_NODE_WIDTH)) {
        const { direction } = useGraphSettings.getState();
        // As the graph build does: frames then fit their members, and the
        // CIMs go back against the frame as fitted.
        const laid = applyLayout("layered", nodes, edges, { direction });
        autoSizeGroups(laid);
        setNodes(placeCims(laid));
      }
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [layoutStyle, signature]);
}
