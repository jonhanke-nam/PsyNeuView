/**
 * Edge courses from show_graph's own drawing, for the "Like show_graph" layout
 * (#23). Set when that layout is applied, cleared when any other is.
 *
 * Each curve is in flow coordinates and belongs to the node positions it was
 * made for: an edge draws it only while its two nodes are still there, so
 * moving a node hands its edges back to normal routing at once.
 */

import { create } from "zustand";

export interface Point {
  x: number;
  y: number;
}

export interface ShowGraphCurve {
  /** The course, from the source box's edge to the target box's edge. */
  points: Point[];
  /** Where the source and target nodes were (absolute top-left) when it was made. */
  source: Point;
  target: Point;
}

interface ShowGraphCurvesState {
  curves: Record<string, ShowGraphCurve>;
  setCurves: (curves: Record<string, ShowGraphCurve>) => void;
  clear: () => void;
}

export const useShowGraphCurves = create<ShowGraphCurvesState>((set, get) => ({
  curves: {},
  setCurves: (curves) => set({ curves }),
  clear: () => {
    if (Object.keys(get().curves).length) set({ curves: {} });
  },
}));

/** Whether a curve still fits: both nodes are where it was made for. */
export function curveFits(curve: ShowGraphCurve, source: Point | undefined, target: Point | undefined): boolean {
  const near = (a: Point, b: Point | undefined) => !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  return near(curve.source, source) && near(curve.target, target);
}
