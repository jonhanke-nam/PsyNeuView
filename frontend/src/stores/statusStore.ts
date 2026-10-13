/**
 * Global status store — tracks in-flight async operations.
 * Used to show a status bar so the user always knows what's happening.
 */

import { create } from "zustand";

interface StatusState {
  /** Currently active status message, or null if idle */
  message: string | null;
  /** Timestamp when the current status started */
  startedAt: number | null;

  /** Set a status message (call when an async operation starts) */
  setStatus: (message: string) => void;
  /** Clear the status (call when the operation finishes) */
  clearStatus: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  message: null,
  startedAt: null,

  setStatus: (message) => set({ message, startedAt: Date.now() }),
  clearStatus: () => set({ message: null, startedAt: null }),
}));
