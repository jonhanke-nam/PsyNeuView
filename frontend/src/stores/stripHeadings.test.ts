import { beforeEach, describe, expect, it, vi } from "vitest";

// The suite runs on node, not jsdom (vitest.config.ts): stub localStorage,
// as stripShortcuts.test.ts does.
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

describe("Headings in the icon strip (#395)", () => {
  beforeEach(() => localStorage.clear());

  it("are off by default", async () => {
    const { DEFAULT_STRIP_HEADINGS, loadStripHeadings, usePaletteStore } = await load();
    expect(DEFAULT_STRIP_HEADINGS).toBe(false);
    expect(loadStripHeadings()).toBe(false);
    expect(usePaletteStore.getState().showStripHeadings).toBe(false);
  });

  it("keep a stored choice across a reload", async () => {
    const first = await load();
    first.usePaletteStore.getState().setShowStripHeadings(true);
    expect(localStorage.getItem(first.STRIP_HEADINGS_KEY)).toBe("true");
    const again = await load();
    expect(again.usePaletteStore.getState().showStripHeadings).toBe(true);
    again.usePaletteStore.getState().setShowStripHeadings(false);
    expect((await load()).usePaletteStore.getState().showStripHeadings).toBe(false);
  });

  it("ignore anything else stored", async () => {
    localStorage.setItem("psyneuview.components.stripHeadings", "maybe");
    expect((await load()).loadStripHeadings()).toBe(false);
  });

  it("are a separate choice from the shortcuts", async () => {
    const s = (await load()).usePaletteStore;
    s.getState().setShowStripHeadings(true);
    expect(s.getState().showStripShortcuts).toBe(false);
  });
});
