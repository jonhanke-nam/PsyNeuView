/**
 * Autosave (#1347): the rules, as plain functions, so they can be tested
 * without a browser.
 *
 * Autosave is a setting, off by default. When it is on, the model is saved
 * N seconds after the last edit, if there are unsaved changes — through the
 * very same Save the toolbar button and ⌘S use (`requestSave`), never a
 * writer of its own. The history: typing used to save on a 1.5 s timer, and
 * that was removed because it wrote a file another editor (PyCharm) had open
 * (#1029, #1040). Off by default keeps that workflow safe; turning it on is
 * the user's choice.
 *
 * Even when it is on, it does not save when:
 *  - there is no file, or the model came from a .pnlproject bundle (Save
 *    re-zips the bundle and has no check for a changed file);
 *  - the model is locked (view only), or it is a PsyNeuLink file that can't
 *    be edited here;
 *  - the "file changed on disk" question is open, or the file changed on
 *    disk since it was opened or saved (until the next manual Save);
 *  - the code has an error, or the latest edit hasn't been built yet: only
 *    code that has been seen to build is written automatically;
 *  - a save is already in flight.
 */

export const AUTOSAVE_DEFAULT_SECONDS = 10;
export const AUTOSAVE_MIN_SECONDS = 2;
export const AUTOSAVE_MAX_SECONDS = 600;

/** A whole number of seconds inside the allowed range. */
export function clampAutosaveSeconds(value: number): number {
  if (!Number.isFinite(value)) return AUTOSAVE_DEFAULT_SECONDS;
  return Math.min(AUTOSAVE_MAX_SECONDS, Math.max(AUTOSAVE_MIN_SECONDS, Math.round(value)));
}

/** Why autosave is not saving right now, or null when nothing stops it. */
export type AutosaveBlock =
  | "noFile"
  | "bundle"
  | "protected"
  | "locked"
  | "externalChange"
  | "diskChanged"
  | "codeError"
  | "building"
  | "saving";

export interface AutosaveInputs {
  filePath: string | null;
  bundleOrigin: string | null;
  /** A PsyNeuLink file that can't be edited here (pnlSourceStore.isProtected). */
  pnlProtected: boolean;
  /** The model is locked, view only (editLockStore). */
  viewOnly: boolean;
  /** The "file changed on disk" question is open (externalChangeStore). */
  externalChangePending: boolean;
  /** A change on disk was seen since the last open or save. */
  diskChangedSinceSave: boolean;
  /** The latest build of the code failed. */
  modelError: boolean;
  /** The text in the editor is the text that last built cleanly. */
  sourceBuilt: boolean;
  /** A Save (manual or automatic) is in flight. */
  saving: boolean;
}

/**
 * The first thing that stops autosave, in the order a user would want it
 * explained: the ones that never lift on their own first.
 */
export function autosaveBlock(i: AutosaveInputs): AutosaveBlock | null {
  if (!i.filePath) return "noFile";
  if (i.bundleOrigin) return "bundle";
  if (i.pnlProtected) return "protected";
  if (i.viewOnly) return "locked";
  if (i.externalChangePending) return "externalChange";
  if (i.diskChangedSinceSave) return "diskChanged";
  if (i.saving) return "saving";
  if (i.modelError) return "codeError";
  if (!i.sourceBuilt) return "building";
  return null;
}

/** "just now", "12 s ago", "3 min ago", "2 h ago". */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

export type AutosaveTone = "muted" | "warning";

export interface AutosaveStatusInput {
  enabled: boolean;
  block: AutosaveBlock | null;
  dirty: boolean;
  /** The idle time has passed and autosave would save if nothing stopped it. */
  due: boolean;
  autosaving: boolean;
  /** When this file was last autosaved in this session. */
  lastAutosavedAt: number | null;
  /** The last autosave did not save (the error is shown as for a manual Save). */
  lastFailed: boolean;
  now: number;
}

/**
 * The words next to the model name, or null for nothing. Nothing at all when
 * autosave is off, so the default looks exactly as it did before.
 */
