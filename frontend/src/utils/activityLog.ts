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
 * User actions — menus, buttons, the canvas, edits — can be switched off in
 * Settings ▸ General (#177): then they are neither recorded nor saved, the
 * ones already recorded are dropped, and a report says logging was off.
 * Errors, messages shown, waits and what the app did stay on, because a
 * report is hard to use without them. The saver (utils/activitySaver.ts)
 * keeps a copy on disk, through the server, so a restart doesn't lose it.
 *
 * Deliberately not a store: nothing renders the log, so nothing subscribes to
 * it, and a plain module keeps it importable from stores without a cycle.
 */

export type ActivityKind =
  /** A menu opened, a menu item chosen, or a keyboard shortcut fired. */
  | "menu"
  /** A button or a tab pressed anywhere else (utils/clickLog.ts). */
  | "click"
  /** Selecting or dragging on the graph. */
  | "canvas"
  /** A change to the model that undo knows about, and undo and redo themselves. */
  | "edit"
  /** The log itself: action logging turned off, or a page that loaded. */
  | "logging"
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
  | "psyneulink"
  /** A wait, from the wait log (utils/waitLog.ts), merged in for a report. */
  | "wait";

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

/** Each entry with its sequence number, so the saver can ask for what's new. */
const kept: { seq: number; entry: ActivityEntry }[] = [];
/** How many entries have ever been recorded: the sequence number of the last one. */
let recorded = 0;

type Listener = (entry: ActivityEntry) => void;
const listeners = new Set<Listener>();

/** Be told of each entry as it is recorded (the saver). Returns the unsubscribe. */
export function onRecorded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── The action-logging setting (#177) ───────────────────────────────────────

export const ACTION_LOGGING_KEY = "psyneuview.activityLog.actions";

/**
 * The kinds that are the user doing something, which the setting turns off.
 * A run, learning or a walkthrough stays on: those are what the app did,
 * with an outcome, and a report needs them to say what a wait or an error
 * belonged to.
 */
export const USER_ACTION_KINDS: ReadonlySet<ActivityKind> = new Set<ActivityKind>(["menu", "click", "canvas", "edit", "step"]);

/** What a report says in place of the actions when logging is off. */
export const ACTION_LOGGING_OFF_NOTE = "Action logging was off: what the user did was not recorded (Settings ▸ General).";

let actionLogging: boolean | null = null;

/** Whether user actions are being recorded: on unless Settings turned it off. */
export function actionLoggingOn(): boolean {
  if (actionLogging === null) {
    try {
      actionLogging = localStorage.getItem(ACTION_LOGGING_KEY) !== "off";
    } catch {
      actionLogging = true;
    }
  }
  return actionLogging;
}

type ActionLoggingListener = (on: boolean) => void;
const actionLoggingListeners = new Set<ActionLoggingListener>();

/** Be told when the setting changes (the saver, which clears the saved copy). */
export function onActionLoggingChanged(listener: ActionLoggingListener): () => void {
  actionLoggingListeners.add(listener);
  return () => actionLoggingListeners.delete(listener);
}

/**
 * Turn the logging of user actions on or off. Turning it off drops the
 * actions already recorded, here and (through the listeners) on disk; the
 * change itself is recorded, so a report can see when it happened.
 */
export function setActionLogging(on: boolean): void {
  const was = actionLoggingOn();
  actionLogging = on;
  try {
    localStorage.setItem(ACTION_LOGGING_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice holds for this page.
  }
  if (!on) {
    for (let i = kept.length - 1; i >= 0; i--) if (USER_ACTION_KINDS.has(kept[i].entry.kind)) kept.splice(i, 1);
  }
  if (was !== on) recordSettingChanged("activity-log-actions", on ? "on" : "off");
  for (const listener of actionLoggingListeners) listener(on);
}

/** Record one entry. `text` and `data` are scrubbed; see `scrub`. */
export function record(kind: ActivityKind, text: string, data?: Record<string, unknown>): void {
  if (USER_ACTION_KINDS.has(kind) && !actionLoggingOn()) return;
  const entry: ActivityEntry = { t: new Date().toISOString(), kind, text: scrubText(text) };
  if (data !== undefined) {
    const clean = scrub(data) as Record<string, unknown>;
    if (Object.keys(clean).length > 0) entry.data = clean;
  }
  kept.push({ seq: ++recorded, entry });
  if (kept.length > ACTIVITY_CAP) kept.splice(0, kept.length - ACTIVITY_CAP);
  for (const listener of listeners) listener(entry);
}

/** The sequence number of the last entry recorded, for `entriesSince`. */
export function activitySequence(): number {
  return recorded;
}

/** The entries recorded after sequence number `seq`, oldest first (copies). */
export function entriesSince(seq: number): ActivityEntry[] {
  return kept.filter((k) => k.seq > seq).map((k) => copyEntry(k.entry));
}

function copyEntry(e: ActivityEntry): ActivityEntry {
  return { ...e, ...(e.data ? { data: { ...e.data } } : {}) };
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

/** The kinds that are the user doing something, so may have started a wait. */
const ACTION_KINDS: ReadonlySet<ActivityKind> = new Set<ActivityKind>([
  ...USER_ACTION_KINDS,
  "run",
  "learn",
  "walkthrough",
]);

/**
 * The latest thing the user did, or null: what a wait is "likely from"
 * (utils/waitLog.ts). Null when action logging is off, so no wait is linked
 * to an action the log doesn't have.
 */
export function latestAction(): ActivityEntry | null {
  if (!actionLoggingOn()) return null;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (ACTION_KINDS.has(kept[i].entry.kind)) return kept[i].entry;
  }
  return null;
}

/** A copy of the log, oldest first. */
export function activityEntries(): ActivityEntry[] {
  return kept.map((k) => copyEntry(k.entry));
}

export function activityCount(): number {
  return kept.length;
}

/** Test seam: forget everything, and read the setting afresh. */
export function clearActivity(): void {
  kept.length = 0;
  recorded = 0;
  actionLogging = null;
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
