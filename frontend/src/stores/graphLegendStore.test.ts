import { beforeEach, describe, expect, it } from "vitest";

// The suite runs on node, not jsdom (vitest.config.ts): stub localStorage,
// as openMenuOrder.test.ts does.
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

import { DEFAULT_LEGEND_START, LEGEND_START_KEY, isLegendStart, loadLegendStart, useGraphLegendStore } from "./graphLegendStore";

describe("graph legend opening state (#7)", () => {
  beforeEach(() => localStorage.clear());

  it("starts collapsed when nothing is stored", () => {
    expect(DEFAULT_LEGEND_START).toBe("collapsed");
    expect(loadLegendStart()).toBe("collapsed");
  });

  it("reads a stored choice, and ignores anything else", () => {
    localStorage.setItem(LEGEND_START_KEY, "expanded");
    expect(loadLegendStart()).toBe("expanded");
    localStorage.setItem(LEGEND_START_KEY, "sideways");
    expect(loadLegendStart()).toBe("collapsed");
  });

  it("setStart remembers the choice", () => {
    useGraphLegendStore.getState().setStart("expanded");
    expect(useGraphLegendStore.getState().start).toBe("expanded");
    expect(localStorage.getItem(LEGEND_START_KEY)).toBe("expanded");
    useGraphLegendStore.getState().setStart("collapsed");
    expect(localStorage.getItem(LEGEND_START_KEY)).toBe("collapsed");
  });

  it("knows its values", () => {
    expect(isLegendStart("collapsed")).toBe(true);
    expect(isLegendStart("expanded")).toBe(true);
    expect(isLegendStart(undefined)).toBe(false);
  });
});
