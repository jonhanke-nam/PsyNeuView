/**
 * Whether the open file belongs to the active PsyNeuLink, and if so whether it
 * may be edited (#1225).
 *
 * A PsyNeuLink library model opens in place, so the file on screen is a file of
 * the installed PsyNeuLink. From GitHub or PyPI it's never edited; the user's
 * own local checkout is editable by default and stays so unless they protect
 * it (#1305). The backend enforces this on every write; this store only lets
 * the toolbar and the editor say so, and the editor stay read-only rather than
 * offer edits that would be refused.
 */

import { create } from "zustand";
import { record } from "@/utils/activityLog";

export interface PnlSourceStatus {
  owned: boolean;
  kind?: "github" | "pypi" | "local";
  root?: string;
  editable?: boolean;
  message?: string;
}

interface PnlSourceState {
  filePath: string | null;
  status: PnlSourceStatus | null;
  refresh: (filePath: string | null) => Promise<void>;
  /** Protect the open file's checkout from edits, or allow edits again. */
  setProtected: (protect: boolean) => Promise<boolean>;
}

/** True when the open file is a PsyNeuLink file that can't be edited now. */
export function isProtected(status: PnlSourceStatus | null): boolean {
  return !!status?.owned && !status.editable;
}

/**
 * True when the open file belongs to a PsyNeuLink that PsyNeuView manages
 * (GitHub, PyPI, a kept release): read only, with no switch to change it.
 * Your own checkout is not managed, protected or not (#1346).
 */
export function isManaged(status: PnlSourceStatus | null): boolean {
  return !!status?.owned && status.kind !== "local";
}

/** True when the open file is in your own PsyNeuLink checkout (#1346). */
export function isOwnCheckout(status: PnlSourceStatus | null): boolean {
  return !!status?.owned && status.kind === "local";
}

export const usePnlSourceStore = create<PnlSourceState>((set, get) => ({
  filePath: null,
  status: null,

  refresh: async (filePath) => {
    set({ filePath, status: null });
    if (!filePath) return;
    try {
      const resp = await fetch("/api/model/pnl-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: filePath }),
      });
      if (!resp.ok) return;
      const status = (await resp.json()) as PnlSourceStatus;
      // A later file may have opened while this one was being asked about.
      if (get().filePath === filePath) set({ status });
    } catch {
      // Not knowing is not worth a message: the backend still enforces it.
    }
  },

  setProtected: async (protect) => {
    const { filePath } = get();
    if (!filePath) return false;
    try {
      const resp = await fetch("/api/model/pnl-source/protect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: filePath, protect }),
      });
      if (!resp.ok) return false;
      const status = (await resp.json()) as PnlSourceStatus;
      record("model", protect ? `Checkout protected from edits: ${status.root ?? filePath}` : `Checkout editable again: ${status.root ?? filePath}`, {
        path: filePath,
        protect,
      });
      set({ status });
      return true;
    } catch {
      return false;
    }
  },
}));
