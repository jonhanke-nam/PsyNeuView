/**
 * Parsing and matching keyboard bindings. (#1112)
 *
 * One parser, used by the defaults, by the override loader, and by the
 * rebinding UI — so a binding that cannot be expressed cannot be stored.
 *
 * `Mod` means Cmd on macOS and Ctrl elsewhere, so a binding is written once.
 */

export interface Binding {
  /** Cmd on macOS, Ctrl elsewhere. */
  mod: boolean;
  /** The *other* one — Ctrl on macOS, Cmd elsewhere. Rare, but expressible. */
  alt: boolean;
  shift: boolean;
  /** Option on macOS, Alt elsewhere. Forces code-based matching. */
  option: boolean;
  /** Normalised: single characters lowercased, named keys as written. */
  key: string;
}

export type ParseResult =
  | { ok: true; binding: Binding }
  | { ok: false; reason: string };

/**
 * Which platform's modifier layout to use.
 *
 * Detected once, but every function that depends on it takes it as an argument
 * with this as the default. Baking it in as a module constant made the module
 * untestable for the other platform — and CI, being Linux, proved it: five
 * matcher tests passed on a Mac and failed there, because `Mod` silently meant
 * Ctrl instead of Cmd.
 */
export function looksLikeMac(platform: string): boolean {
  // Case-insensitive, deliberately. `navigator.userAgentData.platform` reports
  // "macOS" with a lowercase m, while `navigator.platform` reports "MacIntel".
  // A case-sensitive test matched the second and missed the first — and since
  // the first is checked first and is a non-empty string, it short-circuited
  // there and every Mac showed "Ctrl+S" instead of ⌘S.
  return /mac|iphone|ipad/i.test(platform);
}

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  // Each source checked on its own: falling through on a *falsy* value is not
  // the same as falling through on one that simply does not look like a Mac.
  for (const candidate of [nav.userAgentData?.platform, nav.platform, nav.userAgent]) {
    if (candidate && looksLikeMac(candidate)) return true;
  }
  return false;
}

const IS_MAC = detectMac();

/** Keys that are safe to bind with no modifier, because they aren't typing. */
export const BARE_ALLOWED = new Set([
  "Escape", "Enter", "Tab", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);

/**
 * Chords that never reach us, per deployment.
 *
 * The OS ones are taken before any app sees them. The browser ones belong to
 * the browser in the React app, but are ours inside the Mac app's WKWebView —
 * so the same binding can be valid in one deployment and not the other. A
 * rebinding UI that accepts one of these is lying to the user.
 */
const OS_RESERVED = new Set(["Mod+q", "Mod+Tab", "Mod+ "]);
const BROWSER_RESERVED = new Set(["Mod+w", "Mod+t", "Mod+n", "Mod+l"]);

export function isMac(): boolean {
  return IS_MAC;
}

/** Normalise a key name: single characters lowercased, named keys untouched. */
function normalizeKey(raw: string): string {
  return raw.length === 1 ? raw.toLowerCase() : raw;
}

/**
 * Parse `"Mod+Shift+I"` into a binding, or explain why it cannot be one.
 *
 * The rules, and why:
 *
 * - **Cmd or Ctrl is required** for ordinary keys, because a bare letter
 *   collides with typing and so does Shift alone.
 * - **At most two non-Shift modifiers.** Cmd+Ctrl+S is reachable;
 *   Cmd+Ctrl+Opt+S is a party trick.
 * - Function keys, Escape, Enter, Tab, the arrows and the delete keys may be
 *   bound bare, since none of them is typing.
 */
export function parseBinding(spec: string): ParseResult {
  const parts = spec.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: "Empty binding." };

  const binding: Binding = { mod: false, alt: false, shift: false, option: false, key: "" };
  for (const part of parts.slice(0, -1)) {
    switch (part.toLowerCase()) {
      case "mod": case "cmd": case "meta": binding.mod = true; break;
      case "ctrl": case "control": binding.alt = true; break;
      case "shift": binding.shift = true; break;
      case "opt": case "option": case "alt": binding.option = true; break;
      default: return { ok: false, reason: `Unknown modifier "${part}".` };
    }
  }
  binding.key = normalizeKey(parts[parts.length - 1]);
  if (!binding.key) return { ok: false, reason: "No key." };

  const nonShift = [binding.mod, binding.alt, binding.option].filter(Boolean).length;
  if (nonShift === 0 && !BARE_ALLOWED.has(binding.key)) {
    return {
      ok: false,
      reason: `"${binding.key}" needs Cmd or Ctrl — a bare key would fire while typing.`,
    };
  }
  if (nonShift > 2) {
    return { ok: false, reason: "Too many modifiers — two at most, besides Shift." };
  }
  return { ok: true, binding };
}

