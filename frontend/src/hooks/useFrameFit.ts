/**
 * A frame fits what it holds (#208). A composition just opened is built before
 * its members have been drawn, so its frame is sized for boxes of the assumed
 * width and a wider member sticks out of it, and room was made for that smaller
 * frame. In a custom layout, once the members are drawn, fit the frame to them
 * and make room again. It settles the graph after a build, so it is neither an
 * undo step nor a save: the next drag saves these positions with the rest.
 *
 * Automatic layouts place frames themselves (Layered: useLayeredLayoutFit).
 */

import { useEffect, useMemo } from "react";
import type { Node } from "@xyflow/react";
import { fitFramesAndMakeRoom, useModelStore, usesFlatPositions } from "@/stores/modelStore";
import { graphSignature, knownSize } from "@/utils/showGraphLayout";
import { placeCims } from "@/utils/cimPlacement";

// How many frames to wait for the graph to be drawn.
const MAX_FRAMES = 60;

const placeOf = (n: Node) => `${n.position.x},${n.position.y},${n.style?.width},${n.style?.height}`;

export function useFrameFit() {
  const nodes = useModelStore((s) => s.nodes);
  const signature = useMemo(() => graphSignature(nodes), [nodes]);

  useEffect(() => {
    if (!signature) return;
    let frame = 0;
    let frames = 0;
    const check = () => {
      const { nodes, setNodes, autoLayout, lastLayoutPositions } = useModelStore.getState();
      // Without saved positions a custom layout still shows the layout's own
      // placement, with Like show_graph's frames sized by show_graph (#34).
      if (autoLayout || usesFlatPositions() || !Object.keys(lastLayoutPositions ?? {}).length) return;
      const members = nodes.filter((n: Node) => n.parentId && n.type === "mechanismNode" && !n.hidden);
      if (!members.length) return;
      if (members.some((n: Node) => knownSize(n).w === undefined)) {
        if (++frames < MAX_FRAMES) frame = requestAnimationFrame(check);
        return;
      }
      const fitted = nodes.map((n: Node) => ({ ...n }));
      fitFramesAndMakeRoom(fitted);
      if (fitted.some((n: Node, i: number) => placeOf(n) !== placeOf(nodes[i]))) setNodes(placeCims(fitted));
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [signature]);
}
