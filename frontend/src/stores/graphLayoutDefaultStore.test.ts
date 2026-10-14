import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAYOUT_STYLE,
  LAYOUT_DEFAULT_KEY,
  isLayoutStyle,
  loadLayoutDefault,
  useGraphLayoutDefaultStore,
} from "./graphLayoutDefaultStore";

describe("Appearance ▸ Automatic layout (#19)", () => {
  // The tests run without a browser, so stand in a page's storage.
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to Layered when storage is blocked", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadLayoutDefault()).toBe("layered");
  });

  it("defaults to Layered", () => {
    expect(DEFAULT_LAYOUT_STYLE).toBe("layered");
    expect(loadLayoutDefault()).toBe("layered");
  });

  it("remembers Like show_graph", () => {
    useGraphLayoutDefaultStore.getState().setStyle("showgraph");
    expect(localStorage.getItem(LAYOUT_DEFAULT_KEY)).toBe("showgraph");
    expect(loadLayoutDefault()).toBe("showgraph");
  });

  it("ignores a value it doesn't know", () => {
    localStorage.setItem(LAYOUT_DEFAULT_KEY, "spiral");
    expect(loadLayoutDefault()).toBe("layered");
    expect(isLayoutStyle("spiral")).toBe(false);
  });
});
