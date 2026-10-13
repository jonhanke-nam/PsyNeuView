import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearOverrides, loadOverrides, saveOverrides, setOverride } from "./storage";
import { resolveShortcuts } from "./registry";

// Overrides live in localStorage. The suite runs in node, so it gets a stub.

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", { dispatchEvent: () => true, CustomEvent: class {} });
});

describe("round trip", () => {
  it("saves and reloads an override", () => {
    saveOverrides({ "history.undo": "Mod+Shift+u" });
    expect(loadOverrides()).toEqual({ "history.undo": "Mod+Shift+u" });
  });

  it("setOverride adds one and clears one", () => {
    setOverride("history.undo", "Mod+Shift+u");
    expect(loadOverrides()["history.undo"]).toBe("Mod+Shift+u");
    setOverride("history.undo", null);
    expect(loadOverrides()["history.undo"]).toBeUndefined();
  });

  it("clearOverrides empties the lot", () => {
    setOverride("history.undo", "Mod+Shift+u");
    clearOverrides();
    expect(loadOverrides()).toEqual({});
  });

  it("removes the key entirely when nothing is overridden", () => {
    // So a user who resets everything leaves no trace to go stale.
    saveOverrides({ "history.undo": "Mod+u" });
    saveOverrides({});
    expect(store.has("psyneuview.shortcutOverrides.v1")).toBe(false);
  });
});

describe("stored data is never trusted", () => {
  it("survives corrupt JSON", () => {
    store.set("psyneuview.shortcutOverrides.v1", "{not json");
    expect(loadOverrides()).toEqual({});
  });

  it("ignores a stored array", () => {
    store.set("psyneuview.shortcutOverrides.v1", '["Mod+z"]');
    expect(loadOverrides()).toEqual({});
  });

  it("drops a binding that no longer parses, keeping the rest", () => {
    // The grammar can tighten between releases, or someone can edit
    // localStorage by hand. One bad entry must not cost the others.
    store.set(
      "psyneuview.shortcutOverrides.v1",
      JSON.stringify({ "history.undo": "Hyper+z", "model.save": "Mod+Shift+s" })
    );
    expect(loadOverrides()).toEqual({ "model.save": "Mod+Shift+s" });
  });

  it("ignores non-string values", () => {
    store.set("psyneuview.shortcutOverrides.v1", JSON.stringify({ "history.undo": 42 }));
    expect(loadOverrides()).toEqual({});
  });

  it("copes when storage throws", () => {
    // Safari in private mode, or storage disabled outright.
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => {},
    });
    expect(loadOverrides()).toEqual({});
    expect(saveOverrides({ "history.undo": "Mod+u" })).toBe(false);
  });
});

describe("overrides reach the resolved set", () => {
  it("a stored override changes the binding", () => {
    setOverride("inspector.focus", "Mod+Shift+i");
    const { resolved } = resolveShortcuts(loadOverrides());
    const inspector = resolved.find((s) => s.id === "inspector.focus");
    expect(inspector?.binding.shift).toBe(true);
  });

  it("untouched shortcuts keep their defaults", () => {
    // So improving a default still reaches anyone who never customised it.
    setOverride("inspector.focus", "Mod+Shift+i");
    const { resolved } = resolveShortcuts(loadOverrides());
    expect(resolved.find((s) => s.id === "model.save")?.binding.key).toBe("s");
  });
});
