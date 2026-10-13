import { beforeEach, describe, expect, it } from "vitest";

/**
 * The suite runs on node, not jsdom (see vitest.config.ts), so the two browser
 * APIs this module touches are stubbed rather than pulling in a DOM. Both are
 * small enough that a real DOM would add a dependency and buy nothing.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: new EventTarget(),
});

import {
  COLLAPSED_SECTIONS_KEY,
  DEFAULT_SECTION_ORDER,
  SECTION_LABELS,
  canMoveSection,
  catalogSectionId,
  normalizeSectionOrder,
  SECTION_ORDER_CHANGED,
  SECTION_ORDER_KEY,
  getCollapsedSectionsDefaultingToFolded,
  getSectionOrder,
  isDefaultOrder,
  isSectionVisible,
  isShownOnlyByDeveloperMode,
  persistSectionOrder,
  type SectionId,
} from "./openMenuOrder";

beforeEach(() => localStorage.clear());

describe("section order", () => {
  it("defaults to your models first, then PsyNeuLink's", () => {
    expect(getSectionOrder()).toEqual([
      "myModels", "library", "examples", "references", "demos",
    ]);
  });

  it("round-trips a reordering", () => {
    persistSectionOrder(["library", "myModels", "demos", "examples", "references"]);
    expect(getSectionOrder()).toEqual(["library", "myModels", "demos", "examples", "references"]);
  });

  it("appends a section added since the order was stored", () => {
    // A stored order written before `demos` existed. It must still render,
    // rather than silently vanishing because it isn't in the saved list.
    localStorage.setItem(
      SECTION_ORDER_KEY,
      JSON.stringify(["library", "myModels", "references", "examples"]),
    );
    const order = getSectionOrder();
    expect(order).toContain("demos");
    expect(order[0]).toBe("library"); // the user's choice still leads
    expect(order.indexOf("references")).toBeLessThan(order.indexOf("examples"));
    expect(new Set(order).size).toBe(DEFAULT_SECTION_ORDER.length);
  });

  it("drops a section that no longer exists", () => {
    localStorage.setItem(
      SECTION_ORDER_KEY,
      JSON.stringify(["retired", ...DEFAULT_SECTION_ORDER]),
    );
    expect(getSectionOrder()).toEqual([...DEFAULT_SECTION_ORDER]);
  });

  it("falls back to the default when storage holds junk", () => {
    localStorage.setItem(SECTION_ORDER_KEY, "{not json");
    expect(getSectionOrder()).toEqual([...DEFAULT_SECTION_ORDER]);
  });

  it("announces a change so Settings and the menu stay in step", () => {
    let heard = 0;
    const listen = () => (heard += 1);
    window.addEventListener(SECTION_ORDER_CHANGED, listen);
    persistSectionOrder(["library", "myModels", "examples", "references", "demos"]);
    window.removeEventListener(SECTION_ORDER_CHANGED, listen);
    expect(heard).toBe(1);
  });

  it("recognises the default order, so Reset only offers itself when it would do something", () => {
    expect(isDefaultOrder([...DEFAULT_SECTION_ORDER])).toBe(true);
    expect(isDefaultOrder(["library", "myModels", "examples", "references", "demos"])).toBe(false);
  });

  it("names every section", () => {
    for (const id of DEFAULT_SECTION_ORDER) {
      expect(SECTION_LABELS[id as SectionId]).toBeTruthy();
    }
  });
});

describe("folded by default", () => {
  it("starts every section folded on a first visit", () => {
    expect(getCollapsedSectionsDefaultingToFolded()).toEqual(
      new Set(DEFAULT_SECTION_ORDER),
    );
  });

  it("does not re-fold sections the user deliberately expanded", () => {
    // An empty array is a choice — "I opened everything" — and is different
    // from never having chosen. Re-folding here would undo it every session.
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, "[]");
    expect(getCollapsedSectionsDefaultingToFolded().size).toBe(0);
  });

  it("remembers a partial fold", () => {
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(["demos"]));
    expect(getCollapsedSectionsDefaultingToFolded()).toEqual(new Set(["demos"]));
  });
});

describe("the user's own catalogs in the order (#1229)", () => {
  const lab = catalogSectionId("abc123");

  it("go after the everyday built-in sections when first added, above the ones under development", () => {
    expect(getSectionOrder([lab])).toEqual(["myModels", "library", lab, "examples", "references", "demos"]);
  });

  it("keep a place they were moved to", () => {
    persistSectionOrder([lab, ...DEFAULT_SECTION_ORDER]);
    expect(getSectionOrder([lab])[0]).toBe(lab);
  });

  it("drop out once removed, leaving the rest in order", () => {
    persistSectionOrder([lab, ...DEFAULT_SECTION_ORDER]);
    expect(getSectionOrder([])).toEqual([...DEFAULT_SECTION_ORDER]);
  });

  it("count toward the default order only as added", () => {
    expect(isDefaultOrder(["myModels", "library", lab, "examples", "references", "demos"], [lab])).toBe(true);
    expect(isDefaultOrder([lab, ...DEFAULT_SECTION_ORDER], [lab])).toBe(false);
  });
});

describe("the catalogs under development stay below the everyday sections (#1295)", () => {
  const lab = catalogSectionId("abc123");

  it("puts right a stored order that had one above", () => {
    persistSectionOrder(["demos", "myModels", "library", "examples", "references"]);
    expect(getSectionOrder()).toEqual(["myModels", "library", "demos", "examples", "references"]);
    localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(["references", lab, "myModels", "library"]));
    expect(getSectionOrder([lab])).toEqual([lab, "myModels", "library", "references", "examples", "demos"]);
  });

  it("keeps the order within each half", () => {
    expect(normalizeSectionOrder(["demos", "library", "references", "myModels", "examples"])).toEqual([
      "library", "myModels", "demos", "references", "examples",
    ]);
  });

  it("allows a move within a half and refuses one across", () => {
    const order = ["myModels", "library", lab, "examples", "references", "demos"];
    expect(canMoveSection(order, 0, 2)).toBe(true); // My Project Folder below the catalog
    expect(canMoveSection(order, 5, 3)).toBe(true); // Demo Models to the top of its half
    expect(canMoveSection(order, 3, 2)).toBe(false); // Examples above the catalog
    expect(canMoveSection(order, 2, 3)).toBe(false); // the catalog below Examples
    expect(canMoveSection(order, 0, 0)).toBe(false);
  });
});

describe("marked as developer-mode only (#1291)", () => {
  const off = { developerMode: false, tourRunning: false, shown: new Set<string>() };
  const on = { ...off, developerMode: true };

  it("marks a catalog under development only when developer mode alone shows it", () => {
    expect(isSectionVisible("demos", on)).toBe(true);
    expect(isShownOnlyByDeveloperMode("demos", on)).toBe(true);
    // Hidden sections are not marked: there is nothing to mark.
    expect(isSectionVisible("demos", off)).toBe(false);
    expect(isShownOnlyByDeveloperMode("demos", off)).toBe(false);
  });

  it("does not mark one the user switched on in Settings, or one a walkthrough opened", () => {
    const switchedOn = { ...on, shown: new Set(["demos"]) };
    expect(isShownOnlyByDeveloperMode("demos", switchedOn)).toBe(false);
    expect(isShownOnlyByDeveloperMode("references", switchedOn)).toBe(true);
    expect(isShownOnlyByDeveloperMode("demos", { ...on, tourRunning: true })).toBe(false);
    // And neither is marked with developer mode off, even though both show.
    expect(isSectionVisible("demos", { ...off, shown: new Set(["demos"]) })).toBe(true);
    expect(isShownOnlyByDeveloperMode("demos", { ...off, shown: new Set(["demos"]) })).toBe(false);
    expect(isShownOnlyByDeveloperMode("demos", { ...off, tourRunning: true })).toBe(false);
  });

  it("never marks an everyday section or a user catalog", () => {
    expect(isShownOnlyByDeveloperMode("myModels", on)).toBe(false);
    expect(isShownOnlyByDeveloperMode("library", on)).toBe(false);
    expect(isShownOnlyByDeveloperMode(catalogSectionId("lab"), on)).toBe(false);
  });
});
