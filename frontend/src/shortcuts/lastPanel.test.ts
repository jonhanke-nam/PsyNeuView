import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one notice for "can't hide the last visible panel" (#213): names the
 * panel, names the others with their real keys, and never stacks.
 */

const items = new Map<string, string>();

async function fresh() {
  vi.resetModules();
  const lastPanel = await import("./lastPanel");
  const { useLayoutStore } = await import("@/stores/layoutStore");
  const { useNotificationStore } = await import("@/stores/notificationStore");
  return { ...lastPanel, useLayoutStore, useNotificationStore };
}

describe("the last-panel notice (#213)", () => {
  beforeEach(() => {
    items.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says which panel stays and how to show another, with its keys", async () => {
    const { lastPanelMessage } = await fresh();
    const keys = { graph: "⌘1", code: "⌘2", bottom: "⌘3" };
    expect(lastPanelMessage("graph", keys)).toBe(
      "One panel has to stay open, so PsyNeuView can't hide the graph. " +
        "Show the code editor (⌘2) or the Inspector panel (⌘3) first, with its key or from the Layout menu.",
    );
    expect(lastPanelMessage("code", keys)).toContain("can't hide the code editor. Show the graph (⌘1) or the Inspector panel (⌘3)");
    expect(lastPanelMessage("bottom", keys)).toContain("can't hide the Inspector panel. Show the graph (⌘1) or the code editor (⌘2)");
  });

  it("reads the keys from the shortcut registry, rebindings included", async () => {
    // Someone has moved "show or hide the code editor" to Mod+Shift+E.
    items.set("psyneuview.shortcutOverrides.v1", JSON.stringify({ "layout.toggleCode": "Mod+Shift+e" }));
    const { lastPanelMessage, panelKeys } = await fresh();
    const keys = panelKeys();
    // ⌘ on a Mac, Ctrl elsewhere: the letter and the number are what matter.
    expect(keys.code).toMatch(/E$/);
    expect(keys.code).toMatch(/⇧|Shift/);
    expect(keys.graph).toMatch(/1$/);
    expect(keys.bottom).toMatch(/3$/);
    expect(lastPanelMessage("graph")).toContain(`the code editor (${keys.code})`);
  });

  it("shows the notice only when the store refuses, and repeats replace rather than stack", async () => {
    const { togglePanelOrExplain, setPanelVisibleOrExplain, useLayoutStore, useNotificationStore, LAST_PANEL_NOTICE_KEY, LAST_PANEL_NOTICE_MS } = await fresh();
    useNotificationStore.getState().clearAll();
    const notices = () => useNotificationStore.getState().notifications;

    // Graph alone (the default): hiding it is refused, and explained.
    expect(togglePanelOrExplain("graph")).toBe(false);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].type).toBe("info");
    expect(notices()[0].key).toBe(LAST_PANEL_NOTICE_KEY);
    expect(notices()[0].message).toContain("can't hide the graph");

    // Trying again, by either route, is still one notice.
    expect(setPanelVisibleOrExplain("graph", false)).toBe(false);
    expect(togglePanelOrExplain("graph")).toBe(false);
    expect(notices()).toHaveLength(1);
    expect(LAST_PANEL_NOTICE_MS).toBeGreaterThanOrEqual(5000);

    // Showing a panel never explains anything; the Components panel never refuses.
    useNotificationStore.getState().clearAll();
    expect(setPanelVisibleOrExplain("code", true)).toBe(true);
    expect(togglePanelOrExplain("palette")).toBe(true);
    expect(notices()).toHaveLength(0);
    // Now the graph can go, and the code editor is the one that has to stay.
    expect(togglePanelOrExplain("graph")).toBe(true);
    expect(useLayoutStore.getState().graphVisible).toBe(false);
    expect(togglePanelOrExplain("code")).toBe(false);
    expect(notices()[0].message).toContain("can't hide the code editor");
  });
});
