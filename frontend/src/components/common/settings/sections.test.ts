import { beforeEach, describe, expect, it } from "vitest";

/**
 * Node, not jsdom (vitest.config.ts): the storage and window this module
 * touches are stubbed, small enough that a DOM would buy nothing.
 */
const store = new Map<string, string>();
let storageBroken = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => {
      if (storageBroken) throw new Error("blocked");
      return store.has(k) ? store.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      if (storageBroken) throw new Error("blocked");
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: new EventTarget(),
});

import {
  DEFAULT_SETTINGS_SECTION,
  LAST_SECTION_KEY,
  SETTINGS_SECTIONS,
  availableSectionOrDefault,
  availableSections,
  loadLastSection,
  onOpenSettings,
  openSettings,
  persistLastSection,
} from "./sections";

beforeEach(() => {
  store.clear();
  storageBroken = false;
});

describe("Settings sections (#1290)", () => {
  it("lists About first and Developer last, with Appearance right after General (#1301)", () => {
    expect(SETTINGS_SECTIONS[0].id).toBe("about");
    expect(SETTINGS_SECTIONS[1].id).toBe("general");
    expect(SETTINGS_SECTIONS[2].id).toBe("appearance");
    expect(SETTINGS_SECTIONS[3].id).toBe("tutorials-voice");
    expect(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id).toBe("developer");
    expect(DEFAULT_SETTINGS_SECTION).toBe("about");
  });

  it("lists Problem reports only inside the Mac app, and falls back to About elsewhere (#1295)", () => {
    expect(availableSections(true).map((s) => s.id)).toEqual([
      "about", "general", "appearance", "tutorials-voice", "open-menu", "folders", "shortcuts", "reports", "developer",
    ]);
    expect(availableSections(false).map((s) => s.id)).toEqual([
      "about", "general", "appearance", "tutorials-voice", "open-menu", "folders", "shortcuts", "developer",
    ]);
    expect(availableSectionOrDefault("reports", true)).toBe("reports");
    expect(availableSectionOrDefault("reports", false)).toBe("about");
    expect(availableSectionOrDefault("folders", false)).toBe("folders");
    expect(availableSectionOrDefault(null, false)).toBe("about");
  });

  it("reopens on the section shown last", () => {
    expect(loadLastSection()).toBe("about");
    persistLastSection("developer");
    expect(loadLastSection()).toBe("developer");
  });

  it("falls back to About on a stored value that is not a section, or no storage at all", () => {
    localStorage.setItem(LAST_SECTION_KEY, "mac-app");
    expect(loadLastSection()).toBe("about");
    storageBroken = true;
    expect(loadLastSection()).toBe("about");
    expect(() => persistLastSection("general")).not.toThrow();
  });

  it("opens at a named section, or the last one when none is named", () => {
    const seen: (string | null)[] = [];
    const off = onOpenSettings((s) => seen.push(s));
    openSettings("developer");
    openSettings();
    window.dispatchEvent(new CustomEvent("psyneuview:open-settings", { detail: { section: "nonsense" } }));
    off();
    openSettings("about");
    expect(seen).toEqual(["developer", null, null]);
  });
});
