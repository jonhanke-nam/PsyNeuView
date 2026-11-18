/** The live preview's setting (#255). */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The suite runs on node, not jsdom (vitest.config.ts): stub localStorage, as
// nodeOutlineStore.test.ts does.
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

async function fresh() {
  vi.resetModules();
  return await import("./livePreviewStore");
}

describe("Update the graph while typing (#255)", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 1.5 s, as before the setting existed", async () => {
    const m = await fresh();
    expect(m.useLivePreviewStore.getState().delayMs).toBe(1500);
    expect(m.DEFAULT_LIVE_PREVIEW_MS).toBe(1500);
  });

  it("offers Off, which is 0", async () => {
    const m = await fresh();
    expect(m.LIVE_PREVIEW_DELAYS[0]).toEqual({ ms: 0, label: "Off: when you save" });
  });

  it("remembers a choice across page loads", async () => {
    let m = await fresh();
    m.useLivePreviewStore.getState().setDelayMs(0);
    expect(localStorage.getItem("psyneuview.editor.livePreviewMs")).toBe("0");
    m = await fresh();
    expect(m.useLivePreviewStore.getState().delayMs).toBe(0);
  });

  it("ignores a stored value it doesn't offer", async () => {
    localStorage.setItem("psyneuview.editor.livePreviewMs", "777");
    const m = await fresh();
    expect(m.useLivePreviewStore.getState().delayMs).toBe(1500);
  });
});
