/**
 * How heavy node outlines are: Settings ▸ Appearance ▸ Node outlines. (#42)
 *
 * One setting, the outline width of an ordinary node, in whole pixels; the
 * others follow from it, so they stay heavier at every width:
 *  - INPUT, OUTPUT and CONTROL nodes (when coloured by role): width + 2 px;
 *  - a selected or running node: its own outline + 2 px.
 * Whole pixels because Chrome draws a border at whole pixels, rounding down
 * even on Retina: a 3.5 px outline shows as 3 px.
 *
 * Remembered per browser, like the pointer (graphPointerStore): a personal
 * preference on a backend several people may share. Storage can be blocked,
 * so every access is wrapped and the default stands in. Until a width is
 * chosen, the default is RENDERING_DEFAULTS.nodeBorderWidth, which the
 * runtime override (/rendering-defaults.json, #912) may retune at startup
 * (`setDefault`); a width chosen here always wins.
 */

import { create } from "zustand";
import { RENDERING_DEFAULTS } from "@/config/renderingDefaults";
import { recordSettingChanged } from "@/utils/activityLog";

export const NODE_OUTLINE_KEY = "psyneuview.graph.nodeOutline";

export const NODE_OUTLINE_MIN = 1;
export const NODE_OUTLINE_MAX = 6;
/** The widths offered. */
export const NODE_OUTLINE_WIDTHS: number[] = Array.from(
  { length: NODE_OUTLINE_MAX - NODE_OUTLINE_MIN + 1 },
  (_, i) => NODE_OUTLINE_MIN + i,
);
/** How much heavier an INPUT/OUTPUT/CONTROL node's outline is. */
export const NODE_OUTLINE_EMPHASIS_EXTRA = 2;
/** How much heavier a selected or running node's outline is than its own. */
export const NODE_OUTLINE_SELECTED_EXTRA = 2;

/** A whole-pixel width inside the range, or null. */
export function toOutlineWidth(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(NODE_OUTLINE_MAX, Math.max(NODE_OUTLINE_MIN, Math.round(n)));
}

function load(): number | null {
  try {
    return toOutlineWidth(localStorage.getItem(NODE_OUTLINE_KEY));
  } catch {
    return null;
  }
}

interface NodeOutlineState {
  /** The width chosen here, or null for the default. */
  chosen: number | null;
  defaultWidth: number;
  setWidth: (px: number) => void;
  /** The startup override retunes the default, never a chosen width. */
  setDefault: (px: unknown) => void;
}

export const useNodeOutlineStore = create<NodeOutlineState>((set) => ({
  chosen: load(),
  defaultWidth: toOutlineWidth(RENDERING_DEFAULTS.nodeBorderWidth) ?? 2,
  setWidth: (px) => {
    const w = toOutlineWidth(px);
    if (w === null) return;
    try {
      localStorage.setItem(NODE_OUTLINE_KEY, String(w));
    } catch {
      // Storage blocked: the choice holds for this page only.
    }
    recordSettingChanged("node-outline", w);
    set({ chosen: w });
  },
  setDefault: (px) => set((s) => ({ defaultWidth: toOutlineWidth(px) ?? s.defaultWidth })),
}));

/** The ordinary outline width in force. */
export function useNodeOutlineWidth(): number {
  return useNodeOutlineStore((s) => s.chosen ?? s.defaultWidth);
}
