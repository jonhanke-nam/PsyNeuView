/**
 * Last-load timing store (#874).
 *
 * Holds the timing breakdown of the most recent model load so the UI can show
 * how long it took — a live counter during the load (via statusStore) and a
 * persistent "loaded in X.Xs" + breakdown afterward (Model Diagnostics bar +
 * Inspector). Populated by `logLoadPerf` (utils/loadPerf.ts) after the graph
 * paints, so it reflects the real click → on-screen time. No new measurement —
 * it consumes the same marks + backend `timings` block from #867.
 */

import { create } from "zustand";

import type { BackendTimings } from "@/utils/loadPerf";

export interface LoadTiming {
  /** Model label (file name or catalog label). */
  label: string;
  /** Total ms, fetch start → graph painted. */
  total: number;
  /** Network round-trip ms. */
  api: number;
  /** Response-parse ms. */
  parse: number;
  /** Graph build + layout ms (loadModelFromServer). */
  build: number;
  /** Browser paint ms after the state update. */
  paint: number;
  /** Backend introspect/misc timing, if the endpoint provided it. */
  backend?: BackendTimings | null;
}

interface LoadTimingState {
  last: LoadTiming | null;
  setLast: (t: LoadTiming) => void;
  clear: () => void;
}

export const useLoadTimingStore = create<LoadTimingState>((set) => ({
  last: null,
  setLast: (t) => set({ last: t }),
  clear: () => set({ last: null }),
}));
