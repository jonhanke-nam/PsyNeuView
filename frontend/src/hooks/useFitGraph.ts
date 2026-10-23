/**
 * Fit the whole drawn graph in view (#52): the nodes, and the courses of
 * edges drawn along show_graph's curves (#23), which can swing well outside
 * the nodes (EGO's STATE → LOSS runs round the left of the graph). React
 * Flow's own fitView frames the nodes only, so those curves were cut off.
 */

import { useCallback } from "react";
import { useReactFlow, type Rect } from "@xyflow/react";
import { useShowGraphCurves, type Point } from "@/stores/showGraphCurvesStore";

const PADDING = 0.2;

/** `rect` grown to take in every point. */
export function boundsWithPoints(rect: Rect, points: Point[]): Rect {
  if (points.length === 0) return rect;
  let x0 = rect.x;
  let y0 = rect.y;
  let x1 = rect.x + rect.width;
  let y1 = rect.y + rect.height;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function useFitGraph(): () => void {
  const { fitView, fitBounds, getNodes, getNodesBounds } = useReactFlow();
  return useCallback(() => {
    const nodes = getNodes();
    const curves = Object.values(useShowGraphCurves.getState().curves);
    if (nodes.length === 0 || curves.length === 0) {
      void fitView({ padding: PADDING });
      return;
    }
    const bounds = boundsWithPoints(
      getNodesBounds(nodes),
      curves.flatMap((c) => c.points),
    );
    void fitBounds(bounds, { padding: PADDING });
  }, [fitView, fitBounds, getNodes, getNodesBounds]);
}
