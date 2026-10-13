/**
 * How the graph view's legend first opens: Settings ▸ Appearance. (#7)
 *
 * Collapsed by default: the legend took canvas room on every model with
 * graph-structure conditions. This setting decides how it opens; the
 * legend's own Show/Hide folds it for the current view, without changing
 * the setting (one control per setting). Remembered per browser, like the
 * pointer (graphPointerStore); inside the Mac app the app keeps
 * `psyneuview.` keys across launches. Storage can be blocked, so every
 * access is wrapped and the default stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export type LegendStart = "collapsed" | "expanded";

export const LEGEND_START_KEY = "psyneuview.graph.legendStart";
export const DEFAULT_LEGEND_START: LegendStart = "collapsed";

export const LEGEND_STARTS: { id: LegendStart; label: string }[] = [
  { id: "collapsed", label: "Starts collapsed" },
  { id: "expanded", label: "Starts expanded" },
];

export function isLegendStart(v: unknown): v is LegendStart {
  return v === "collapsed" || v === "expanded";
}

export function loadLegendStart(): LegendStart {
  try {
    const stored = localStorage.getItem(LEGEND_START_KEY);
    return isLegendStart(stored) ? stored : DEFAULT_LEGEND_START;
  } catch {
    return DEFAULT_LEGEND_START;
  }
}

interface GraphLegendState {
  start: LegendStart;
  setStart: (start: LegendStart) => void;
}

export const useGraphLegendStore = create<GraphLegendState>((set) => ({
  start: loadLegendStart(),
  setStart: (start) => {
    try {
      localStorage.setItem(LEGEND_START_KEY, start);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("graph-legend-start", start);
    set({ start });
  },
}));
