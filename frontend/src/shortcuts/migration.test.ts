import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearCommands, hasCommand, registerCommand, runCommand } from "./commands";
import { matchesEvent } from "./binding";
import { findConflicts, resolveShortcuts } from "./registry";
import { allowedInTarget, classifyTarget } from "./target";

/**
 * Regression cover for moving four live shortcuts onto the registry (#1112).
 *
 * The risk in this change is not that the registry is wrong — that has its own
 * tests — but that a shortcut which worked before now fires in a different
 * place, or stops firing at all. Each test below states the behaviour as it was
 * before the migration.
 */

const bindingFor = (id: string) => {
  const { resolved } = resolveShortcuts();
  const found = resolved.find((s) => s.id === id);
  if (!found) throw new Error(`${id} is not registered`);
  return found;
};

const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: "", code: "", metaKey: false, ctrlKey: false,
     shiftKey: false, altKey: false, ...over } as KeyboardEvent);

/**
 * Press `Mod+key` on a named platform.
 *
 * Never let the platform default in a test: `matchesEvent` detects it, so an
 * assertion written with `metaKey` passes on a Mac and fails on Linux. That is
 * exactly how five tests got through review and broke in CI, twice — the second
 * time because I fixed one test file and not this one.
 */
const pressMod = (
  shortcut: { binding: Parameters<typeof matchesEvent>[0] },
  key: string,
  mac: boolean,
  extra: Partial<KeyboardEvent> = {}
) =>
  matchesEvent(
    shortcut.binding,
    ev({ key, ...(mac ? { metaKey: true } : { ctrlKey: true }), ...extra }),
    mac
  );

const PLATFORMS: [boolean, string][] = [[true, "mac"], [false, "pc"]];

describe("the shortcuts that existed before are all still declared", () => {
  it.each([
    ["history.undo", "z"],
    ["history.redo", "z"],
    ["model.save", "s"],
    ["graph.deleteSelection", "Backspace"],
  ])("%s is bound to %s", (id, key) => {
    expect(bindingFor(id).binding.key).toBe(key);
  });

  it("undo and redo are told apart by Shift, as before", () => {
    expect(bindingFor("history.undo").binding.shift).toBe(false);
    expect(bindingFor("history.redo").binding.shift).toBe(true);
  });
});

describe("Cmd+Z still reaches the code editor", () => {
  it.each(PLATFORMS)("fires inside CodeMirror on %s", (mac) => {
    // The behaviour useUndoRedo went out of its way to have: PsyNeuView's undo
    // is model-wide, so it takes Cmd+Z from the editor's own text undo. If this
    // ever fails, undo silently becomes text-only inside the editor.
    const undo = bindingFor("history.undo");
    expect(pressMod(undo, "z", mac)).toBe(true);
    expect(allowedInTarget(undo.scope, "codeEditor")).toBe(true);
  });

  it("does not fire in an ordinary text field", () => {
    // Also as before: a rename box keeps its own undo.
    expect(allowedInTarget(bindingFor("history.undo").scope, "textField")).toBe(false);
  });
});

describe("Cmd+S still saves from inside the editor", () => {
  it.each(PLATFORMS)("fires where the CodeMirror keymap used to, on %s", (mac) => {
    const save = bindingFor("model.save");
    expect(pressMod(save, "s", mac)).toBe(true);
    expect(allowedInTarget(save.scope, "codeEditor")).toBe(true);
  });

  it("is not swallowed by a rename field", () => {
    expect(allowedInTarget(bindingFor("model.save").scope, "textField")).toBe(false);
  });
});

describe("Backspace still deletes a node, and only outside text", () => {
  it.each(PLATFORMS)("fires on the canvas on %s", (mac) => {
    // No modifier, so this one is genuinely platform-independent — asserted on
    // both anyway, since that is cheaper than deciding case by case.
    const del = bindingFor("graph.deleteSelection");
    expect(matchesEvent(del.binding, ev({ key: "Backspace" }), mac)).toBe(true);
    expect(allowedInTarget(del.scope, "other")).toBe(true);
  });

  it("never fires while typing", () => {
    // The regression that would matter most: Backspace deleting a node while
    // someone edits a parameter value.
    const del = bindingFor("graph.deleteSelection");
    expect(allowedInTarget(del.scope, "textField")).toBe(false);
    expect(allowedInTarget(del.scope, "codeEditor")).toBe(false);
  });
});

describe("the command bus", () => {
  beforeEach(() => clearCommands());

  it("runs a registered handler", () => {
    const fn = vi.fn();
    registerCommand("model.save", fn);
    expect(runCommand("model.save")).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does nothing when the owner is not mounted", () => {
    // A shortcut whose component is off screen must be inert, not throw.
    expect(runCommand("model.save")).toBe(false);
  });

  it("unregisters on cleanup", () => {
    const off = registerCommand("model.save", vi.fn());
    off();
    expect(hasCommand("model.save")).toBe(false);
  });

  it("a remount does not leave the command dead", () => {
    // React can register the replacement before the old effect cleans up.
    // Clearing unconditionally there would unregister the live handler.
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerCommand("model.save", first);
    registerCommand("model.save", second);
    offFirst();
    expect(runCommand("model.save")).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});

describe("classifyTarget", () => {
  // The suite runs in a node environment, so these are element-shaped objects
  // rather than real DOM nodes. classifyTarget only reads tagName, closest and
  // isContentEditable, which is exactly what makes that possible.
  const el = (over: Partial<HTMLElement> & { closestMatch?: string | null }) =>
    ({
      tagName: "DIV",
      isContentEditable: false,
      closest: (sel: string) => (over.closestMatch === sel ? {} : null),
      ...over,
    } as unknown as HTMLElement);

  it("recognises an ordinary field", () => {
    expect(classifyTarget(el({ tagName: "INPUT" }))).toBe("textField");
    expect(classifyTarget(el({ tagName: "TEXTAREA" }))).toBe("textField");
    expect(classifyTarget(el({ tagName: "SELECT" }))).toBe("textField");
  });

  it("recognises the code editor by its wrapper", () => {
    // CodeMirror's content is contenteditable, so without the .cm-editor check
    // it would be classified as an ordinary field — and undo would stop
    // reaching it, quietly reverting the behaviour this migration preserves.
    const inEditor = el({ isContentEditable: true, closestMatch: ".cm-editor" });
    expect(classifyTarget(inEditor)).toBe("codeEditor");
  });

  it("treats a contenteditable outside the editor as a text field", () => {
    expect(classifyTarget(el({ isContentEditable: true }))).toBe("textField");
  });

  it("treats everything else as fair game", () => {
    expect(classifyTarget(el({}))).toBe("other");
    expect(classifyTarget(null)).toBe("other");
  });
});

describe("Cmd+I shows the Inspector", () => {
  // The request that started #1112, and the first shortcut added through the
  // registry rather than as another scattered listener.
  it.each(PLATFORMS)("is bound to Mod+I on %s", (mac) => {
    const inspector = bindingFor("inspector.focus");
    expect(inspector.binding.key).toBe("i");
    expect(pressMod(inspector, "i", mac)).toBe(true);
  });

  it("works from the code editor, where you often are", () => {
    expect(allowedInTarget(bindingFor("inspector.focus").scope, "codeEditor")).toBe(true);
  });

  it("does not fire from a rename box", () => {
    expect(allowedInTarget(bindingFor("inspector.focus").scope, "textField")).toBe(false);
  });

  it("does not collide with anything else", () => {
    const { resolved } = resolveShortcuts();
    expect(findConflicts(resolved)).toEqual([]);
  });
});
