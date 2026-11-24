import { beforeEach, describe, expect, it, vi } from "vitest";

// The suite runs on node, not jsdom (vitest.config.ts): stub localStorage,
// as componentsPanelStart.test.ts does.
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

// The store reads storage when it loads, so each test loads it afresh.
async function load() {
  vi.resetModules();
  return import("./paletteStore");
}

describe("Favourites and recents in the icon strip (#372)", () => {
  beforeEach(() => localStorage.clear());

  it("are hidden by default", async () => {
    const { DEFAULT_STRIP_SHORTCUTS, loadStripShortcuts, usePaletteStore } = await load();
    expect(DEFAULT_STRIP_SHORTCUTS).toBe(false);
    expect(loadStripShortcuts()).toBe(false);
    expect(usePaletteStore.getState().showStripShortcuts).toBe(false);
  });

  it("keeps a stored choice across a reload", async () => {
    const first = await load();
    first.usePaletteStore.getState().setShowStripShortcuts(true);
    expect(localStorage.getItem(first.STRIP_SHORTCUTS_KEY)).toBe("true");
    const again = await load();
    expect(again.usePaletteStore.getState().showStripShortcuts).toBe(true);
    again.usePaletteStore.getState().setShowStripShortcuts(false);
    expect((await load()).usePaletteStore.getState().showStripShortcuts).toBe(false);
  });

  it("ignores anything else stored", async () => {
    localStorage.setItem("psyneuview.components.stripShortcuts", "maybe");
    expect((await load()).loadStripShortcuts()).toBe(false);
  });
});
