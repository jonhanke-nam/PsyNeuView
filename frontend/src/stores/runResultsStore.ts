import { create } from "zustand";

// The latest completed run's results, hoisted out of RunPanel's local state so
// other surfaces (e.g. the Inspector's per-node Trajectory card #465) can read
// them without prop-drilling. Cleared on model swap by RunPanel's filePath
// effect so a stale trajectory doesn't render for the next model (#433).
export interface RunResults {
  results: { trial: number; output: number[][] }[];
  // One friendly label per output vector (output_CIM port), same across trials
  // (#632). Absent on older backends — callers fall back to `output[i]`.
  outputLabels?: string[];
  logs: Record<string, { trials: number[]; values: number[][][] }>;
  numTrials: number;
}

interface RunResultsState {
  results: RunResults | null;
  /**
   * How many runs have completed this session.
   *
   * Trial counts cannot express "run it again": a second run of the same model
   * produces the same number of trials. A guided walkthrough that teaches
   * "change a parameter and re-run" needs to tell the two runs apart (#1181).
   */
  runCount: number;
  setResults: (r: RunResults | null) => void;
  clearResults: () => void;
}

export const useRunResults = create<RunResultsState>((set) => ({
  results: null,
  runCount: 0,
  setResults: (r) => set((s) => ({ results: r, runCount: r ? s.runCount + 1 : s.runCount })),
  clearResults: () => set({ results: null }),
}));