/** Canonical string form, so bindings can be compared and stored. */
export function formatBinding(b: Binding): string {
  const parts: string[] = [];
  if (b.mod) parts.push("Mod");
  if (b.alt) parts.push("Ctrl");
  if (b.option) parts.push("Opt");
  if (b.shift) parts.push("Shift");
  parts.push(b.key);
  return parts.join("+");
}

/** How it should read in the UI, using this platform's symbols. */
export function displayBinding(b: Binding, mac: boolean = IS_MAC): string {
  const parts: string[] = [];
  if (mac) {
    if (b.alt) parts.push("⌃");
    if (b.option) parts.push("⌥");
    if (b.shift) parts.push("⇧");
    if (b.mod) parts.push("⌘");
    return parts.join("") + (b.key.length === 1 ? b.key.toUpperCase() : b.key);
  }
  if (b.mod) parts.push("Ctrl");
  if (b.alt) parts.push("Cmd");
  if (b.option) parts.push("Alt");
  if (b.shift) parts.push("Shift");
  parts.push(b.key.length === 1 ? b.key.toUpperCase() : b.key);
  return parts.join("+");
}

/** Whether this chord can actually reach us in the given deployment. */
export function deliverability(
  spec: string,
  deployment: "macApp" | "browser"
): { deliverable: boolean; reason?: string } {
  const canonical = spec.replace(/\s+/g, "");
  if (OS_RESERVED.has(canonical)) {
    return { deliverable: false, reason: `${spec} is handled by the operating system.` };
  }
  if (deployment === "browser" && BROWSER_RESERVED.has(canonical)) {
    return {
      deliverable: false,
      reason: `${spec} is handled by the browser and would never reach PsyNeuView.`,
    };
  }
  return { deliverable: true };
}

/**
 * Does this event match this binding?
 *
 * Option is the awkward one. On macOS it composes characters — Opt+I is a dead
 * key for circumflex, so `event.key` is "ˆ" or "Dead", never "i". Bindings that
 * include Option therefore match on `event.code`, which is layout-independent;
 * everything else matches on `event.key`, so a binding follows the user's
 * layout rather than the physical keyboard.
 */
export function matchesEvent(
  b: Binding,
  e: KeyboardEvent,
  mac: boolean = IS_MAC
): boolean {
  const primary = mac ? e.metaKey : e.ctrlKey;
  const secondary = mac ? e.ctrlKey : e.metaKey;
  if (primary !== b.mod) return false;
  if (secondary !== b.alt) return false;
  if (e.shiftKey !== b.shift) return false;
  if (e.altKey !== b.option) return false;

  if (b.option) {
    // "i" -> "KeyI", "1" -> "Digit1", named keys are already code-shaped.
    const expected =
      b.key.length === 1
        ? /[0-9]/.test(b.key)
          ? `Digit${b.key}`
          : `Key${b.key.toUpperCase()}`
        : b.key;
    return e.code === expected;
  }
  return normalizeKey(e.key) === b.key;
}
