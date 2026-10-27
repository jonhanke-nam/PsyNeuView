import { describe, expect, it } from "vitest";

// The suite runs on node, not jsdom: stub localStorage before the store loads.
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

import { usePaletteStore } from "./paletteStore";

// #113: with nothing stored, the Components panel opens as the full panel
// (search box + the list of sections), not the narrow icon strip, and every
// section is folded closed.
describe("Components panel opening state (#113)", () => {
  it("opens as the full panel with sections closed", () => {
    const s = usePaletteStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.isCompact).toBe(false);
    expect(s.expandedNodes.size).toBe(0);
  });

  it("remembers switching to the strip", () => {
    usePaletteStore.getState().toggleCompact();
    expect(localStorage.getItem("psynewview_palette_compact")).toBe("true");
  });
});
