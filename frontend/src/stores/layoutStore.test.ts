import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which panels show (#189), and the one key per panel (#191).
 *
 * The store reads storage when it is first imported, so each test stands in a
 * page's storage first and imports the module fresh.
 */
async function freshStore() {
  vi.resetModules();
  return import("./layoutStore");
}

describe("the default layout (#189)", () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is the graph alone: no code editor, no bottom panel", async () => {
    const { useLayoutStore } = await freshStore();
    const s = useLayoutStore.getState();
    expect(s.graphVisible).toBe(true);
    expect(s.codeVisible).toBe(false);
    expect(s.bottomVisible).toBe(false);
  });

  it("keeps a choice someone already made", async () => {
    // Someone who turned the code editor on before this default changed
    // still has it; only people with nothing stored get the new default.
    localStorage.setItem("psynewview_layout_code_visible", "true");
    localStorage.setItem("psynewview_layout_bottom_visible", "true");
    const { useLayoutStore } = await freshStore();
    expect(useLayoutStore.getState().codeVisible).toBe(true);
    expect(useLayoutStore.getState().bottomVisible).toBe(true);
  });

  it("stores a toggle like a Layout-menu change", async () => {
    const { useLayoutStore } = await freshStore();
    expect(useLayoutStore.getState().togglePanel("code")).toBe(true);
    expect(useLayoutStore.getState().codeVisible).toBe(true);
    expect(localStorage.getItem("psynewview_layout_code_visible")).toBe("true");
  });

  it("refuses to hide the last visible panel, and says so", async () => {
    const { useLayoutStore } = await freshStore();
    // Graph alone: hiding it would leave nothing.
    expect(useLayoutStore.getState().togglePanel("graph")).toBe(false);
    expect(useLayoutStore.getState().graphVisible).toBe(true);
    // With the code editor on too, the graph can go.
    useLayoutStore.getState().togglePanel("code");
    expect(useLayoutStore.getState().togglePanel("graph")).toBe(true);
    expect(useLayoutStore.getState().graphVisible).toBe(false);
    // ...and now the code editor is the last one.
    expect(useLayoutStore.getState().togglePanel("code")).toBe(false);
    expect(useLayoutStore.getState().codeVisible).toBe(true);
  });

  it("the Components panel toggles through its own store", async () => {
    const { useLayoutStore } = await freshStore();
    const { usePaletteStore } = await import("./paletteStore");
    const was = usePaletteStore.getState().isOpen;
    expect(useLayoutStore.getState().togglePanel("palette")).toBe(true);
    expect(usePaletteStore.getState().isOpen).toBe(!was);
  });
});

describe("a walkthrough's layout (#189)", () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows everything while it runs and puts the learner's layout back", async () => {
    const { useLayoutStore, LS_BEFORE_WALKTHROUGH } = await freshStore();
    const { usePaletteStore } = await import("./paletteStore");
    usePaletteStore.getState().setOpen(false);

    useLayoutStore.getState().showEverythingForWalkthrough();
    const during = useLayoutStore.getState();
    expect([during.codeVisible, during.graphVisible, during.bottomVisible]).toEqual([true, true, true]);
    expect(usePaletteStore.getState().isOpen).toBe(true);
    expect(localStorage.getItem(LS_BEFORE_WALKTHROUGH)).not.toBeNull();

    useLayoutStore.getState().restoreLayoutAfterWalkthrough();
    const after = useLayoutStore.getState();
    expect([after.codeVisible, after.graphVisible, after.bottomVisible]).toEqual([false, true, false]);
    expect(usePaletteStore.getState().isOpen).toBe(false);
    // Forgotten once restored, so a later restore is a no-op.
    expect(localStorage.getItem(LS_BEFORE_WALKTHROUGH)).toBeNull();
  });

  it("keeps the layout from before when a walkthrough restarts after a reload", async () => {
    const { useLayoutStore } = await freshStore();
    useLayoutStore.getState().showEverythingForWalkthrough();
    // A reload: the store comes back reading the tutorial layout from storage...
    const again = await freshStore();
    expect(again.useLayoutStore.getState().codeVisible).toBe(true);
    // ...the walkthrough starts over and must not remember *that* as the learner's.
    again.useLayoutStore.getState().showEverythingForWalkthrough();
    again.useLayoutStore.getState().restoreLayoutAfterWalkthrough();
    expect(again.useLayoutStore.getState().codeVisible).toBe(false);
    expect(again.useLayoutStore.getState().bottomVisible).toBe(false);
  });

  it("restoring with nothing remembered changes nothing", async () => {
    const { useLayoutStore } = await freshStore();
    useLayoutStore.getState().togglePanel("code");
    useLayoutStore.getState().restoreLayoutAfterWalkthrough();
    expect(useLayoutStore.getState().codeVisible).toBe(true);
  });
});
