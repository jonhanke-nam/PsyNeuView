import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesEvent, parseBinding } from "./binding";
import {
  changedSummary,
  onOpenShortcutsReference,
  openShortcutsReference,
  referenceRows,
  rowMatches,
} from "./reference";
import { SHORTCUTS, defaultBindingFor, resolveShortcuts } from "./registry";

describe("the reference's rows (#292)", () => {
  it("lists every shortcut, none changed, on the defaults", () => {
    const { resolved } = resolveShortcuts({}, SHORTCUTS, "mac");
    const rows = referenceRows(resolved, {}, true);
    expect(rows.map((r) => r.id)).toEqual(SHORTCUTS.map((s) => s.id));
    expect(rows.some((r) => r.changed)).toBe(false);
    expect(changedSummary(rows)).toBeNull();
  });

  it("marks a rebound shortcut with its default, the platform's way", () => {
    const overrides = { "inspector.focus": "Mod+Shift+i" };
    const mac = referenceRows(resolveShortcuts(overrides, SHORTCUTS, "mac").resolved, overrides, true);
    const inspector = mac.find((r) => r.id === "inspector.focus")!;
    expect(inspector).toMatchObject({ changed: true, keys: "⇧⌘I", defaultKeys: "⌘I" });
    expect(changedSummary(mac)).toBe("1 shortcut changed from the defaults");

    const pc = referenceRows(resolveShortcuts(overrides, SHORTCUTS, "other").resolved, overrides, false);
    expect(pc.find((r) => r.id === "inspector.focus")).toMatchObject({ keys: "Ctrl+Shift+I", defaultKeys: "Ctrl+I" });
  });

  it("counts several, and ignores an override equal to the default", () => {
    const overrides = { "model.save": "Mod+Shift+s", "history.redo": "Mod+y", "history.undo": "Mod+z" };
    const rows = referenceRows(resolveShortcuts(overrides, SHORTCUTS, "mac").resolved, overrides, true);
    expect(changedSummary(rows)).toBe("2 shortcuts changed from the defaults");
  });

  it("searches the action, the keys and the area", () => {
    const row = { label: "Save model", keys: "⌘S", group: "File" };
    expect(rowMatches(row, "save")).toBe(true);
    expect(rowMatches(row, "⌘s")).toBe(true);
    expect(rowMatches(row, "file")).toBe(true);
    expect(rowMatches(row, "undo")).toBe(false);
    expect(rowMatches(row, "  ")).toBe(true);
  });
});

describe("per-platform defaults (#292)", () => {
  it("uses a platform's own default when one is given, the shared one otherwise", () => {
    const s = { ...SHORTCUTS[0], defaultBinding: "Mod+s", platformDefaults: { other: "Mod+Shift+s" } };
    expect(defaultBindingFor(s, "mac")).toBe("Mod+s");
    expect(defaultBindingFor(s, "other")).toBe("Mod+Shift+s");
    const { resolved } = resolveShortcuts({}, [s], "other");
    expect(resolved[0].binding.shift).toBe(true);
  });
});

describe("the keys that open it (#292)", () => {
  const ev = (init: Partial<KeyboardEvent>) =>
    ({ key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

  it("? matches whether or not the layout needs Shift for it", () => {
    const parsed = parseBinding("?");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(matchesEvent(parsed.binding, ev({ key: "?", shiftKey: true }), true)).toBe(true);
    expect(matchesEvent(parsed.binding, ev({ key: "?" }), false)).toBe(true);
    expect(matchesEvent(parsed.binding, ev({ key: "?", metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(matchesEvent(parsed.binding, ev({ key: "/" }), true)).toBe(false);
  });

  it("⌘/ matches, and still does on a layout where / needs Shift", () => {
    const parsed = parseBinding("Mod+/");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(matchesEvent(parsed.binding, ev({ key: "/", metaKey: true }), true)).toBe(true);
    expect(matchesEvent(parsed.binding, ev({ key: "/", metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(matchesEvent(parsed.binding, ev({ key: "/", ctrlKey: true }), false)).toBe(true);
  });

  it("still refuses other bare characters", () => {
    expect(parseBinding("k").ok).toBe(false);
    expect(parseBinding("/").ok).toBe(false);
  });
});

describe("opening it", () => {
  // The suite runs on node: `window` is a bare EventTarget here.
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
  });

  it("opens on request", () => {
    const open = vi.fn();
    const off = onOpenShortcutsReference(open);
    openShortcutsReference();
    expect(open).toHaveBeenCalledTimes(1);
    off();
  });

  it("picks up a request the Mac app made before the page was listening", () => {
    (window as { __pnvOpenShortcutsRequested?: boolean }).__pnvOpenShortcutsRequested = true;
    const open = vi.fn();
    const off = onOpenShortcutsReference(open);
    expect(open).toHaveBeenCalledTimes(1);
    off();
  });
});
