/**
 * Joins debugger snapshots to scheduler steps so the graph can show the
 * value a node produced at the active trace step (#312).
 *
 * The step counter mirrors Phase 2C's snapshot→step mapping in RunPanel:
 * EXECUTION_SET bumps the running step; NODE_EXECUTION inherits it. The
 * step index aligns with `executionTrace` indices because both are built
 * from the same EXECUTION_SET ordering on the backend.
 */

import type { DebuggerSnapshot } from "@/stores/modelStore";

// One node's captured state at one scheduler step. ``trial`` comes from the
// snapshot's ``trial_num`` so the tooltip on the value pill can name the
// trial without re-walking the snapshot list (#336).
export type StepNodeEntry = {
  value: unknown;
  trial: number | null;
};

// step index -> { node name -> per-node entry at that step }
export type StepNodeValues = Map<number, Record<string, StepNodeEntry>>;

export function buildStepNodeValues(
  snapshots: DebuggerSnapshot[],
): StepNodeValues {
  const map: StepNodeValues = new Map();
  let step = -1;
  for (const snap of snapshots) {
    if (snap.category === "EXECUTION_SET") {
      step += 1;
    } else if (snap.category === "NODE_EXECUTION" && step >= 0) {
      const node = snap.node;
      const v = snap.output !== undefined ? snap.output : snap.outputs;
      if (node && v !== undefined && v !== null) {
        let byNode = map.get(step);
        if (!byNode) {
          byNode = {};
          map.set(step, byNode);
        }
        const trial = typeof snap.trial_num === "number" ? snap.trial_num : null;
        byNode[node] = { value: v, trial };
      }
    }
  }
  return map;
}

// Round floats inside (possibly nested) arrays so the on-node value reads
// cleanly; leave non-numeric payloads untouched.
function roundDeep(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 10000) / 10000;
  if (Array.isArray(v)) return v.map(roundDeep);
  return v;
}

// Compact one-line rendering of a captured value for display on a node.
export function formatTraceValue(v: unknown, maxLen = 40): string {
  const full = JSON.stringify(roundDeep(v));
  if (full === undefined) return "";
  return full.length > maxLen ? full.slice(0, maxLen - 1) + "…" : full;
}
