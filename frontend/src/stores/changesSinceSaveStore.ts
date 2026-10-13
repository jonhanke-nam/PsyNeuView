/**
 * Whether "Changes since save" is open (#1348).
 *
 * A store rather than local state because three unrelated places open it —
 * the unsaved dot beside the model name, History, and (one day) the editor —
 * and App draws it once, over everything.
 */

import { create } from "zustand";

interface ChangesSinceSaveState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useChangesSinceSaveStore = create<ChangesSinceSaveState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