export function autosaveStatus(s: AutosaveStatusInput): { text: string; tone: AutosaveTone } | null {
  if (!s.enabled) return null;
  const b = s.block;
  if (b === "noFile" || b === "protected") return null; // nothing to save, or the badge already says why
  if (b === "bundle") return { text: "Autosave off for bundles", tone: "muted" };
  if (s.autosaving) return { text: "Autosaving…", tone: "muted" };
  if (s.dirty) {
    if (b === "locked") return { text: "Autosave paused: model is locked", tone: "warning" };
    if (b === "externalChange" || b === "diskChanged")
      return { text: "Autosave paused: file changed on disk", tone: "warning" };
    if (b === "codeError") return { text: "Autosave waiting: code has an error", tone: "warning" };
    if (b === "building" && s.due) return { text: "Autosave waiting: checking the code", tone: "muted" };
    if (s.lastFailed) return { text: "Autosave didn't save", tone: "warning" };
  }
  if (s.lastAutosavedAt !== null) return { text: `Autosaved ${formatAgo(s.now - s.lastAutosavedAt)}`, tone: "muted" };
  return { text: "Autosave on", tone: "muted" };
}

/** The tooltip: that it's on, after how long, and where to change it. */
export function autosaveTooltip(seconds: number, block: AutosaveBlock | null): string {
  const lines = [
    `Autosave is on: your model is saved ${seconds} s after your last edit, if there are unsaved changes.`,
  ];
  if (block === "bundle")
    lines.push("A model opened from a .pnlproject bundle is saved only when you press Save.");
  if (block === "codeError")
    lines.push("It waits while the code has an error, so a half-typed edit is never written. Save writes it anyway.");
  if (block === "diskChanged" || block === "externalChange")
    lines.push("The file changed on disk since you opened or saved it. Press Save to choose; autosave resumes after that.");
  if (block === "locked") lines.push("The model is locked (view only); unlock it to save.");
  lines.push("Change it in Settings ▸ General ▸ Model files (click to open).");
  return lines.join("\n");
}

/**
 * The timer: restarts on every edit, fires once N seconds after the last
 * one. When it fires and something stops the save, it stays due and tries
 * again when anything changes (`recheck`), so a build that finishes a moment
 * later still gets saved; an edit starts the wait over.
 *
 * One attempt per wait: an autosave that fails (the error shown as for a
 * manual Save) is not retried until the next edit, so a failing disk can't
 * fill the screen with errors.
 */
export interface AutosaveScheduler {
  /** An edit happened: start the wait over. */
  activity(): void;
  /** Something autosave depends on changed: save now if it is due and allowed. */
  recheck(): void;
  /** True while the wait has passed and a save is still owed. */
  isDue(): boolean;
  dispose(): void;
}

export function createAutosaveScheduler(opts: {
  delayMs: () => number;
  enabled: () => boolean;
  dirty: () => boolean;
  block: () => AutosaveBlock | null;
  save: () => Promise<void>;
  onChange?: () => void;
}): AutosaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let due = false;
  let attempting = false;
  let disposed = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const tryFire = () => {
    if (disposed || attempting || !due) return;
    if (!opts.enabled() || !opts.dirty()) {
      due = false;
      opts.onChange?.();
      return;
    }
    if (opts.block() !== null) {
      opts.onChange?.();
      return; // stays due; recheck() tries again
    }
    due = false;
    attempting = true;
    opts.onChange?.();
    void opts.save().finally(() => {
      attempting = false;
      opts.onChange?.();
      tryFire(); // edits made during the save have had their own wait
    });
  };

  return {
    activity() {
      clear();
      const wasDue = due;
      due = false;
      if (wasDue) opts.onChange?.();
      if (!opts.enabled()) return;
      timer = setTimeout(() => {
        timer = null;
        due = true;
        tryFire();
      }, opts.delayMs());
    },
    recheck: tryFire,
    isDue: () => due,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
