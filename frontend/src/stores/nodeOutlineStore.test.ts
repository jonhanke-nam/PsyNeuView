import { beforeEach, describe, expect, it, vi } from "vitest";

// #42: node outline widths, remembered per browser. The suite runs on node,
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

describe("node outline widths", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 2 px and 3.5 px", async () => {
    const { useNodeOutlineStore } = await freshStore();
    const s = useNodeOutlineStore.getState();
    expect(s.chosen ?? s.defaultWidth).toBe(2);
    expect(s.chosenEmphasis ?? s.defaultEmphasis).toBe(3.5);
  });

  it("remembers a chosen width across page loads", async () => {
    let m = await freshStore();
    m.useNodeOutlineStore.getState().setWidth(3);
    m.useNodeOutlineStore.getState().setEmphasis(5);
    m = await freshStore();
    expect(m.useNodeOutlineStore.getState().chosen).toBe(3);
    expect(m.useNodeOutlineStore.getState().chosenEmphasis).toBe(5);
  });

  it("keeps widths on the half-pixel grid inside the range", async () => {
    const { toOutlineWidth } = await freshStore();
    expect(toOutlineWidth(2.3)).toBe(2.5);
    expect(toOutlineWidth(0)).toBe(0.5);
    expect(toOutlineWidth(99)).toBe(6);
    expect(toOutlineWidth("nonsense")).toBeNull();
    expect(toOutlineWidth(null)).toBeNull();
  });

  it("ignores a stored value that isn't a width", async () => {
    localStorage.setItem("psyneuview.graph.nodeOutline", "heavy");
    const { useNodeOutlineStore } = await freshStore();
    expect(useNodeOutlineStore.getState().chosen).toBeNull();
  });

  it("lets the startup override retune the defaults, never a chosen width", async () => {
    const { useNodeOutlineStore } = await freshStore();
    useNodeOutlineStore.getState().setDefaults({ width: 1.5, emphasis: 4 });
    expect(useNodeOutlineStore.getState().defaultWidth).toBe(1.5);
    useNodeOutlineStore.getState().setWidth(3);
    useNodeOutlineStore.getState().setDefaults({ width: 1 });
    const s = useNodeOutlineStore.getState();
    expect(s.chosen ?? s.defaultWidth).toBe(3);
    expect(s.defaultEmphasis).toBe(4);
  });
});
