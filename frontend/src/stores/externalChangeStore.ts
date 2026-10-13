/**
 * A change to the model's .py, seen on disk, that we have deliberately not
 * applied yet because it conflicts with unsaved edits here (#926).
 *
 * This lives in a store rather than in useFileWatcher because two unrelated
 * places need it: App renders the prompt, and CodeEditor has to hold off its
 * autosave while the question is open — otherwise the autosave writes our
 * buffer over the external editor's file, which is precisely the data loss the
 * prompt exists to prevent.
 */

import { create } from "zustand";

export interface PendingExternalChange {
  filePath: string;
  source: string;
  model: unknown;
}

interface ExternalChangeState {
  pending: PendingExternalChange | null;
  setPending: (change: PendingExternalChange) => void;
  clearPending: () => void;
}

export const useExternalChangeStore = create<ExternalChangeState>((set) => ({
  pending: null,
  setPending: (change) => set({ pending: change }),
  clearPending: () => set({ pending: null }),
}));
