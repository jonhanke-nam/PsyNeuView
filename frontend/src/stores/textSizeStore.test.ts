import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// #111: the app's text size, remembered per browser. The suite runs on node,
// not jsdom: stub localStorage, as nodeOutlineStore.test.ts does.
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
  return import("./textSizeStore");
}

describe("text size (#111)", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to Default, 1.1 times the original sizes; Small is the original", async () => {
    const m = await freshStore();
    expect(m.useTextSizeStore.getState().size).toBe("default");
    expect(m.TEXT_SCALES).toEqual({ small: 1, default: 1.1, large: 1.2 });
  });

  it("remembers a choice under psyneuview.appearance.textSize", async () => {
    let m = await freshStore();
    m.useTextSizeStore.getState().setSize("large");
    expect(localStorage.getItem("psyneuview.appearance.textSize")).toBe("large");
    m = await freshStore();
    expect(m.useTextSizeStore.getState().size).toBe("large");
  });

  it("ignores a stored value it doesn't know", async () => {
    localStorage.setItem("psyneuview.appearance.textSize", "huge");
    const m = await freshStore();
    expect(m.useTextSizeStore.getState().size).toBe("default");
  });

  it("palette.css's default scale matches the store's, so the first paint is right", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles/palette.css"), "utf8");
    expect(css).toMatch(/--pnv-text-scale: 1\.1;/);
    // Every --pnv-fs-N follows the scale.
    for (const m of css.matchAll(/--pnv-fs-([\d_]+): (.*);/g)) {
      expect(m[2]).toBe(`calc(${m[1].replace("_", ".")}px * var(--pnv-text-scale))`);
    }
  });
});
