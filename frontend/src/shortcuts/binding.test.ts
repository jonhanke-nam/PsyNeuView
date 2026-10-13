import { describe, it, expect } from "vitest";
import {
  deliverability,
  displayBinding,
  formatBinding,
  looksLikeMac,
  matchesEvent,
  parseBinding,
} from "./binding";

const ok = (spec: string) => {
  const r = parseBinding(spec);
  if (!r.ok) throw new Error(`expected ${spec} to parse: ${r.reason}`);
  return r.binding;
};

describe("parseBinding", () => {
  it("parses a plain Mod binding", () => {
    expect(ok("Mod+s")).toMatchObject({ mod: true, shift: false, key: "s" });
  });

  it("parses Shift as a secondary modifier", () => {
    expect(ok("Mod+Shift+z")).toMatchObject({ mod: true, shift: true, key: "z" });
  });

  it("lowercases single-character keys so case never matters", () => {
    expect(ok("Mod+I").key).toBe("i");
    expect(formatBinding(ok("Mod+I"))).toBe(formatBinding(ok("Mod+i")));
  });

  it("keeps named keys as written", () => {
    expect(ok("Escape").key).toBe("Escape");
    expect(ok("Mod+Enter").key).toBe("Enter");
  });

  it("refuses a bare letter, which would fire while typing", () => {
    const r = parseBinding("k");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("needs Cmd or Ctrl");
  });

  it("refuses Shift alone for the same reason", () => {
    expect(parseBinding("Shift+k").ok).toBe(false);
  });

  it("allows keys that are not typing to be bound bare", () => {
    for (const key of ["Escape", "F5", "ArrowUp", "Backspace"]) {
      expect(parseBinding(key).ok).toBe(true);
    }
  });

  it("caps non-Shift modifiers at two", () => {
    expect(parseBinding("Mod+Ctrl+s").ok).toBe(true);
    const r = parseBinding("Mod+Ctrl+Opt+s");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Too many modifiers");
  });

  it("still allows Shift on top of two modifiers", () => {
    expect(parseBinding("Mod+Ctrl+Shift+s").ok).toBe(true);
  });

  it("names an unknown modifier rather than ignoring it", () => {
    const r = parseBinding("Hyper+s");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Hyper");
  });

  it("rejects an empty binding", () => {
    expect(parseBinding("").ok).toBe(false);
  });
});

describe("formatBinding round-trips", () => {
  it("survives parse -> format -> parse", () => {
    for (const spec of ["Mod+s", "Mod+Shift+z", "Mod+Opt+i", "Escape", "Mod+Ctrl+r"]) {
      const once = formatBinding(ok(spec));
      expect(formatBinding(ok(once))).toBe(once);
    }
  });
});

describe("deliverability", () => {
  it("refuses chords the OS takes, in either deployment", () => {
    for (const d of ["macApp", "browser"] as const) {
      expect(deliverability("Mod+q", d).deliverable).toBe(false);
    }
  });

  it("refuses browser-owned chords only in the browser", () => {
    // The same binding is valid in one deployment and not the other, which is
    // exactly why this is deployment-aware.
    expect(deliverability("Mod+w", "browser").deliverable).toBe(false);
    expect(deliverability("Mod+w", "macApp").deliverable).toBe(true);
  });

  it("explains itself, so the UI can say why", () => {
    const r = deliverability("Mod+w", "browser");
    expect(r.reason).toContain("browser");
    expect(r.reason).toContain("never reach");
  });

  it("allows an ordinary binding", () => {
    expect(deliverability("Mod+i", "browser").deliverable).toBe(true);
  });
});

// A KeyboardEvent stand-in: only the fields the matcher reads.
function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "", code: "", metaKey: false, ctrlKey: false,
    shiftKey: false, altKey: false, ...over,
  } as KeyboardEvent;
}

