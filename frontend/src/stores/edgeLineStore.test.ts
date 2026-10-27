import { beforeEach, describe, expect, it, vi } from "vitest";

// #107: the width of the lines between nodes, remembered per browser. The
// suite runs on node, not jsdom: stub localStorage, as nodeOutlineStore.test.ts does.
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
  return import("./edgeLineStore");
}

const width = (m: Awaited<ReturnType<typeof freshStore>>) => {
  const s = m.useEdgeLineStore.getState();
  return s.chosen ?? s.defaultWidth;
};

describe("line width between nodes", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 3 px, the width lines were already drawn at", async () => {
    const m = await freshStore();
    expect(width(m)).toBe(3);
    expect(m.EDGE_LINE_WIDTHS).toEqual([1, 2, 3, 4]);
    expect(m.EDGE_LINE_KEY.startsWith("psyneuview.")).toBe(true);
  });

  it("scales the arrowhead with the line, unchanged at the default", async () => {
    const { edgeArrowheadScale } = await freshStore();
    expect(edgeArrowheadScale(3)).toBe(1);
    expect(edgeArrowheadScale(4)).toBeCloseTo(4 / 3);
    expect(edgeArrowheadScale(1)).toBeCloseTo(1 / 3);
  });

  it("remembers a chosen width across page loads", async () => {
    let m = await freshStore();
    m.useEdgeLineStore.getState().setWidth(4);
    m = await freshStore();
    expect(width(m)).toBe(4);
  });

  it("keeps widths whole and inside the range", async () => {
    const { toEdgeLineWidth } = await freshStore();
    expect(toEdgeLineWidth(2.4)).toBe(2);
    expect(toEdgeLineWidth(0)).toBe(1);
    expect(toEdgeLineWidth(99)).toBe(4);
    expect(toEdgeLineWidth("nonsense")).toBeNull();
    expect(toEdgeLineWidth(null)).toBeNull();
  });

  it("ignores a stored value that isn't a width", async () => {
    localStorage.setItem("psyneuview.graph.edgeLineWidth", "heavy");
    const m = await freshStore();
    expect(m.useEdgeLineStore.getState().chosen).toBeNull();
  });

  it("lets the startup override retune the default, never a chosen width", async () => {
    const m = await freshStore();
    m.useEdgeLineStore.getState().setDefault(2);
    expect(width(m)).toBe(2);
    m.useEdgeLineStore.getState().setWidth(4);
    m.useEdgeLineStore.getState().setDefault(1);
    expect(width(m)).toBe(4);
  });
});
