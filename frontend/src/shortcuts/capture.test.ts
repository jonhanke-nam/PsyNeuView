import { describe, it, expect } from "vitest";
import { captureBinding } from "./capture";
import { resolveShortcuts } from "./registry";

// Rebinding: what a user may press, and what they are told when they may not.

const shortcuts = resolveShortcuts().resolved;

const press = (
  over: Partial<KeyboardEvent>,
  opts: Partial<Parameters<typeof captureBinding>[1]> = {}
) =>
  captureBinding(
    { key: "", code: "", metaKey: false, ctrlKey: false,
      shiftKey: false, altKey: false, ...over } as KeyboardEvent,
    { mac: true, deployment: "macApp", shortcuts, selfId: "none", ...opts }
  );

describe("capturing a binding", () => {
  it("accepts an ordinary chord", () => {
    const r = press({ key: "k", metaKey: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toBe("Mod+k");
  });

  it("keeps listening while only modifiers are held", () => {
    // Pressing Cmd first is how every chord starts; complaining then would make
    // the control feel broken.
    const r = press({ key: "Meta", metaKey: true });
    expect(r.ok).toBe(false);
    expect("pending" in r && r.pending).toBe(true);
  });

  it("refuses a bare letter, and says why", () => {
    const r = press({ key: "k" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Add Cmd or Ctrl");
  });

  it("allows a bare key that is not typing", () => {
    expect(press({ key: "F5" }).ok).toBe(true);
  });

  it("names the shortcut a chord is already taken by", () => {
    // Better than accepting it and having two things fire.
    const r = press({ key: "z", metaKey: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Undo");
  });

  it("lets a shortcut keep its own binding", () => {
    // Rebinding undo to what it already is should not be a conflict.
    const r = press({ key: "z", metaKey: true }, { selfId: "history.undo" });
    expect(r.ok).toBe(true);
  });

  it("refuses a chord the browser would swallow, only in the browser", () => {
    // The same binding is fine inside the Mac app's WKWebView.
    const inBrowser = press({ key: "w", metaKey: true }, { deployment: "browser" });
    expect(inBrowser.ok).toBe(false);
    if (!inBrowser.ok) expect(inBrowser.reason).toContain("browser");
    expect(press({ key: "w", metaKey: true }, { deployment: "macApp" }).ok).toBe(true);
  });

  it("refuses what the OS takes, in either deployment", () => {
    for (const deployment of ["macApp", "browser"] as const) {
      expect(press({ key: "q", metaKey: true }, { deployment }).ok).toBe(false);
    }
  });

  it("reads an Option chord from the physical key, not the character", () => {
    // Opt+I reports "ˆ" — capturing that would store a binding nobody can type.
    const r = press({ key: "ˆ", code: "KeyI", metaKey: true, altKey: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toBe("Mod+Opt+i");
  });

  it("maps Mod to the right physical key per platform", () => {
    expect(press({ key: "k", metaKey: true }, { mac: true }).ok).toBe(true);
    // On a PC the same press is Cmd, which is the *secondary* modifier.
    const onPc = press({ key: "k", ctrlKey: true }, { mac: false });
    expect(onPc.ok).toBe(true);
    if (onPc.ok) expect(onPc.spec).toBe("Mod+k");
  });
});
