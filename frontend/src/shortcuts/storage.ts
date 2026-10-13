/**
 * Where a user's shortcut overrides live. (#1112)
 *
 * localStorage, and the reason is not that it is simplest.
 *
 * PsyNeuView runs in four deployment modes, and one of them — `hosted` — is a
 * single backend shared by several people. A sidecar under `~/.psyneuview/`
 * would be per *server* there, so one person rebinding Cmd+I would rebind it
 * for everyone on the demo. localStorage is per browser profile, which on a
 * hosted instance is per person, and on the Mac app is per install. That is the
 * right granularity in every mode we support.
 *
 * The cost is that overrides do not follow a user between the Mac app and a
 * browser on the same machine. That is a real limitation, and the honest trade:
 * wrong-for-everyone on the demo is worse than not-shared on one desktop.
 */

import { recordSettingChanged } from "@/utils/activityLog";
import { parseBinding } from "./binding";

const KEY = "psyneuview.shortcutOverrides.v1";

/**
 * Fired after overrides change, so the live listener picks them up without a
 * reload. A plain event rather than a store because the shortcut layer has no
 * other reason to depend on one.
 */
export const OVERRIDES_CHANGED = "psyneuview:shortcut-overrides-changed";

function announce(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OVERRIDES_CHANGED));
  }
}

export type Overrides = Record<string, string>;

/**
 * Read stored overrides.
 *
 * Validated on the way in, and anything unusable is dropped rather than
 * returned: a binding that no longer parses — because the grammar tightened,
 * or because someone edited localStorage — must not take its shortcut down
 * with it. `resolveShortcuts` also falls back per-shortcut, so this is the
 * belt to that's braces.
 */
export function loadOverrides(): Overrides {
  if (typeof localStorage === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Safari in private mode, or storage disabled entirely. Defaults are fine.
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const out: Overrides = {};
  for (const [id, spec] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof spec !== "string") continue;
    if (!parseBinding(spec).ok) continue;
    out[id] = spec;
  }
  return out;
}

/** Persist overrides. Returns false when storage is unavailable. */
export function saveOverrides(overrides: Overrides): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    if (Object.keys(overrides).length === 0) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, JSON.stringify(overrides));
    }
    return true;
  } catch {
    return false;
  }
}

/** Set one override, or clear it by passing null. */
export function setOverride(id: string, spec: string | null): Overrides {
  const current = loadOverrides();
  if (spec === null) {
    delete current[id];
  } else {
    current[id] = spec;
  }
  saveOverrides(current);
  recordSettingChanged("keyboard-shortcuts", spec ?? "default", `keyboard-shortcuts: ${id} = ${spec ?? "default"}`);
  announce();
  return current;
}

export function clearOverrides(): Overrides {
  saveOverrides({});
  recordSettingChanged("keyboard-shortcuts", "defaults", "keyboard-shortcuts: all reset to defaults");
  announce();
  return {};
}
