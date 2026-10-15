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

  it("falls back to the default when storage is blocked", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadLayoutDefault()).toBe("showgraph");
  });

  it("defaults to Like show_graph (#24)", () => {
    expect(DEFAULT_LAYOUT_STYLE).toBe("showgraph");
    expect(loadLayoutDefault()).toBe("showgraph");
  });

  it("remembers a choice of Layered", () => {
    useGraphLayoutDefaultStore.getState().setStyle("layered");
    expect(localStorage.getItem(LAYOUT_DEFAULT_KEY)).toBe("layered");
    expect(loadLayoutDefault()).toBe("layered");
  });

  it("ignores a value it doesn't know", () => {
    localStorage.setItem(LAYOUT_DEFAULT_KEY, "spiral");
    expect(loadLayoutDefault()).toBe("showgraph");
    expect(isLayoutStyle("spiral")).toBe(false);
  });
});
