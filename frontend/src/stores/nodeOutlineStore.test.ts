import { beforeEach, describe, expect, it, vi } from "vitest";

// #42: the node outline width, remembered per browser. The suite runs on node,
// not jsdom (vitest.config.ts): stub localStorage, as graphLegendStore.test.ts does.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (stored.has(k) ? stored.get(k)! : null),
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
});

async function freshStore() {
  vi.resetModules();
  return import("./nodeOutlineStore");
}

const width = (m: Awaited<ReturnType<typeof freshStore>>) => {
  const s = m.useNodeOutlineStore.getState();
  return s.chosen ?? s.defaultWidth;
};

describe("node outline width", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 2 px, with emphasis and selection 2 px heavier", async () => {
    const m = await freshStore();
    expect(width(m)).toBe(2);
    expect(m.NODE_OUTLINE_EMPHASIS_EXTRA).toBe(2);
    expect(m.NODE_OUTLINE_SELECTED_EXTRA).toBe(2);
  });

  it("remembers a chosen width across page loads", async () => {
    let m = await freshStore();
    m.useNodeOutlineStore.getState().setWidth(3);
    m = await freshStore();
    expect(width(m)).toBe(3);
  });

  it("keeps widths whole and inside the range", async () => {
    const { toOutlineWidth } = await freshStore();
    expect(toOutlineWidth(2.4)).toBe(2);
    expect(toOutlineWidth(0)).toBe(1);
    expect(toOutlineWidth(99)).toBe(6);
    expect(toOutlineWidth("nonsense")).toBeNull();
    expect(toOutlineWidth(null)).toBeNull();
  });

  it("ignores a stored value that isn't a width", async () => {
    localStorage.setItem("psyneuview.graph.nodeOutline", "heavy");
    const m = await freshStore();
    expect(m.useNodeOutlineStore.getState().chosen).toBeNull();
  });

  it("lets the startup override retune the default, never a chosen width", async () => {
    const m = await freshStore();
    m.useNodeOutlineStore.getState().setDefault(3);
    expect(width(m)).toBe(3);
    m.useNodeOutlineStore.getState().setWidth(5);
    m.useNodeOutlineStore.getState().setDefault(1);
    expect(width(m)).toBe(5);
  });
});
