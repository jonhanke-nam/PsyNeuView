import { beforeEach, describe, expect, it, vi } from "vitest";

// #289: the Fit button shows its icon by default (no translation needed), and
// the choice of the word "Fit" is remembered per browser. The suite runs on
// node, not jsdom: stub localStorage, as viewOnlyTagsStore.test.ts does.
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

async function load() {
  vi.resetModules();
  return import("./fitButtonStyleStore");
}

describe("the Fit button style setting (#289)", () => {
  beforeEach(() => localStorage.clear());

  it("is the icon by default", async () => {
    const { DEFAULT_FIT_BUTTON_STYLE, useFitButtonStyleStore } = await load();
    expect(DEFAULT_FIT_BUTTON_STYLE).toBe("icon");
    expect(useFitButtonStyleStore.getState().style).toBe("icon");
  });

  it("remembers the word across page loads", async () => {
    let m = await load();
    m.useFitButtonStyleStore.getState().setStyle("word");
    expect(localStorage.getItem(m.FIT_BUTTON_STYLE_KEY)).toBe("word");
    m = await load();
    expect(m.useFitButtonStyleStore.getState().style).toBe("word");
  });

  it("ignores a stored value it doesn't know", async () => {
    localStorage.setItem("psyneuview.graph.fitButtonStyle", "huge");
    const m = await load();
    expect(m.useFitButtonStyleStore.getState().style).toBe("icon");
  });
});
