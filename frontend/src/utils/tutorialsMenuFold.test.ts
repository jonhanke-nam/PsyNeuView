import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOLDED_SECTIONS,
  TUTORIALS_FOLDED_KEY,
  loadFoldedSections,
  saveFoldedSections,
  toggleFolded,
  unfoldActive,
} from "./tutorialsMenuFold";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe("Tutorials menu folding (#8)", () => {
  it("first run folds all but First Steps", () => {
    expect([...loadFoldedSections(storage())].sort()).toEqual([...DEFAULT_FOLDED_SECTIONS].sort());
    expect(loadFoldedSections(storage()).has("orientation")).toBe(false);
  });

  it("an empty stored list means everything open, and stays that way", () => {
    expect(loadFoldedSections(storage({ [TUTORIALS_FOLDED_KEY]: "[]" })).size).toBe(0);
  });

  it("round-trips through storage", () => {
    const s = storage();
    saveFoldedSections(new Set(["course"]), s);
    expect([...loadFoldedSections(s)]).toEqual(["course"]);
  });

  it("falls back to the default on unreadable or blocked storage", () => {
    expect(loadFoldedSections(storage({ [TUTORIALS_FOLDED_KEY]: "{not json" })).has("course")).toBe(true);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadFoldedSections(throwing).has("general")).toBe(true);
    expect(() => saveFoldedSections(new Set(), throwing)).not.toThrow();
  });

  it("toggles one section", () => {
    expect([...toggleFolded(new Set(["course"]), "course")]).toEqual([]);
    expect([...toggleFolded(new Set(), "general")]).toEqual(["general"]);
  });

  it("opens the running walkthrough's section", () => {
    const groups = [
      { id: "orientation", walkthroughs: [{ id: "orientation-window" }] },
      { id: "course", walkthroughs: [{ id: "ego" }] },
    ];
    expect([...unfoldActive(new Set(["course"]), groups, "ego")]).toEqual([]);
    const folded = new Set(["course"]);
    expect(unfoldActive(folded, groups, null)).toBe(folded);
    expect(unfoldActive(folded, groups, "orientation-window")).toBe(folded);
  });
});
