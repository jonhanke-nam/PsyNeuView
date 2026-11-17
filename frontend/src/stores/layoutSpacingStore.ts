/**
 * Settings ▸ Appearance ▸ Automatic layout ▸ Spacing between nodes (#278).
 *
 * How far apart an automatic layout puts nodes, so how long the lines between
 * them are. One setting for both layouts that have a spacing:
 *
 *  - Default: Compact for Layered; for Like show_graph, show_graph's own
 *    spacing, so its picture keeps matching show_graph's (#210).
 *  - Compact, Standard, Roomy: the same for both.
 *
 * Layered scales the gaps between its rows and between neighbours; Like
 * show_graph scales show_graph's picture and the least gaps kept between
 * boxes. Either way nodes never touch: the gaps that keep boxes apart (and
 * leave room for edge labels) still hold. Radial and Force are left alone.
 *
 * Remembered per browser; inside the Mac app the app keeps `psyneuview.`
 * keys across launches. Storage can be blocked, so every access is wrapped
 * and the default stands in.
 */

import { create } from "zustand";
import type { LayoutStyle } from "@/stores/graphSettingsStore";
import { recordSettingChanged } from "@/utils/activityLog";

export type LayoutSpacing = "default" | "compact" | "standard" | "roomy";

export const LAYOUT_SPACING_KEY = "psyneuview.graph.layoutSpacing";
export const DEFAULT_LAYOUT_SPACING: LayoutSpacing = "default";

export const LAYOUT_SPACINGS: { id: LayoutSpacing; label: string }[] = [
  { id: "default", label: "Compact for Layered; show_graph's own for Like show_graph" },
  { id: "compact", label: "Compact" },
  { id: "standard", label: "Standard" },
  { id: "roomy", label: "Roomy" },
];

/** How much each choice scales a layout's gaps. Standard is the layouts' own. */
const FACTOR: Record<Exclude<LayoutSpacing, "default">, number> = {
  compact: 0.6,
  standard: 1,
  roomy: 1.4,
};

export function isLayoutSpacing(v: unknown): v is LayoutSpacing {
  return v === "default" || v === "compact" || v === "standard" || v === "roomy";
}

/** The factor a layout's gaps are scaled by, for this setting. */
export function spacingFactor(style: LayoutStyle, spacing: LayoutSpacing): number {
  if (spacing === "default") return style === "showgraph" ? FACTOR.standard : FACTOR.compact;
  return FACTOR[spacing];
}

export function loadLayoutSpacing(): LayoutSpacing {
  try {
    const stored = localStorage.getItem(LAYOUT_SPACING_KEY);
    return isLayoutSpacing(stored) ? stored : DEFAULT_LAYOUT_SPACING;
  } catch {
    return DEFAULT_LAYOUT_SPACING;
  }
}

interface LayoutSpacingState {
  spacing: LayoutSpacing;
  setSpacing: (spacing: LayoutSpacing) => void;
}

export const useLayoutSpacingStore = create<LayoutSpacingState>((set) => ({
  spacing: loadLayoutSpacing(),
  setSpacing: (spacing) => {
    try {
      localStorage.setItem(LAYOUT_SPACING_KEY, spacing);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("graph-layout-spacing", spacing);
    set({ spacing });
  },
}));

/** The factor for a layout now, from the setting. */
export function currentSpacingFactor(style: LayoutStyle): number {
  return spacingFactor(style, useLayoutSpacingStore.getState().spacing);
}
