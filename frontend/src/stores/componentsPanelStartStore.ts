/**
 * How the Components panel first opens: Settings ▸ Appearance. (#113)
 *
 * Open as the word list by default (the search box and the sections, folded
 * closed), or as the narrow icon strip. This setting decides how the panel
 * opens; the panel's own ◀/▶ button collapses or opens it for the current
 * session without changing the setting (one control per setting), the same
 * way the graph legend's Show/Hide works (graphLegendStore). Remembered per
 * browser; inside the Mac app the app keeps `psyneuview.` keys across
 * launches. Storage can be blocked, so every access is wrapped and the
 * default stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export type ComponentsStart = "open" | "strip";

export const COMPONENTS_START_KEY = "psyneuview.components.start";
export const DEFAULT_COMPONENTS_START: ComponentsStart = "open";

export const COMPONENTS_STARTS: { id: ComponentsStart; label: string }[] = [
  { id: "open", label: "Starts open (the word list)" },
  { id: "strip", label: "Starts as the icon strip" },
];

export function isComponentsStart(v: unknown): v is ComponentsStart {
  return v === "open" || v === "strip";
}

export function loadComponentsStart(): ComponentsStart {
  try {
    const stored = localStorage.getItem(COMPONENTS_START_KEY);
    return isComponentsStart(stored) ? stored : DEFAULT_COMPONENTS_START;
  } catch {
    return DEFAULT_COMPONENTS_START;
  }
}

interface ComponentsStartState {
  start: ComponentsStart;
  setStart: (start: ComponentsStart) => void;
}

export const useComponentsStartStore = create<ComponentsStartState>((set) => ({
  start: loadComponentsStart(),
  setStart: (start) => {
    try {
      localStorage.setItem(COMPONENTS_START_KEY, start);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("components-start", start);
    set({ start });
  },
}));
