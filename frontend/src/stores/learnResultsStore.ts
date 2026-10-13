import { create } from "zustand";

// The most recent completed training, for anything outside the Learn panel
// that needs to know what was trained and how it went (#1181, #47).
//
// The Learn panel keeps its live form and progress in its own component
// state. That's right for the form, but it leaves nothing to observe once a
// training finishes. A guided walkthrough that teaches "train it on AND, then
// on XOR" has to see which targets were trained and whether the loss came
// down. Targets and inputs are frozen at submit time, keyed by node name
// (walkthroughs name nodes the way the model does), so later edits to the
// form can't rewrite what was actually trained. Inputs matter for a model that
// learns without targets (Hebbian, #48): they're all there is to check.

export interface LearnRecord {
  epochs: number;
  finalLoss: number | null;
  /** Per-trial target vectors that were submitted, by output node name. */
  targets: Record<string, number[][]>;
  /** Per-trial input vectors that were submitted, by input node name. */
  inputs?: Record<string, number[][]>;
}

interface LearnResultsState {
  last: LearnRecord | null;
  /** Completed trainings this session; distinguishes "train it again". */
  count: number;
  record: (r: LearnRecord) => void;
}

export const useLearnResults = create<LearnResultsState>((set) => ({
  last: null,
  count: 0,
  record: (r) => set((s) => ({ last: r, count: s.count + 1 })),
}));