describe("matchesEvent", () => {
  // Every case is run on both platforms. The module used to bake the platform
  // in at import time, so these passed on a Mac and failed on CI's Linux with
  // `Mod` silently meaning Ctrl. Testing one platform was testing half the code.
  const MAC = true;
  const PC = false;
  const primary = (mac: boolean, held: boolean) =>
    mac ? { metaKey: held } : { ctrlKey: held };

  it.each([[MAC, "mac"], [PC, "pc"]])("matches a simple binding on %s", (mac) => {
    expect(matchesEvent(ok("Mod+s"), ev({ key: "s", ...primary(mac, true) }), mac)).toBe(true);
  });

  it.each([[MAC, "mac"], [PC, "pc"]])("needs the modifier on %s", (mac) => {
    expect(matchesEvent(ok("Mod+s"), ev({ key: "s" }), mac)).toBe(false);
  });

  it.each([[MAC, "mac"], [PC, "pc"]])("rejects an extra modifier on %s", (mac) => {
    // Mod+Shift+S must not fire Mod+S.
    expect(
      matchesEvent(ok("Mod+s"), ev({ key: "s", shiftKey: true, ...primary(mac, true) }), mac)
    ).toBe(false);
  });

  it("maps Mod to Cmd on mac and Ctrl elsewhere", () => {
    // The actual bug, stated directly.
    const b = ok("Mod+s");
    expect(matchesEvent(b, ev({ key: "s", metaKey: true }), MAC)).toBe(true);
    expect(matchesEvent(b, ev({ key: "s", ctrlKey: true }), MAC)).toBe(false);
    expect(matchesEvent(b, ev({ key: "s", ctrlKey: true }), PC)).toBe(true);
    expect(matchesEvent(b, ev({ key: "s", metaKey: true }), PC)).toBe(false);
  });

  it.each([[MAC, "mac"], [PC, "pc"]])("is case-insensitive about the key on %s", (mac) => {
    expect(
      matchesEvent(ok("Mod+Shift+z"), ev({ key: "Z", shiftKey: true, ...primary(mac, true) }), mac)
    ).toBe(true);
  });

  it.each([[MAC, "mac"], [PC, "pc"]])("matches Option bindings on code, not the character, on %s", (mac) => {
    // On macOS Opt+I is a dead key for circumflex: `key` is "ˆ" or "Dead",
    // never "i". Matching on `key` would mean it never fires, silently.
    const binding = ok("Mod+Opt+i");
    expect(
      matchesEvent(binding, ev({ key: "ˆ", code: "KeyI", altKey: true, ...primary(mac, true) }), mac)
    ).toBe(true);
    expect(
      matchesEvent(binding, ev({ key: "Dead", code: "KeyI", altKey: true, ...primary(mac, true) }), mac)
    ).toBe(true);
  });

  it.each([[MAC, "mac"], [PC, "pc"]])("maps digits to Digit codes on %s", (mac) => {
    expect(
      matchesEvent(ok("Mod+Opt+1"), ev({ key: "¡", code: "Digit1", altKey: true, ...primary(mac, true) }), mac)
    ).toBe(true);
  });

  it.each([[MAC, "mac"], [PC, "pc"]])("matches non-Option bindings on key, following the layout, on %s", (mac) => {
    // `code` would say KeyZ for the key labelled Y on a German keyboard.
    expect(
      matchesEvent(ok("Mod+z"), ev({ key: "z", code: "KeyY", ...primary(mac, true) }), mac)
    ).toBe(true);
  });

  it.each([[MAC, "mac"], [PC, "pc"]])("matches a bare named key on %s", (mac) => {
    expect(matchesEvent(ok("Escape"), ev({ key: "Escape" }), mac)).toBe(true);
  });
});

describe("displayBinding", () => {
  it("uses Mac symbols on a Mac", () => {
    expect(displayBinding(ok("Mod+Shift+z"), true)).toBe("⇧⌘Z");
  });

  it("uses words elsewhere", () => {
    expect(displayBinding(ok("Mod+Shift+z"), false)).toBe("Ctrl+Shift+Z");
  });

  it("shows the letter for an Option binding, not the composed character", () => {
    expect(displayBinding(ok("Mod+Opt+i"), true)).toBe("⌥⌘I");
  });
});

describe("looksLikeMac", () => {
  // These tests exist because the ones above cannot catch a detection bug:
  // every matcher test names its platform explicitly, which was the right fix
  // for CI resolving it differently — but it left detection itself uncovered,
  // and a real Mac then displayed "Ctrl+S" for weeks' worth of an afternoon.
  it.each([
    ["macOS", "navigator.userAgentData.platform in Chrome"],
    ["MacIntel", "navigator.platform"],
    ["MacPPC", "an older navigator.platform"],
    ["iPhone", "iOS"],
    ["iPad", "iPadOS"],
  ])("recognises %s (%s)", (platform) => {
    expect(looksLikeMac(platform)).toBe(true);
  });

  it.each(["Win32", "Windows", "Linux x86_64", "Android", ""])(
    "does not claim %s is a Mac",
    (platform) => {
      expect(looksLikeMac(platform)).toBe(false);
    }
  );

  it("is case-insensitive, which is the bug it was written for", () => {
    expect(looksLikeMac("macOS")).toBe(looksLikeMac("MacIntel"));
  });
});
