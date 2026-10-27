/**
 * Whether the graph view draws scheduling-condition arrows: Settings ▸
 * Appearance. (#53)
 *
 * The dashed arrows show graph-structure conditions (before, after, +edge…).
 * PsyNeuLink's show_graph() doesn't draw them, so a canvas without them
 * matches show_graph's picture. Hidden by default since #123 (the clean look,
 * #109); a choice someone already stored wins, so "shown" stays shown. The
 * Scheduler panel lists the conditions either way. Remembered per browser,
 * like the legend (graphLegendStore); storage can be blocked, so every access
 * is wrapped and the default stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export type SchedulingArrows = "shown" | "hidden";

export const SCHEDULING_ARROWS_KEY = "psyneuview.graph.schedulingArrows";
export const DEFAULT_SCHEDULING_ARROWS: SchedulingArrows = "hidden";

export const SCHEDULING_ARROWS: { id: SchedulingArrows; label: string }[] = [
  { id: "shown", label: "Shown" },
  { id: "hidden", label: "Hidden, as in show_graph" },
];

export function isSchedulingArrows(v: unknown): v is SchedulingArrows {
  return v === "shown" || v === "hidden";
}

export function loadSchedulingArrows(): SchedulingArrows {
  try {
    const stored = localStorage.getItem(SCHEDULING_ARROWS_KEY);
    return isSchedulingArrows(stored) ? stored : DEFAULT_SCHEDULING_ARROWS;
  } catch {
    return DEFAULT_SCHEDULING_ARROWS;
  }
}

interface SchedulingArrowsState {
  arrows: SchedulingArrows;
  setArrows: (arrows: SchedulingArrows) => void;
}

export const useSchedulingArrowsStore = create<SchedulingArrowsState>((set) => ({
  arrows: loadSchedulingArrows(),
  setArrows: (arrows) => {
    try {
      localStorage.setItem(SCHEDULING_ARROWS_KEY, arrows);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("graph-scheduling-arrows", arrows);
    set({ arrows });
  },
}));
