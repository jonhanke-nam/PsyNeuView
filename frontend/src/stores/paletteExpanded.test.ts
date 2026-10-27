import { beforeEach, describe, expect, it } from "vitest";

// The suite runs on node, not jsdom: stub localStorage.
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

import { DEFAULT_EXPANDED, LS_EXPANDED, loadExpanded, usePaletteStore } from "./paletteStore";

describe("Components panel sections (#113)", () => {
  beforeEach(() => localStorage.clear());

  it("opens with every top-level section expanded", () => {
    expect(DEFAULT_EXPANDED).toEqual(["mechanisms", "projections", "compositions", "functions", "ports"]);
    expect([...loadExpanded()]).toEqual(DEFAULT_EXPANDED);
  });

  it("keeps the key under psyneuview.*", () => {
    expect(LS_EXPANDED.startsWith("psyneuview.")).toBe(true);
  });

  it("remembers a collapsed section", () => {
    usePaletteStore.setState({ expandedNodes: loadExpanded() });
    usePaletteStore.getState().toggleNode("projections");
    const reloaded = loadExpanded();
    expect(reloaded.has("projections")).toBe(false);
    expect(reloaded.has("mechanisms")).toBe(true);
  });

  it("remembers everything collapsed, rather than falling back to the default", () => {
    localStorage.setItem(LS_EXPANDED, "[]");
    expect(loadExpanded().size).toBe(0);
  });
});
