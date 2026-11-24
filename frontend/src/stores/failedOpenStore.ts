/**
 * The open that just failed, for the banner over the graph (#401).
 *
 * When opening a model fails outright (a missing file, a server error),
 * nothing new is opened and the model that was open stays on screen. A
 * message alone leaves the canvas looking as if nothing was asked for, so the
 * failure is kept here and drawn over the graph until it is dismissed, tried
 * again, or another model is opened.
 */

import { create } from "zustand";

export interface FailedOpen {
  /** The name of what the user tried to open (a file name, a catalog label). */
  attempted: string;
  /** Why it didn't open, as the server or the browser said. */
  reason: string;
  /**
   * The path of the model still open when it failed (a bundle's own path for
   * a bundle), or null if none was. The banner shows only while this is still
   * the open model, so it never speaks for a model opened since.
   */
  shownPath: string | null;
  /** Makes the same open again. */
  retry: () => void;
}

interface FailedOpenState {
  failed: FailedOpen | null;
  setFailed: (failed: FailedOpen) => void;
  clear: () => void;
}

export const useFailedOpenStore = create<FailedOpenState>((set) => ({
  failed: null,
  setFailed: (failed) => set({ failed }),
  clear: () => set({ failed: null }),
}));
