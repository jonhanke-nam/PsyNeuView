/**
 * Which save "Revert the file to this save" is asking about (#1349), or
 * null when the question isn't open.
 *
 * A store rather than History's own state because History closes when the
 * question opens, and App draws the dialog once, over everything, as it does
 * Changes since save.
 */

import { create } from "zustand";
import type { SaveMark, Snapshot } from "./historyStore";

export interface RevertTarget {
  /** The step the save marked: its text is what goes back on disk. */
  snapshot: Snapshot;
  mark: SaveMark;
}

interface RevertToSaveState {
  target: RevertTarget | null;
  show: (target: RevertTarget) => void;
  hide: () => void;
}

export const useRevertToSaveStore = create<RevertToSaveState>((set) => ({
  target: null,
  show: (target) => set({ target }),
  hide: () => set({ target: null }),
}));
