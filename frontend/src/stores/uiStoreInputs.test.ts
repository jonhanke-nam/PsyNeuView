/**
 * The Run panel's input arrangement (#331) and the per-element grid setting
 * (#330): their defaults, and a choice made before being kept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INPUT_CELL_GRID_KEY,
  INPUT_GROUPING_KEY,
  loadInputCellGrid,
  loadInputGrouping,
  useUIStore,
} from "./uiStore";

// Node has no localStorage; a small stand-in.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

beforeEach(() => store.clear());

describe("input arrangement (#331)", () => {
  it("is by trial when nothing is stored", () => {
    expect(loadInputGrouping()).toBe("byTrial");
  });

  it("keeps a stored by-node choice", () => {
    localStorage.setItem(INPUT_GROUPING_KEY, "byNode");
    expect(loadInputGrouping()).toBe("byNode");
  });

  it("treats anything else as the default", () => {
    localStorage.setItem(INPUT_GROUPING_KEY, "byTrial");
    expect(loadInputGrouping()).toBe("byTrial");
    localStorage.setItem(INPUT_GROUPING_KEY, "sideways");
    expect(loadInputGrouping()).toBe("byTrial");
  });

  it("stores a choice made in the Run row", () => {
    useUIStore.getState().setInputGrouping("byNode");
    expect(localStorage.getItem(INPUT_GROUPING_KEY)).toBe("byNode");
    expect(loadInputGrouping()).toBe("byNode");
  });
});

describe("per-element grid setting (#330)", () => {
  it("is off by default", () => {
    expect(loadInputCellGrid()).toBe(false);
  });

  it("is kept once turned on", () => {
    useUIStore.getState().setInputCellGrid(true);
    expect(localStorage.getItem(INPUT_CELL_GRID_KEY)).toBe("true");
    expect(loadInputCellGrid()).toBe(true);
    useUIStore.getState().setInputCellGrid(false);
    expect(loadInputCellGrid()).toBe(false);
  });
});
