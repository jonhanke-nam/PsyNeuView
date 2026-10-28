/**
 * Fit the whole drawn graph in view (#52): the nodes, and the courses of
 * edges drawn along show_graph's curves (#23), which can swing well outside
 * the nodes (EGO's STATE → LOSS runs round the left of the graph). React
 * Flow's own fitView frames the nodes only, so those curves were cut off.
 *
 * The graph fills the canvas (#54): it is scaled until it meets the canvas,
 * less a small even margin, in whichever direction limits it, and centred.
 * The margin is a fixed few pixels, not a share of the canvas — React Flow's
 * fractional padding (we used 20%) took a fifth of each axis, so a wide graph
 * got only ~83% of the width. For a wide graph the space above and below is
 * just what its shape leaves over.
 */

import { useCallback } from "react";
import { useReactFlow, useStoreApi, type Rect, type Viewport } from "@xyflow/react";
import { useShowGraphCurves, type Point } from "@/stores/showGraphCurvesStore";

/** The margin Fit leaves on every side, in screen pixels. */
export const FIT_MARGIN_PX = 24;

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

/**
 * The viewport that shows `bounds` as large as fits a `width` × `height`
 * canvas with `margin` px on every side, centred both ways. The margin
 * shrinks on a canvas too small for it (never more than a tenth of a side);
 * the zoom is held within [minZoom, maxZoom].
 */
export function fitViewport(
  bounds: Rect,
  width: number,
  height: number,
  { margin = FIT_MARGIN_PX, minZoom = 0, maxZoom = Infinity }: { margin?: number; minZoom?: number; maxZoom?: number } = {},
): Viewport {
  const mx = Math.min(margin, width * 0.1);
  const my = Math.min(margin, height * 0.1);
  const zx = bounds.width > 0 ? (width - 2 * mx) / bounds.width : Infinity;
  const zy = bounds.height > 0 ? (height - 2 * my) / bounds.height : Infinity;
  let zoom = Math.min(zx, zy);
  if (!Number.isFinite(zoom)) zoom = 1;
  zoom = Math.min(Math.max(zoom, minZoom), maxZoom);
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}

export function useFitGraph(): () => void {
  const { setViewport, getNodes, getNodesBounds } = useReactFlow();
  const store = useStoreApi();
  return useCallback(() => {
    const nodes = getNodes();
    const { width, height, minZoom, maxZoom } = store.getState();
    if (nodes.length === 0 || width === 0 || height === 0) return;
    const curves = Object.values(useShowGraphCurves.getState().curves);
    const bounds = boundsWithPoints(
      getNodesBounds(nodes),
      curves.flatMap((c) => c.points),
    );
    void setViewport(fitViewport(bounds, width, height, { minZoom, maxZoom }));
  }, [setViewport, getNodes, getNodesBounds, store]);
}
