/**
 * The current trace step's highlight (#365): one source of truth for which
 * nodes are "active" at a step, shared by the graph (MechanismNode) and the
 * current trial card in the Run panel, so stepping moves both together.
 *
 * The trace is `executionTrace` in the model store: one entry per scheduler
 * step, each the list of node names that ran at that step.
 */

/** Where a node stands at the current step, within the current trial. */
export type StepStatus = "active" | "done" | "pending";

/** True when any of `names` ran at `step`. */
export function ranAtStep(
  trace: readonly (readonly string[])[],
  step: number | null,
  names: readonly (string | null | undefined)[],
): boolean {
  if (step === null) return false;
  const at = trace[step];
  if (!at) return false;
  return names.some((n) => typeof n === "string" && n !== "" && at.includes(n));
}

/**
 * A row's status in the current trial card: "active" if the node ran at the
 * current step, "done" if it ran earlier in this trial (from `trialStart` up
 * to the step before), otherwise "pending" (not reached yet in this trial).
 * `names` are every name the node goes by (log name, label, variable name);
 * a PsyNeuLink "-N" suffix is also tried without it.
 */
export function classifyStepRow(
  trace: readonly (readonly string[])[],
  step: number,
  trialStart: number,
  names: readonly (string | null | undefined)[],
): StepStatus {
  const all = expandNames(names);
  if (ranAtStep(trace, step, all)) return "active";
  for (let i = Math.max(0, trialStart); i < step && i < trace.length; i++) {
    if (ranAtStep(trace, i, all)) return "done";
  }
  return "pending";
}

function expandNames(names: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== "string" || n === "") continue;
    out.push(n);
    const bare = n.replace(/-\d+$/, "");
    if (bare !== n) out.push(bare);
  }
  return out;
}

/** A composition as /api/model/load describes it: its nodes, some of them compositions. */
export interface CompositionTree {
  nodes?: { name?: string; nodes?: unknown[] }[];
}

/** Every node name inside a composition, at any depth, with and without its
    "-N" suffix: what a collapsed composition matches against the trace (#365). */
export function compositionMemberNames(comp: CompositionTree): string[] {
  const out = new Set<string>();
  const walk = (c: CompositionTree) => {
    for (const n of c.nodes ?? []) {
      if (n.name) {
        out.add(n.name);
        out.add(n.name.replace(/-\d+$/, ""));
      }
      if (n.nodes) walk(n as CompositionTree);
    }
  };
  walk(comp);
  return [...out];
}
