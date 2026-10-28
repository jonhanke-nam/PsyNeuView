/**
 * What the Tutorials menu lists: Settings ▸ Tutorials and Voice ▸ Tutorials ▸
 * Hide the Cognitive Neuroscience Course (#136).
 *
 * The course's walkthroughs are one section of the menu. Someone who isn't
 * taking the course can hide that section; the setting is off by default, so
 * the course shows unless asked otherwise. Hiding is about the menu only: a
 * course walkthrough opened by link (`?tour=…`) still runs, since `?tour=`
 * looks the walkthrough up directly rather than through the menu.
 *
 * Remembered per browser, like the highlight settings (tourHighlightStore.ts);
 * the Mac app keeps `psyneuview.*` keys across launches (#218). Storage can be
 * blocked, so every access is wrapped and the default stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

/** The one place the default lives: false shows the course, true hides it. */
export const DEFAULT_HIDE_COURSE = false;

export const HIDE_COURSE_KEY = "psyneuview.tutorials.hideCourse";

/** The menu section the setting hides, and nothing else. */
export const COURSE_GROUP_ID = "course";

export function loadHideCourse(): boolean {
  try {
    const v = localStorage.getItem(HIDE_COURSE_KEY);
    return v === null ? DEFAULT_HIDE_COURSE : v === "on";
  } catch {
    return DEFAULT_HIDE_COURSE;
  }
}

function remember(value: boolean): void {
  try {
    localStorage.setItem(HIDE_COURSE_KEY, value ? "on" : "off");
  } catch {
    // Storage blocked: the choice holds for this page. Nothing else to do.
  }
}

/**
 * The menu's sections with the course left out when it is hidden. Only the
 * section with the course's id goes; any other section passes through
 * untouched.
 */
export function visibleMenuGroups<G extends { id: string }>(groups: G[], hideCourse: boolean): G[] {
  return hideCourse ? groups.filter((g) => g.id !== COURSE_GROUP_ID) : groups;
}

interface TutorialsMenuState {
  hideCourse: boolean;
  setHideCourse: (hide: boolean) => void;
}

export const useTutorialsMenuStore = create<TutorialsMenuState>((set) => ({
  hideCourse: loadHideCourse(),
  setHideCourse: (hideCourse) => {
    remember(hideCourse);
    recordSettingChanged("tutorials-hide-course", hideCourse ? "on" : "off");
    set({ hideCourse });
  },
}));
