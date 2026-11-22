/**
 * The Layered layout spaces a box at its drawn width when that is wider than
 * the width it assumes (#72). A newly opened graph is laid out before it is
 * drawn, though, so its wide boxes are spaced at the assumed width and can
 * overlap. And a box narrower or shorter than its slot is centred in it, by the
 * size expected for its name (#210), which its outline can change a little.
 * Once the graph is drawn, lay it out again if that moves anything.
 */

import { useEffect, useMemo } from "react";
import type { Node } from "@xyflow/react";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { autoSizeGroups, useModelStore } from "@/stores/modelStore";
import { applyLayout } from "@/utils/layout";
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
      const { direction } = useGraphSettings.getState();
      // As the graph build does: frames then fit their members, and the CIMs
      // go back against the frame as fitted.
      const laid = applyLayout("layered", nodes, edges, { direction });
      autoSizeGroups(laid);
      const placed = placeCims(laid);
      const before = new Map(nodes.map((n: Node) => [n.id, n.position]));
      const moved = placed.some((n: Node) => {
        const was = before.get(n.id);
        return !was || Math.abs(was.x - n.position.x) > 0.5 || Math.abs(was.y - n.position.y) > 0.5;
      });
      if (moved) setNodes(placed);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [layoutStyle, signature]);
}
