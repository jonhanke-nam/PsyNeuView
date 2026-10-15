/**
 * Which automatic layout the graph view opens with: Settings ▸ Appearance ▸
 * Automatic layout (#19).
 *
 * "Like show_graph" is the default (#24): every model is arranged the way
 * PsyNeuLink's show_graph() draws it, edges included. Layered (Dagre) is the
 * fallback while show_graph's answer is on its way, and the one to pick for
 * rows strictly by role. The layout menu on the graph
 * toolbar switches the model you have open, without changing this setting
 * (one control per setting, like the legend's own Show/Hide). Remembered per
 * browser; inside the Mac app the app keeps `psyneuview.` keys across
 * launches. Storage can be blocked, so every access is wrapped and the
 * default stands in.
 */

import { create } from "zustand";
import type { LayoutStyle } from "@/stores/graphSettingsStore";
import { recordSettingChanged } from "@/utils/activityLog";

export const LAYOUT_DEFAULT_KEY = "psyneuview.graph.layoutDefault";
export const DEFAULT_LAYOUT_STYLE: LayoutStyle = "showgraph";

export const LAYOUT_STYLES: { id: LayoutStyle; label: string; hint: string }[] = [
  { id: "layered", label: "Layered", hint: "Rows from inputs at the bottom to outputs at the top" },
  { id: "showgraph", label: "Like show_graph", hint: "The arrangement PsyNeuLink's show_graph() draws" },
  { id: "radial", label: "Radial", hint: "Rings outward from the inputs" },
  { id: "force", label: "Force", hint: "Connected nodes pulled together" },
];

export function isLayoutStyle(v: unknown): v is LayoutStyle {
  return LAYOUT_STYLES.some((s) => s.id === v);
}

export function loadLayoutDefault(): LayoutStyle {
  try {
    const stored = localStorage.getItem(LAYOUT_DEFAULT_KEY);
    return isLayoutStyle(stored) ? stored : DEFAULT_LAYOUT_STYLE;
  } catch {
    return DEFAULT_LAYOUT_STYLE;
  }
}

interface GraphLayoutDefaultState {
  style: LayoutStyle;
  setStyle: (style: LayoutStyle) => void;
}

export const useGraphLayoutDefaultStore = create<GraphLayoutDefaultState>((set) => ({
  style: loadLayoutDefault(),
  setStyle: (style) => {
    try {
      localStorage.setItem(LAYOUT_DEFAULT_KEY, style);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("graph-layout-default", style);
    set({ style });
  },
}));
