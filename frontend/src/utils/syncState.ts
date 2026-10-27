/**
 * What the app is doing about the file on disk, in one word (#1028).
 *
 * Sync is invisible. When it works you see the canvas change and infer it; when
 * it stops — a backend restart, a socket that dropped, a watch that never armed
 * — you see nothing at all, and "no external changes" looks exactly like "not
 * watching". That ambiguity is most of what makes a two-headed setup feel
 * unreliable, and it is what #1026 was for the app's entire history: silently
 * off, with a UI that looked perfectly healthy.
 *
 * Pure so the wording and the precedence are testable without a socket.
 */

export type SyncKind = "watching" | "reloaded" | "conflict" | "paused" | "off";

export interface SyncInputs {
  /** Is the WebSocket open? */
  connected: boolean;
  /** The path the backend confirmed it is watching, if any. */
  watchedPath: string | null;
  /** The model currently open, if any. */
  filePath: string | null;
  /** True while an external change waits on the user's decision (#926). */
  hasConflict: boolean;
  /** When an external change was last applied. */
  lastAppliedAt: number | null;
  /** The user paused watching from the indicator's popover (#103). */
  paused?: boolean;
  now: number;
}

export interface SyncState {
  kind: SyncKind;
  label: string;
  hint: string;
}

/** How long "reloaded" lingers before falling back to "watching". */
export const RELOADED_MS = 4000;

export function deriveSyncState(i: SyncInputs): SyncState {
  // A decision the user owes us outranks everything: it is the only state that
  // is waiting on them rather than describing us.
  if (i.hasConflict) {
    return {
      kind: "conflict",
      label: "Waiting on you",
      hint: "This file changed on disk while you had unsaved edits. Choose which to keep.",
    };
  }

  if (!i.filePath) {
    return { kind: "off", label: "No model open", hint: "Open a model to watch it for changes." };
  }

  // The user's own choice reads as theirs, not as something that went wrong.
  if (i.paused) {
    return {
      kind: "paused",
      label: "Watching paused",
      hint: "You paused watching. Edits made outside PsyNeuView will not appear here until you resume.",
    };
  }

  // Connected is not the same as armed: the socket can be open while the
  // backend watches nothing, which is precisely how sync used to fail. Each
  // gets its own reason (#103), so "not watching" says why.
  if (!i.connected) {
    return {
      kind: "off",
      label: "Not watching",
      hint:
        "Not connected to the PsyNeuView server, so edits made outside PsyNeuView will not appear here. " +
        "It reconnects on its own.",
    };
  }
  if (!i.watchedPath) {
    return {
      kind: "off",
      label: "Not watching",
      hint:
        "Connected, but the server has not confirmed it is watching this file, so edits made outside " +
        "PsyNeuView will not appear here.",
    };
  }

  if (i.lastAppliedAt !== null && i.now - i.lastAppliedAt < RELOADED_MS) {
    return {
      kind: "reloaded",
      label: "Reloaded from disk",
      hint: "This file changed in another editor, and the canvas has been updated to match.",
    };
  }

  return {
    kind: "watching",
    label: "Watching for changes",
    hint:
      `PsyNeuView is watching this file (${basename(i.watchedPath)}). ` +
      "Edits made outside PsyNeuView appear here automatically.",
  };
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}
