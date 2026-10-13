/**
 * Last-run timing store (#894) — the run-side counterpart to loadTimingStore.
 *
 * Holds the timing of the most recent model run so the Run panel can show
 * "ran in X.Xs". Populated by the run handler with the client round-trip total
 * and the backend `timings` block (server-side execution time) from #894.
 */

import { create } from "zustand";

export interface RunTiming {
  /** Total ms, Run-click → results on screen. */
  total: number;
  /** Backend-reported run time (server-side execution). */
  backend?: { run_ms?: number } | null;
}

interface RunTimingState {
  last: RunTiming | null;
  setLast: (t: RunTiming) => void;
  clear: () => void;
}

export const useRunTimingStore = create<RunTimingState>((set) => ({
  last: null,
  setLast: (t) => set({ last: t }),
  clear: () => set({ last: null }),
}));
