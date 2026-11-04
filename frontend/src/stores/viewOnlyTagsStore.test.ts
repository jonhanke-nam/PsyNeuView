import { beforeEach, describe, expect, it, vi } from "vitest";

// #211: a node's "view only" tag is hidden by default, as show_graph draws no
// such tag, and the choice is remembered per browser. The suite runs on node,
// not jsdom (vitest.config.ts): stub localStorage, as graphLegendStore.test.ts
// does.
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
  return import("./viewOnlyTagsStore");
}

describe("the view-only tag setting (#211)", () => {
  beforeEach(() => localStorage.clear());

  it("is hidden by default", async () => {
    const { DEFAULT_VIEW_ONLY_TAGS, loadViewOnlyTags, useViewOnlyTagsStore } = await load();
    expect(DEFAULT_VIEW_ONLY_TAGS).toBe("hidden");
    expect(loadViewOnlyTags()).toBe("hidden");
    expect(useViewOnlyTagsStore.getState().tags).toBe("hidden");
  });

  it("remembers showing the tags across page loads", async () => {
    let m = await load();
    m.useViewOnlyTagsStore.getState().setTags("shown");
    expect(localStorage.getItem(m.VIEW_ONLY_TAGS_KEY)).toBe("shown");
    m = await load();
    expect(m.useViewOnlyTagsStore.getState().tags).toBe("shown");
  });

  it("ignores a stored value it doesn't recognise", async () => {
    localStorage.setItem("psyneuview.graph.viewOnlyTags", "maybe");
    const { loadViewOnlyTags, isViewOnlyTags } = await load();
    expect(loadViewOnlyTags()).toBe("hidden");
    expect(isViewOnlyTags("shown")).toBe(true);
    expect(isViewOnlyTags(undefined)).toBe(false);
  });
});
