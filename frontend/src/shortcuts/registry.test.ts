import { describe, it, expect } from "vitest";
import { SHORTCUTS, findConflicts, resolveShortcuts } from "./registry";
import { allowedInTarget } from "./target";

describe("the declared set", () => {
  it("every default parses", () => {
    const { errors } = resolveShortcuts();
    expect(errors).toEqual([]);
  });

  it("no two shortcuts want the same chord", () => {
    // The failure this whole module exists to prevent.
    const { resolved } = resolveShortcuts();
    expect(findConflicts(resolved)).toEqual([]);
  });

  it("ids are unique, since overrides are stored against them", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("keeps undo taking over the code editor", () => {
    // Deliberate and easy to lose: PsyNeuView's undo is model-wide, so it
    // outranks CodeMirror's text undo. It was a comment before; now it is a
    // property, and this is the test that keeps it one.
    const undo = SHORTCUTS.find((s) => s.id === "history.undo");
    expect(undo?.scope).toBe("codeEditorToo");
  });

  it("keeps delete away from text fields", () => {
    const del = SHORTCUTS.find((s) => s.id === "graph.deleteSelection");
    expect(del?.scope).toBe("outsideText");
  });
});

describe("overrides", () => {
  it("replaces the binding", () => {
    const { resolved } = resolveShortcuts({ "history.undo": "Mod+Shift+u" });
    const undo = resolved.find((s) => s.id === "history.undo");
    expect(undo?.binding.key).toBe("u");
    expect(undo?.binding.shift).toBe(true);
  });

  it("falls back to the default when an override is unparseable", () => {
    // A bad stored override must not take the action down with it.
    const { resolved, errors } = resolveShortcuts({ "history.undo": "Hyper+z" });
    const undo = resolved.find((s) => s.id === "history.undo");
    expect(undo?.binding.key).toBe("z");
    expect(errors[0]).toContain("history.undo");
  });

  it("leaves untouched shortcuts on their defaults", () => {
    // So improving a default still reaches anyone who never customised it.
    const { resolved } = resolveShortcuts({ "history.undo": "Mod+Shift+u" });
    expect(resolved.find((s) => s.id === "model.save")?.binding.key).toBe("s");
  });

  it("reports a conflict an override introduces", () => {
    const { resolved } = resolveShortcuts({ "model.save": "Mod+z" });
    expect(findConflicts(resolved).length).toBeGreaterThan(0);
  });
});

describe("scopes", () => {
  it("outsideText fires only away from typing", () => {
    expect(allowedInTarget("outsideText", "other")).toBe(true);
    expect(allowedInTarget("outsideText", "textField")).toBe(false);
    expect(allowedInTarget("outsideText", "codeEditor")).toBe(false);
  });

  it("codeEditorToo fires in the editor but not in a plain field", () => {
    // Cmd+S in the editor saves the model; Cmd+S in a rename box does not get
    // hijacked.
    expect(allowedInTarget("codeEditorToo", "codeEditor")).toBe(true);
    expect(allowedInTarget("codeEditorToo", "textField")).toBe(false);
    expect(allowedInTarget("codeEditorToo", "other")).toBe(true);
  });

  it("always fires anywhere", () => {
    for (const t of ["other", "textField", "codeEditor"] as const) {
      expect(allowedInTarget("always", t)).toBe(true);
    }
  });
});
