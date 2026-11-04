/**
 * Whether a node shows its "view only" tag: Settings ▸ Appearance ▸ Node
 * tags. (#211)
 *
 * A node whose declaration PsyNeuView can't edit (built in a loop, unpacked
 * from a list, made by a learning pathway…) carried a small "view only" tag
 * above its name. PsyNeuLink's show_graph() draws no such tag, so it is hidden
 * by default; the node's hover text and the Inspector's notice say the same
 * thing either way. The type and role tags have their own switch, in the
 * graph's Advanced Graph View Options (#122, #123). Remembered per browser,
 * like the scheduling arrows (schedulingArrowsStore); inside the Mac app the
 * app keeps `psyneuview.` keys across launches. Storage can be blocked, so
 * every access is wrapped and the default stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export type ViewOnlyTags = "hidden" | "shown";

export const VIEW_ONLY_TAGS_KEY = "psyneuview.graph.viewOnlyTags";
export const DEFAULT_VIEW_ONLY_TAGS: ViewOnlyTags = "hidden";

export const VIEW_ONLY_TAGS: { id: ViewOnlyTags; label: string }[] = [
  { id: "hidden", label: "Hidden, as in show_graph" },
  { id: "shown", label: "Shown" },
];

export function isViewOnlyTags(v: unknown): v is ViewOnlyTags {
  return v === "hidden" || v === "shown";
}

export function loadViewOnlyTags(): ViewOnlyTags {
  try {
    const stored = localStorage.getItem(VIEW_ONLY_TAGS_KEY);
    return isViewOnlyTags(stored) ? stored : DEFAULT_VIEW_ONLY_TAGS;
  } catch {
    return DEFAULT_VIEW_ONLY_TAGS;
  }
}

interface ViewOnlyTagsState {
  tags: ViewOnlyTags;
  setTags: (tags: ViewOnlyTags) => void;
}

export const useViewOnlyTagsStore = create<ViewOnlyTagsState>((set) => ({
  tags: loadViewOnlyTags(),
  setTags: (tags) => {
    try {
      localStorage.setItem(VIEW_ONLY_TAGS_KEY, tags);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("graph-view-only-tags", tags);
    set({ tags });
  },
}));
