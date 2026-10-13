/**
 * Who else is connected to this instance (#1082).
 *
 * A hosted PsyNeuView is one shared workspace, so two people at once see each
 * other's files and block each other's runs. This holds the backend's view of
 * that, pushed over the same WebSocket the file watcher already uses.
 *
 * `available` is deliberately separate from an empty `others`. "Nobody else is
 * here" is reassuring; "we cannot tell" is a reason to be careful. Collapsing
 * them into one falsy value would let the UI make a claim it cannot support —
 * which on a local run, where nothing is authenticating anyone, it never can.
 */

import { create } from "zustand";

interface PresenceState {
  /** Whether this deployment can report presence at all. */
  available: boolean;
  /** Display names of *other* people connected — never this user's own tabs. */
  others: string[];
  setPresence: (available: boolean, others: string[]) => void;
  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  available: false,
  others: [],
  setPresence: (available, others) => set({ available, others }),
  // On disconnect we stop knowing, rather than knowing nobody is there.
  reset: () => set({ available: false, others: [] }),
}));
