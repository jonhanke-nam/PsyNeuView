/**
 * How heavy node outlines are: Settings ▸ Appearance ▸ Node outlines. (#42)
 *
 * Two widths: the ordinary one, and the emphasised one for INPUT, OUTPUT and
 * CONTROL nodes. Remembered per browser, like the pointer (graphPointerStore):
 * a personal preference on a backend several people may share. Storage can be
 * blocked, so every access is wrapped and the defaults stand in.
 *
 * Until a width is chosen here, the defaults are RENDERING_DEFAULTS, which the
 * runtime override (/rendering-defaults.json, #912) may retune at startup
 * (`setDefaults`). A width chosen here always wins over both.
 */

import { create } from "zustand";
import { RENDERING_DEFAULTS } from "@/config/renderingDefaults";
import { recordSettingChanged } from "@/utils/activityLog";

export const NODE_OUTLINE_KEY = "psyneuview.graph.nodeOutline";
export const NODE_OUTLINE_EMPHASIS_KEY = "psyneuview.graph.nodeOutlineEmphasis";

export const NODE_OUTLINE_MIN = 0.5;
export const NODE_OUTLINE_MAX = 6;
/** The widths offered, in half pixels. */
export const NODE_OUTLINE_WIDTHS: number[] = Array.from(
  { length: (NODE_OUTLINE_MAX - NODE_OUTLINE_MIN) * 2 + 1 },
  (_, i) => NODE_OUTLINE_MIN + i / 2,
);
/** How much heavier a selected or running node's outline is than its own. */
export const NODE_OUTLINE_SELECTED_EXTRA = 1.5;

/** A width on the half-pixel grid inside the range, or null. */
export function toOutlineWidth(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === "" || !Number.isFinite(n)) return null;
  const half = Math.round(n * 2) / 2;
  return Math.min(NODE_OUTLINE_MAX, Math.max(NODE_OUTLINE_MIN, half));
}

function load(key: string): number | null {
  try {
    return toOutlineWidth(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function remember(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage blocked: the choice holds for this page only.
  }
}

interface NodeOutlineState {
  /** The width chosen here, or null for the default. */
  chosen: number | null;
  chosenEmphasis: number | null;
  defaultWidth: number;
  defaultEmphasis: number;
  setWidth: (px: number) => void;
  setEmphasis: (px: number) => void;
  /** The startup override retunes the defaults, never a chosen width. */
  setDefaults: (d: { width?: number; emphasis?: number }) => void;
}

export const useNodeOutlineStore = create<NodeOutlineState>((set) => ({
  chosen: load(NODE_OUTLINE_KEY),
  chosenEmphasis: load(NODE_OUTLINE_EMPHASIS_KEY),
  defaultWidth: RENDERING_DEFAULTS.nodeBorderWidth,
  defaultEmphasis: RENDERING_DEFAULTS.nodeBorderWidthEmphasis,
  setWidth: (px) => {
    const w = toOutlineWidth(px);
    if (w === null) return;
    remember(NODE_OUTLINE_KEY, w);
    recordSettingChanged("node-outline", w);
    set({ chosen: w });
  },
  setEmphasis: (px) => {
    const w = toOutlineWidth(px);
    if (w === null) return;
    remember(NODE_OUTLINE_EMPHASIS_KEY, w);
    recordSettingChanged("node-outline-emphasis", w);
    set({ chosenEmphasis: w });
  },
  setDefaults: (d) =>
    set((s) => ({
      defaultWidth: toOutlineWidth(d.width) ?? s.defaultWidth,
      defaultEmphasis: toOutlineWidth(d.emphasis) ?? s.defaultEmphasis,
    })),
}));

/** The ordinary outline width in force. */
export function useNodeOutlineWidth(): number {
  return useNodeOutlineStore((s) => s.chosen ?? s.defaultWidth);
}

/** The emphasised (INPUT/OUTPUT/CONTROL) outline width in force. */
export function useNodeOutlineEmphasis(): number {
  return useNodeOutlineStore((s) => s.chosenEmphasis ?? s.defaultEmphasis);
}
