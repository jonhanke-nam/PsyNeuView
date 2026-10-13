/**
 * The per-model lock: whether the open model may be changed from the graph
 * and the inspector (#1116, #1309).
 *
 * The lock lives in the model's layout file (`editLock` in `.pnlview.json`),
 * not in a preference, so a curated model can ship locked and stays locked
 * for whoever opens it. The backend enforces it on every generated write;
 * this store only lets the toolbar show the "view only" tag and offer the
 * Lock / Unlock menu items, which both go through the same API.
 *
 * Since #1346 (part 2) the model's own file can ask for it too: a
 * `# PsyNeuView: protected` line near the top opens the model read only
 * (unlockable, remembered on this computer), and `# PsyNeuView: protected
 * permanently` does so with no unlock at all. The backend answers which rule
 * applies (`rule`), whether an unlock is offered (`canUnlock`) and why
 * (`message`); `mode` stays the one thing most readers need.
 */

import { create } from "zustand";
import { record } from "@/utils/activityLog";

export type EditMode = "editable" | "viewOnly";

/** Which of the model's own rules makes it read only, strictest first. */
export type EditRule = "protectedPermanently" | "protected" | "lock";

interface EditModeAnswer {
  mode: EditMode;
  rule?: EditRule | null;
  canUnlock?: boolean;
  unlockedHere?: boolean;
  message?: string | null;
}

interface EditLockState {
  filePath: string | null;
  /** null until the backend has answered for `filePath`. */
  mode: EditMode | null;
  /** The rule behind `mode === "viewOnly"`; null when editable or unknown. */
  rule: EditRule | null;
  /** Whether PsyNeuView offers an unlock (never for "protectedPermanently"). */
  canUnlock: boolean;
  /** The file says `# PsyNeuView: protected` and was unlocked on this computer. */
  unlockedHere: boolean;
  /** Why it is read only, and how (or whether) to undo it. */
  message: string | null;
  refresh: (filePath: string | null) => Promise<void>;
  /**
   * Ask again for the open file without first forgetting the answer, so the
   * tag and the editor don't flicker: after a save, or when the file changed
   * on disk and its protection line may have come or gone (#1346).
   */
  recheck: () => Promise<void>;
  /** Lock (`"viewOnly"`) or unlock (`"editable"`) the open model. */
  setMode: (mode: EditMode) => Promise<boolean>;
}

const UNKNOWN = { mode: null, rule: null, canUnlock: false, unlockedHere: false, message: null };

function fromAnswer(data: EditModeAnswer) {
  return {
    mode: data.mode,
    rule: data.rule ?? null,
    canUnlock: data.canUnlock ?? data.mode === "viewOnly",
    unlockedHere: !!data.unlockedHere,
    message: data.message ?? null,
  };
}

async function ask(filePath: string): Promise<EditModeAnswer | null> {
  try {
    const resp = await fetch(`/api/model/edit-mode?file_path=${encodeURIComponent(filePath)}`);
    if (!resp.ok) return null;
    return (await resp.json()) as EditModeAnswer;
  } catch {
    // Not knowing the mode is not worth a message; the API still enforces it.
    return null;
  }
}

export const useEditLockStore = create<EditLockState>((set, get) => ({
  filePath: null,
  ...UNKNOWN,

  refresh: async (filePath) => {
    set({ filePath, ...UNKNOWN });
    if (!filePath) return;
    const data = await ask(filePath);
    // A later file may have opened while this one was being asked about.
    if (data && get().filePath === filePath) set(fromAnswer(data));
  },

  recheck: async () => {
    const { filePath } = get();
    if (!filePath) return;
    const data = await ask(filePath);
    if (data && get().filePath === filePath) set(fromAnswer(data));
  },

  setMode: async (mode) => {
    const { filePath } = get();
    if (!filePath) return false;
    try {
      const resp = await fetch("/api/model/edit-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: filePath, mode }),
      });
      if (!resp.ok) {
        // A file that says "protected permanently" refuses an unlock (409);
        // re-read so the tag and the editor show why.
        void get().recheck();
        return false;
      }
      const data = (await resp.json()) as EditModeAnswer;
      record("model", data.mode === "viewOnly" ? `Locked (view only): ${filePath}` : `Unlocked: ${filePath}`, { path: filePath, mode: data.mode });
      if (get().filePath === filePath) set(fromAnswer(data));
      return true;
    } catch {
      return false;
    }
  },
}));
