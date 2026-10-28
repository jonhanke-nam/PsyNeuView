import { beforeEach, describe, expect, it, vi } from "vitest";

// #122: a node shows just its name by default, as show_graph() draws it; the
// toolbar's Elements toggle brings back the type and role tags and the
// function line, and the choice is remembered per browser. The suite runs on
// node, not jsdom (vitest.config.ts): stub localStorage.
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
  return import("./graphSettingsStore");
}

const elements = (m: Awaited<ReturnType<typeof freshStore>>) => m.useGraphSettings.getState().showNodeElements;

describe("node details (Elements) default", () => {
  beforeEach(() => localStorage.clear());

  it("is off by default, with names still shown", async () => {
    const m = await freshStore();
    expect(elements(m)).toBe(false);
    expect(m.useGraphSettings.getState().showNodeNames).toBe(true);
  });

  it("remembers turning it on across page loads", async () => {
    let m = await freshStore();
    m.useGraphSettings.getState().setShowNodeElements(true);
    expect(localStorage.getItem(m.NODE_ELEMENTS_KEY)).toBe("true");
    m = await freshStore();
    expect(elements(m)).toBe(true);
  });

  it("remembers turning it off again", async () => {
    let m = await freshStore();
    m.useGraphSettings.getState().setShowNodeElements(true);
    m.useGraphSettings.getState().setShowNodeElements(false);
    m = await freshStore();
    expect(elements(m)).toBe(false);
  });

  it("ignores a stored value it doesn't recognise", async () => {
    localStorage.setItem("psyneuview.graph.nodeElements", "maybe");
    const m = await freshStore();
    expect(elements(m)).toBe(false);
  });
});
