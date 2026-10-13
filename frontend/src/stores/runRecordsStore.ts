import { create } from "zustand";

// A completed run captured as a stable, shareable record (#468). Inputs are
// frozen at submit time (raw + element labels) so the pairing with outputs
// survives later edits to the live form. `trace`/`snapshots` are kept for the
// exported artifact; the in-panel list only needs the lighter fields.
export interface RunRecordInput {
  name: string;
  varName: string;
  labels: string[];
  trials: number[][];
}

export interface RunRecord {
  id: string;
  timestamp: string; // ISO 8601
  modelPath: string;
  compositionName: string;
  numTrials: number;
  inputs: RunRecordInput[];
  results: unknown; // RunResults shape, opaque to the store
  // #894: how long this run took, so the history preserves each rerun's time
  // (the in-panel "· ran in X.Xs" only ever shows the latest run). `runMs` is
  // the client round-trip (Run click → results); `serverRunMs` is the backend's
  // server-side execution time. Optional — older records / imports omit them.
  runMs?: number;
  serverRunMs?: number;
  pnlVersion?: string;
  executionTrace?: unknown[];
  debuggerSnapshots?: unknown[];
}

// Keep recent runs bounded so a long tuning session doesn't grow without
// limit; oldest drop off the end (#468 storage hygiene).
const MAX_RECORDS = 10;

interface RunRecordsState {
  records: RunRecord[];
  addRecord: (record: RunRecord) => void;
  removeRecord: (id: string) => void;
  clear: () => void;
}

export const useRunRecords = create<RunRecordsState>((set) => ({
  records: [],
  addRecord: (record) =>
    set((s) => ({ records: [record, ...s.records].slice(0, MAX_RECORDS) })),
  removeRecord: (id) =>
    set((s) => ({ records: s.records.filter((r) => r.id !== id) })),
  clear: () => set({ records: [] }),
}));
