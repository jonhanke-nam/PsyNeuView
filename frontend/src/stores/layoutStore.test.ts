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

  it("every way of hiding a panel reports a refusal the same way (#213)", async () => {
    const { useLayoutStore } = await freshStore();
    // Graph alone: the Layout menu's setPanelVisible and the bottom panel's
    // collapse (toggleBottom) both have to be able to tell the person why.
    expect(useLayoutStore.getState().setPanelVisible("graph", false)).toBe(false);
    expect(useLayoutStore.getState().graphVisible).toBe(true);
    // Showing a panel is never refused.
    expect(useLayoutStore.getState().setPanelVisible("bottom", true)).toBe(true);
    expect(useLayoutStore.getState().setPanelVisible("graph", false)).toBe(true);
    expect(useLayoutStore.getState().toggleBottom()).toBe(false);
    expect(useLayoutStore.getState().bottomVisible).toBe(true);
    expect(useLayoutStore.getState().toggleGraph()).toBe(true);
    expect(useLayoutStore.getState().toggleBottom()).toBe(true);
    expect(useLayoutStore.getState().bottomVisible).toBe(false);
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

describe("a blank screen by choice (#215)", () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is off by default, and off for any stored value but \"true\"", async () => {
    expect((await freshStore()).useLayoutStore.getState().allowBlank).toBe(false);
    localStorage.setItem("psyneuview.layout.allowBlank", "yes please");
    expect((await freshStore()).useLayoutStore.getState().allowBlank).toBe(false);
    localStorage.setItem("psyneuview.layout.allowBlank", "true");
    expect((await freshStore()).useLayoutStore.getState().allowBlank).toBe(true);
  });

  it("lets the last panel go once the setting is on, and the screen is blank", async () => {
    const { useLayoutStore } = await freshStore();
    useLayoutStore.getState().setAllowBlank(true);
    expect(localStorage.getItem("psyneuview.layout.allowBlank")).toBe("true");
    expect(useLayoutStore.getState().isBlank()).toBe(false);
    expect(useLayoutStore.getState().togglePanel("graph")).toBe(true);
    expect(useLayoutStore.getState().graphVisible).toBe(false);
    expect(useLayoutStore.getState().isBlank()).toBe(true);
    // Every way of hiding agrees.
    useLayoutStore.getState().setPanelVisible("bottom", true);
    expect(useLayoutStore.getState().setPanelVisible("bottom", false)).toBe(true);
    useLayoutStore.getState().toggleCode();
    expect(useLayoutStore.getState().toggleCode()).toBe(true);
    expect(useLayoutStore.getState().isBlank()).toBe(true);
  });

  it("opens the graph by default when a model loads on a blank screen, and only then", async () => {
    const { useLayoutStore } = await freshStore();
    // Not blank: a load changes nothing.
    expect(useLayoutStore.getState().showPanelsForOpen()).toBe(false);
    expect(useLayoutStore.getState().codeVisible).toBe(false);
    useLayoutStore.getState().setAllowBlank(true);
    useLayoutStore.getState().togglePanel("graph");
    expect(useLayoutStore.getState().isBlank()).toBe(true);
    expect(useLayoutStore.getState().showPanelsForOpen()).toBe(true);
    const s = useLayoutStore.getState();
    expect([s.codeVisible, s.graphVisible, s.bottomVisible]).toEqual([false, true, false]);
    expect(localStorage.getItem("psynewview_layout_graph_visible")).toBe("true");
  });

  it("opens the chosen panels instead, leaving the Components panel alone unless chosen", async () => {
    const { useLayoutStore } = await freshStore();
    const { usePaletteStore } = await import("./paletteStore");
    usePaletteStore.getState().setOpen(false);
    useLayoutStore.getState().setAllowBlank(true);
    useLayoutStore.getState().togglePanel("graph");

    expect(useLayoutStore.getState().setBlankLoadPanels(["bottom", "code"])).toBe(true);
    // Stored in Settings' order, as a list.
    expect(JSON.parse(localStorage.getItem("psyneuview.layout.blankLoadPanels")!)).toEqual(["code", "bottom"]);
    useLayoutStore.getState().showPanelsForOpen();
    let s = useLayoutStore.getState();
    expect([s.codeVisible, s.graphVisible, s.bottomVisible]).toEqual([true, false, true]);
    expect(usePaletteStore.getState().isOpen).toBe(false);

    // Blank again, with the Components panel chosen too.
    useLayoutStore.getState().togglePanel("code");
    useLayoutStore.getState().togglePanel("bottom");
    expect(useLayoutStore.getState().isBlank()).toBe(true);
    useLayoutStore.getState().setBlankLoadPanels(["graph", "palette"]);
    useLayoutStore.getState().showPanelsForOpen();
    s = useLayoutStore.getState();
    expect([s.codeVisible, s.graphVisible, s.bottomVisible]).toEqual([false, true, false]);
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it("keeps one of the graph, the code editor and the Inspector panel in the chosen set", async () => {
    const { useLayoutStore } = await freshStore();
    expect(useLayoutStore.getState().setBlankLoadPanels(["palette"])).toBe(false);
    expect(useLayoutStore.getState().setBlankLoadPanels([])).toBe(false);
    expect(useLayoutStore.getState().blankLoadPanels).toEqual(["graph"]);
    expect(localStorage.getItem("psyneuview.layout.blankLoadPanels")).toBeNull();
  });

  it("falls back to the graph for a stored set that is corrupt, unknown or unusable", async () => {
    for (const raw of ["not json", "{}", "\"graph\"", "[]", "[\"palette\"]", "[\"sidebar\", 3]"]) {
      localStorage.setItem("psyneuview.layout.blankLoadPanels", raw);
      expect((await freshStore()).useLayoutStore.getState().blankLoadPanels, raw).toEqual(["graph"]);
    }
    // Unknown entries are dropped from a usable set; duplicates fold.
    localStorage.setItem("psyneuview.layout.blankLoadPanels", JSON.stringify(["bottom", "sidebar", "bottom", "graph"]));
    expect((await freshStore()).useLayoutStore.getState().blankLoadPanels).toEqual(["graph", "bottom"]);
  });

  it("brings the graph back when the setting is turned off while the screen is blank", async () => {
    const { useLayoutStore } = await freshStore();
    useLayoutStore.getState().setAllowBlank(true);
    useLayoutStore.getState().togglePanel("graph");
    expect(useLayoutStore.getState().isBlank()).toBe(true);
    useLayoutStore.getState().setAllowBlank(false);
    expect(useLayoutStore.getState().allowBlank).toBe(false);
    expect(useLayoutStore.getState().graphVisible).toBe(true);
    expect(localStorage.getItem("psynewview_layout_graph_visible")).toBe("true");
    // ...and the refusal is back.
    expect(useLayoutStore.getState().togglePanel("graph")).toBe(false);
  });

  it("turning it off with panels showing changes none of them", async () => {
    const { useLayoutStore } = await freshStore();
    useLayoutStore.getState().setAllowBlank(true);
    useLayoutStore.getState().togglePanel("code");
    useLayoutStore.getState().togglePanel("graph");
    useLayoutStore.getState().setAllowBlank(false);
    const s = useLayoutStore.getState();
    expect([s.codeVisible, s.graphVisible, s.bottomVisible]).toEqual([true, false, false]);
  });

  it("a reload while blank stays blank with the setting on, and shows the graph with it off", async () => {
    const first = await freshStore();
    first.useLayoutStore.getState().setAllowBlank(true);
    first.useLayoutStore.getState().togglePanel("graph");
    expect(first.useLayoutStore.getState().isBlank()).toBe(true);

    const again = await freshStore();
    expect(again.useLayoutStore.getState().isBlank()).toBe(true);

    // The setting turned off (from another window, say), the stored blank is read as the graph.
    localStorage.setItem("psyneuview.layout.allowBlank", "false");
    const later = await freshStore();
    expect(later.useLayoutStore.getState().graphVisible).toBe(true);
    expect(later.useLayoutStore.getState().isBlank()).toBe(false);
    // Read that way, not written: the layout keys are as they were.
    expect(localStorage.getItem("psynewview_layout_graph_visible")).toBe("false");
  });

  it("a walkthrough started from blank shows its panels and ends on blank, or the graph if the setting went off", async () => {
    const { useLayoutStore } = await freshStore();
    useLayoutStore.getState().setAllowBlank(true);
    useLayoutStore.getState().togglePanel("graph");

    useLayoutStore.getState().showEverythingForWalkthrough();
    const during = useLayoutStore.getState();
    expect([during.codeVisible, during.graphVisible, during.bottomVisible]).toEqual([true, true, true]);
    // A model the walkthrough opens meets panels showing, so nothing changes.
    expect(useLayoutStore.getState().showPanelsForOpen()).toBe(false);
    useLayoutStore.getState().restoreLayoutAfterWalkthrough();
    expect(useLayoutStore.getState().isBlank()).toBe(true);

    useLayoutStore.getState().showEverythingForWalkthrough();
    useLayoutStore.getState().setAllowBlank(false);
    useLayoutStore.getState().restoreLayoutAfterWalkthrough();
    const after = useLayoutStore.getState();
    expect([after.codeVisible, after.graphVisible, after.bottomVisible]).toEqual([false, true, false]);
  });
});
