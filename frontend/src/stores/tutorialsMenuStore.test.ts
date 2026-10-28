/**
 * Settings ▸ Tutorials and Voice ▸ Tutorials ▸ Hide the Cognitive
 * Neuroscience Course (#136): off by default, remembered per browser, and it
 * hides only the course's section of the Tutorials menu.
 */
import { beforeEach, describe, expect, it } from "vitest";

// The suite runs on node, not jsdom (vitest.config.ts): stub localStorage,
// as componentsPanelStart.test.ts does.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (stored.has(k) ? stored.get(k)! : null),
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
});

import {
  COURSE_GROUP_ID,
  DEFAULT_HIDE_COURSE,
  HIDE_COURSE_KEY,
  loadHideCourse,
  useTutorialsMenuStore,
  visibleMenuGroups,
} from "./tutorialsMenuStore";
import { menuGroups } from "@/utils/tourStep";

describe("tutorialsMenuStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTutorialsMenuStore.setState({ hideCourse: loadHideCourse() });
  });

  it("shows the course by default, and the default is one constant", () => {
    expect(DEFAULT_HIDE_COURSE).toBe(false);
    expect(loadHideCourse()).toBe(DEFAULT_HIDE_COURSE);
    expect(useTutorialsMenuStore.getState().hideCourse).toBe(DEFAULT_HIDE_COURSE);
  });

  it("remembers the choice under a psyneuview.* key", () => {
    useTutorialsMenuStore.getState().setHideCourse(true);
    expect(localStorage.getItem(HIDE_COURSE_KEY)).toBe("on");
    expect(HIDE_COURSE_KEY.startsWith("psyneuview.")).toBe(true);
    expect(loadHideCourse()).toBe(true);
    useTutorialsMenuStore.getState().setHideCourse(false);
    expect(localStorage.getItem(HIDE_COURSE_KEY)).toBe("off");
    expect(loadHideCourse()).toBe(false);
  });

  it("ignores a value it does not recognise", () => {
    localStorage.setItem(HIDE_COURSE_KEY, "maybe");
    expect(loadHideCourse()).toBe(false);
  });

  it("hides only the course's section, leaving every other section alone", () => {
    const groups = [
      { id: "orientation", title: "PsyNeuView First Steps" },
      { id: "general", title: "Getting started" },
      { id: COURSE_GROUP_ID, title: "Cognitive Neuroscience Course" },
      // A section another change might add later passes through untouched.
      { id: "pnl-tutorials", title: "PsyNeuLink Tutorials" },
    ];
    expect(visibleMenuGroups(groups, false)).toBe(groups);
    expect(visibleMenuGroups(groups, true).map((g) => g.id)).toEqual(["orientation", "general", "pnl-tutorials"]);
  });

  it("drops the shipped course section from the real menu groups", () => {
    const all = menuGroups();
    expect(all.some((g) => g.id === COURSE_GROUP_ID)).toBe(true);
    const shown = visibleMenuGroups(all, true);
    expect(shown.some((g) => g.id === COURSE_GROUP_ID)).toBe(false);
    expect(shown.length).toBe(all.length - 1);
  });
});
