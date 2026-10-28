import { beforeEach, describe, expect, it, vi } from "vitest";

// The suite runs on node, not jsdom (vitest.config.ts): stub localStorage,
// as graphLegendStore.test.ts does.
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

// Both stores read storage when they load, so each test loads them afresh.
async function load() {
  vi.resetModules();
  const start = await import("./componentsPanelStartStore");
  const { usePaletteStore } = await import("./paletteStore");
  return { ...start, usePaletteStore };
}

describe("Components panel opening state (#113)", () => {
  beforeEach(() => localStorage.clear());

  it("opens as the word list by default, sections folded", async () => {
    const { DEFAULT_COMPONENTS_START, loadComponentsStart, usePaletteStore } = await load();
    expect(DEFAULT_COMPONENTS_START).toBe("open");
    expect(loadComponentsStart()).toBe("open");
    expect(usePaletteStore.getState().isCompact).toBe(false);
    expect(usePaletteStore.getState().expandedNodes.size).toBe(0);
  });

  it("starts as the icon strip when the setting says so", async () => {
    localStorage.setItem("psyneuview.components.start", "strip");
    const { loadComponentsStart, usePaletteStore } = await load();
    expect(loadComponentsStart()).toBe("strip");
    expect(usePaletteStore.getState().isCompact).toBe(true);
  });

  it("ignores anything else stored, and the old remembered strip", async () => {
    localStorage.setItem("psyneuview.components.start", "sideways");
    localStorage.setItem("psynewview_palette_compact", "true");
    const { loadComponentsStart, usePaletteStore } = await load();
    expect(loadComponentsStart()).toBe("open");
    expect(usePaletteStore.getState().isCompact).toBe(false);
  });

  it("the ◀/▶ button switches the panel for the session without remembering it", async () => {
    const { COMPONENTS_START_KEY, usePaletteStore } = await load();
    usePaletteStore.getState().toggleCompact();
    expect(usePaletteStore.getState().isCompact).toBe(true);
    usePaletteStore.getState().setCompact(true);
    expect(localStorage.getItem(COMPONENTS_START_KEY)).toBeNull();
    expect(localStorage.getItem("psynewview_palette_compact")).toBeNull();
    // A fresh start comes back open.
    const again = await load();
    expect(again.usePaletteStore.getState().isCompact).toBe(false);
  });

  it("setStart remembers the choice", async () => {
    const { COMPONENTS_START_KEY, isComponentsStart, useComponentsStartStore } = await load();
    useComponentsStartStore.getState().setStart("strip");
    expect(useComponentsStartStore.getState().start).toBe("strip");
    expect(localStorage.getItem(COMPONENTS_START_KEY)).toBe("strip");
    expect(isComponentsStart("open")).toBe(true);
    expect(isComponentsStart(undefined)).toBe(false);
  });
});
