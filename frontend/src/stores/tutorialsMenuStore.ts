/**
 * What the Tutorials menu lists: Settings ▸ Tutorials and Voice ▸ Tutorials ▸
 * Hide the Cognitive Neuroscience Course (#136).
 *
 * The course's walkthroughs are one section of the menu, for people taking
 * the course. Most aren't, so the section is hidden by default and someone
 * taking the course turns it back on by unticking the box. Hiding is about the menu only: a
 * course walkthrough opened by link (`?tour=…`) still runs, since `?tour=`
 * looks the walkthrough up directly rather than through the menu.
 *
 * Remembered per browser, like the highlight settings (tourHighlightStore.ts);
 * the Mac app keeps `psyneuview.*` keys across launches (#218). Storage can be
 * blocked, so every access is wrapped and the default stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

/** The one place the default lives: true hides the course, false shows it. */
export const DEFAULT_HIDE_COURSE = true;

export const HIDE_COURSE_KEY = "psyneuview.tutorials.hideCourse";

/** The menu section the setting hides, and nothing else. */
export const COURSE_GROUP_ID = "course";

export function loadHideCourse(): boolean {
  try {
    const v = localStorage.getItem(HIDE_COURSE_KEY);
    // Anything but an explicit choice reads as the default.
    return v === "on" ? true : v === "off" ? false : DEFAULT_HIDE_COURSE;
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
