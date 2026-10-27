/**
 * How heavy the lines between nodes (projections) are: Settings ▸ Appearance
 * ▸ Lines between nodes. (#107)
 *
 * One setting, the width of an ordinary (Mapping) projection line, in whole
 * pixels. The rest follow from it:
 *  - other projection types keep their own weight relative to it (an inactive
 *    line stays lighter, a dangling one heavier);
 *  - a hovered line is EDGE_LINE_HOVER_EXTRA px heavier, a line under the
 *    stepping cursor EDGE_LINE_HIGHLIGHT_EXTRA px (a selected line changes
 *    colour, as before);
 *  - the arrowhead scales with the line (edgeArrowheadScale).
 * Scheduling-condition arrows are drawn separately and are not affected.
 *
 * Remembered per browser, like the node outline (nodeOutlineStore). Until a
 * width is chosen, the default is RENDERING_DEFAULTS.arrowLineThickness, which
 * /rendering-defaults.json may retune at startup (`setDefault`); a width
 * chosen here always wins.
 */

import { create } from "zustand";
import { RENDERING_DEFAULTS } from "@/config/renderingDefaults";
import { recordSettingChanged } from "@/utils/activityLog";

export const EDGE_LINE_KEY = "psyneuview.graph.edgeLineWidth";

export const EDGE_LINE_MIN = 1;
export const EDGE_LINE_MAX = 4;
/** The widths offered. */
export const EDGE_LINE_WIDTHS: number[] = Array.from(
  { length: EDGE_LINE_MAX - EDGE_LINE_MIN + 1 },
  (_, i) => EDGE_LINE_MIN + i,
);
/** How much heavier a hovered line is. */
export const EDGE_LINE_HOVER_EXTRA = 1;
/** How much heavier a line under the stepping cursor is. */
export const EDGE_LINE_HIGHLIGHT_EXTRA = 0.5;
/** The line width the Style tab's arrowhead size was tuned at. */
export const EDGE_LINE_ARROWHEAD_REFERENCE = 3;

/** How much to scale the arrowhead for a line of this width. */
export function edgeArrowheadScale(width: number): number {
  return width / EDGE_LINE_ARROWHEAD_REFERENCE;
}

/** A whole-pixel width inside the range, or null. */
export function toEdgeLineWidth(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(EDGE_LINE_MAX, Math.max(EDGE_LINE_MIN, Math.round(n)));
}

function load(): number | null {
  try {
    return toEdgeLineWidth(localStorage.getItem(EDGE_LINE_KEY));
  } catch {
    return null;
  }
}

interface EdgeLineState {
  /** The width chosen here, or null for the default. */
  chosen: number | null;
  defaultWidth: number;
  setWidth: (px: number) => void;
  /** The startup override retunes the default, never a chosen width. */
  setDefault: (px: unknown) => void;
}

export const useEdgeLineStore = create<EdgeLineState>((set) => ({
  chosen: load(),
  defaultWidth: toEdgeLineWidth(RENDERING_DEFAULTS.arrowLineThickness) ?? 3,
  setWidth: (px) => {
    const w = toEdgeLineWidth(px);
    if (w === null) return;
    try {
      localStorage.setItem(EDGE_LINE_KEY, String(w));
    } catch {
      // Storage blocked: the choice holds for this page only.
    }
    recordSettingChanged("edge-line-width", w);
    set({ chosen: w });
  },
  setDefault: (px) => set((s) => ({ defaultWidth: toEdgeLineWidth(px) ?? s.defaultWidth })),
}));

/** The ordinary line width in force. */
export function useEdgeLineWidth(): number {
  return useEdgeLineStore((s) => s.chosen ?? s.defaultWidth);
}
