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

  it("opens as the icon strip by default (#345)", async () => {
    const { DEFAULT_COMPONENTS_START, loadComponentsStart, usePaletteStore } = await load();
    expect(DEFAULT_COMPONENTS_START).toBe("strip");
    expect(loadComponentsStart()).toBe("strip");
    expect(usePaletteStore.getState().isCompact).toBe(true);
  });

  it("keeps a stored word-list choice, sections folded (#345)", async () => {
    localStorage.setItem("psyneuview.components.start", "open");
    const { loadComponentsStart, usePaletteStore } = await load();
    expect(loadComponentsStart()).toBe("open");
    expect(usePaletteStore.getState().isCompact).toBe(false);
    expect(usePaletteStore.getState().expandedNodes.size).toBe(0);
  });

  it("lists the icon strip first in Settings (#345)", async () => {
    const { COMPONENTS_STARTS } = await load();
    expect(COMPONENTS_STARTS.map((c) => c.id)).toEqual(["strip", "open"]);
  });

  it("ignores anything else stored, and the old remembered strip", async () => {
    localStorage.setItem("psyneuview.components.start", "sideways");
    localStorage.setItem("psyneuview_palette_compact", "false");
    const { loadComponentsStart, usePaletteStore } = await load();
    expect(loadComponentsStart()).toBe("strip");
    expect(usePaletteStore.getState().isCompact).toBe(true);
  });

  it("the ◀/› button switches the panel for the session without remembering it", async () => {
    const { COMPONENTS_START_KEY, usePaletteStore } = await load();
    usePaletteStore.getState().toggleCompact();
    expect(usePaletteStore.getState().isCompact).toBe(false);
    usePaletteStore.getState().setCompact(false);
    expect(localStorage.getItem(COMPONENTS_START_KEY)).toBeNull();
    expect(localStorage.getItem("psyneuview_palette_compact")).toBeNull();
    // A fresh start comes back as the strip.
    const again = await load();
    expect(again.usePaletteStore.getState().isCompact).toBe(true);
  });

  it("setStart remembers the choice", async () => {
    const { COMPONENTS_START_KEY, isComponentsStart, useComponentsStartStore } = await load();
    useComponentsStartStore.getState().setStart("open");
    expect(useComponentsStartStore.getState().start).toBe("open");
    expect(localStorage.getItem(COMPONENTS_START_KEY)).toBe("open");
    expect(isComponentsStart("open")).toBe(true);
    expect(isComponentsStart(undefined)).toBe(false);
  });
});
