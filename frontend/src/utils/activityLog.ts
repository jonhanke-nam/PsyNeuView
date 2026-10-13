/**
 * The activity log: what happened in this page since it loaded. (#1287)
 *
 * A capped, in-memory list of timestamped entries — menu commands, models
 * opened and saved, settings changed, runs and learning started and finished,
 * walkthrough steps, file changes seen on disk, every message shown to the
 * user — for a problem report. The Mac app's Report a Problem reads it through
 * `window.__pnvDiagnostics` (utils/diagnostics.ts), and Settings ▸ About can
 * download it in a browser.
 *
 * Scope, by policy (#1287, PsyNeuView-MacApp#208): only PsyNeuView and
 * PsyNeuLink state. Names and paths are recorded, never a model's source or
 * any file's contents; the home folder is written as `~`; and a value whose
 * key looks like a token, password or secret is never recorded at all. Those
 * rules are applied here, on the way in, so a caller cannot forget them.
 *
 * Deliberately not a store: nothing renders the log, so nothing subscribes to
 * it, and a plain module keeps it importable from stores without a cycle.
 */

export type ActivityKind =
  /** A menu item chosen, or a keyboard shortcut fired. */
  | "menu"
  /** A model opened, reopened or saved. */
  | "model"
  /** A setting changed: `data.key`, and `data.value` when it is safe to record. */
  | "setting"
  | "run"
  | "learn"
  /** Stepping through an execution trace. */
  | "step"
  | "walkthrough"
  /** A change on disk the file watcher saw. */
  | "file"
  /** A message shown to the user: `data.type` is error, warning, info or success. */
  | "notification"
  /** A model error shown in the diagnostics bar (not a notification). */
  | "error"
  /** The installed PsyNeuLink changing, or the Mac app's PsyNeuView install. */
  | "psyneulink";

export interface ActivityEntry {
  /** When, as an ISO time. */
  t: string;
  kind: ActivityKind;
  text: string;
  data?: Record<string, unknown>;
}

/** The last entries kept; older ones are dropped first. */
export const ACTIVITY_CAP = 2000;

/** A key whose value is never recorded. */
const SENSITIVE_KEY = /token|password|passwd|secret|credential|authorization|api[-_]?key/i;

const entries: ActivityEntry[] = [];

/** Record one entry. `text` and `data` are scrubbed; see `scrub`. */
export function record(kind: ActivityKind, text: string, data?: Record<string, unknown>): void {
  const entry: ActivityEntry = { t: new Date().toISOString(), kind, text: scrubText(text) };
  if (data !== undefined) {
    const clean = scrub(data) as Record<string, unknown>;
    if (Object.keys(clean).length > 0) entry.data = clean;
  }
  entries.push(entry);
  if (entries.length > ACTIVITY_CAP) entries.splice(0, entries.length - ACTIVITY_CAP);
}

/**
 * Record a setting change. The value is recorded only when the key is not a
 * sensitive one and `value` was given; an address or a token is passed as
 * `undefined` by the caller, and a sensitive key is dropped here regardless.
 */
export function recordSettingChanged(key: string, value?: unknown, text?: string): void {
  const safe = value !== undefined && !isSensitiveKey(key);
  record("setting", text ?? (safe ? `${key} = ${describeValue(value)}` : `${key} changed`), {
    key,
    ...(safe ? { value } : {}),
  });
}

/** A copy of the log, oldest first. */
export function activityEntries(): ActivityEntry[] {
  return entries.map((e) => ({ ...e, ...(e.data ? { data: { ...e.data } } : {}) }));
}

export function activityCount(): number {
  return entries.length;
}

/** Test seam. */
export function clearActivity(): void {
  entries.length = 0;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** `~` for the home folder, wherever one appears in `text` (macOS and Linux homes). */
export function abbreviateHome(text: string): string {
  return text.replace(/(^|[\s"'(=:,[])\/(?:Users|home)\/[^/\s"')\],]+(?=\/|$|[\s"')\],])/g, "$1~");
}

/** Credentials in a link are never recorded: `https://user:secret@host` → `https://[redacted]@host`. */
export function scrubText(text: string): string {
  return abbreviateHome(text).replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@");
}

/**
 * Apply the recording rules to any value: strings are scrubbed, a sensitive
 * key's value becomes `"[redacted]"`, and objects and arrays are walked.
 * Anything that isn't JSON (a function, a Map) is left out.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1)).filter((v) => v !== undefined);
  if (value instanceof Set) return Array.from(value).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // A string, or anything that could hold one, under a sensitive key is
      // redacted. A boolean or a number can't be a secret: "github_token:
      // true" says a token exists, which a report may know.
      if (isSensitiveKey(k) && v !== null && typeof v !== "boolean" && typeof v !== "number") {
        out[k] = "[redacted]";
        continue;
      }
      const clean = scrub(v, depth + 1);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return undefined;
}

/**
 * Record a menu item being chosen, from a click anywhere in a menu's list:
 * `onClickCapture={(e) => recordMenuClick("Open", e)}` on the list is the one
 * wiring a menu needs. The entry is the item's label ("Open › Open from
 * path..."), which for a model is its name — allowed; its contents are not.
 */
export function recordMenuClick(menu: string, e: { target: EventTarget | null }): void {
  const target = e.target as Element | null;
  const item = target?.closest?.("button, [role='menuitem']") as Element | null;
  if (!item) return;
  const label = (item.getAttribute("aria-label") || item.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (label) record("menu", `${menu} › ${label}`);
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
