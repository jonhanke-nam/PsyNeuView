/**
 * Turning a keypress into a binding the user asked for. (#1112)
 *
 * Separate from the UI so the rules can be tested without a keyboard, and
 * separate from `parseBinding` because the questions differ: parsing asks
 * "is this expressible?", capture asks "is this a sensible thing to have just
 * pressed, and may this user have it?".
 */

import { BARE_ALLOWED, formatBinding, deliverability, type Binding } from "./binding";
import type { ResolvedShortcut } from "./registry";

export type CaptureResult =
  | { ok: true; spec: string }
  | { ok: false; reason: string }
  /** A modifier on its own — keep listening rather than complaining. */
  | { ok: false; pending: true; reason: string };

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "AltGraph", "Dead"]);

/**
 * Interpret a keydown as a candidate binding.
 *
 * `mac` decides which physical key is `Mod`; `deployment` decides whether the
 * browser would swallow the chord before PsyNeuView ever saw it.
 */
export function captureBinding(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  opts: {
    mac: boolean;
    deployment: "macApp" | "browser";
    shortcuts: ResolvedShortcut[];
    /** The shortcut being rebound, so it does not conflict with itself. */
    selfId: string;
  }
): CaptureResult {
  if (MODIFIER_KEYS.has(e.key)) {
    return { ok: false, pending: true, reason: "Keep holding — press a key too." };
  }

  const binding: Binding = {
    mod: opts.mac ? e.metaKey : e.ctrlKey,
    alt: opts.mac ? e.ctrlKey : e.metaKey,
    shift: e.shiftKey,
    option: e.altKey,
    // Option composes characters, so the physical key is the only reliable
    // identity — the same reason matching uses `code` for those bindings.
    key: e.altKey ? codeToKey(e.code) : normalize(e.key),
  };

  if (!binding.key) {
    return { ok: false, pending: true, reason: "Press a key." };
  }

  const bare = !binding.mod && !binding.alt && !binding.option;
  if (bare && !isSafeBare(binding.key)) {
    return {
      ok: false,
      reason: `${binding.key.toUpperCase()} on its own would fire while you type. Add Cmd or Ctrl.`,
    };
  }

  const spec = formatBinding(binding);

  const reach = deliverability(spec, opts.deployment);
  if (!reach.deliverable) {
    return { ok: false, reason: reach.reason ?? `${spec} cannot reach PsyNeuView.` };
  }

  const clash = opts.shortcuts.find(
    (s) => s.id !== opts.selfId && formatBinding(s.binding) === spec
  );
  if (clash) {
    return { ok: false, reason: `Already used by “${clash.label}”.` };
  }

  return { ok: true, spec };
}

function normalize(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** "KeyI" -> "i", "Digit1" -> "1", anything else unchanged. */
function codeToKey(code: string): string {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/**
 * May this key be bound with no modifier at all?
 *
 * Shares BARE_ALLOWED with the parser rather than keeping a second list: two
 * lists that must agree is one list waiting to disagree.
 */
function isSafeBare(key: string): boolean {
  return BARE_ALLOWED.has(key);
}
