import { describe, expect, it } from "vitest";

import { fillShortcutKeys, modLabel, optionKeyName, windowZoomKeys } from "./keyLabels";
import { resolveShortcuts } from "./registry";

describe("key names, this platform's way (#409)", () => {
  it("modLabel reads ⌘Z on a Mac and Ctrl+Z elsewhere", () => {
    expect(modLabel("z", true)).toBe("⌘Z");
    expect(modLabel("z", false)).toBe("Ctrl+Z");
    expect(modLabel("/", false)).toBe("Ctrl+/");
  });

  it("names Option on a Mac and Alt elsewhere", () => {
    expect(optionKeyName(true)).toBe("Option");
    expect(optionKeyName(false)).toBe("Alt");
  });

  it("names the window zoom keys without a doubled plus", () => {
    expect(windowZoomKeys(true)).toBe("⌘+ / ⌘−");
    expect(windowZoomKeys(false)).toBe("Ctrl+Plus / Ctrl+Minus");
  });
});

describe("walkthrough text naming a shortcut (#409)", () => {
  const text = "Press Undo (or {key:history.undo}), then Redo ({key:history.redo}).";

  it("fills in the Mac keys on a Mac", () => {
    const { resolved } = resolveShortcuts({}, undefined, "mac");
    expect(fillShortcutKeys(text, resolved, true)).toBe("Press Undo (or ⌘Z), then Redo (⇧⌘Z).");
  });

  it("fills in Ctrl keys elsewhere", () => {
    const { resolved } = resolveShortcuts({}, undefined, "other");
    expect(fillShortcutKeys(text, resolved, false)).toBe("Press Undo (or Ctrl+Z), then Redo (Ctrl+Shift+Z).");
  });

  it("follows a rebinding", () => {
    const { resolved } = resolveShortcuts({ "history.undo": "Mod+Shift+u" }, undefined, "other");
    expect(fillShortcutKeys("{key:history.undo}", resolved, false)).toBe("Ctrl+Shift+U");
  });

  it("leaves an unknown id as written, so a typo shows", () => {
    const { resolved } = resolveShortcuts({}, undefined, "mac");
    expect(fillShortcutKeys("{key:no.such}", resolved, true)).toBe("{key:no.such}");
  });
});
