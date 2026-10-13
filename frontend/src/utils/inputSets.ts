// Turning a model's declared input sets (#1216) into the Run and Learn tabs'
// grids. Kept out of the panels so the matching rules can be unit-tested.

import type { InputSet } from "@/types/model";

/** A grid row owner: the node's display name and the key its cells live under. */
export interface GridNode {
  name: string;
  varName: string;
}

/**
 * The sets of one kind that apply to the composition being used. A set names
 * the composition whose nodes it uses; when the model has a single
 * composition, that's the one, whatever the panel calls it.
 */
export function setsFor(
  sets: InputSet[],
  kind: InputSet["kind"],
  composition: string | null,
  compositionCount: number,
): InputSet[] {
  return sets.filter(
    (s) => s.kind === kind && (compositionCount <= 1 || s.composition === composition),
  );
}

/** The set's entry for a node: its exact name, or the name plus a session suffix. */
function entryFor(values: Record<string, number[][]>, name: string): number[][] | undefined {
  if (values[name]) return values[name];
  const key = Object.keys(values).find((k) => name.startsWith(`${k}-`));
  return key ? values[key] : undefined;
}

/**
 * A set's values as grid cells for these nodes, or null if the set doesn't
 * cover every node (a partial set would leave cells the panel can't fill).
 */
export function cellsFromSet(
  values: Record<string, number[][]>,
  nodes: GridNode[],
): { cells: Record<string, string[][]>; trials: number } | null {
  if (nodes.length === 0) return null;
  const cells: Record<string, string[][]> = {};
  let trials = -1;
  for (const node of nodes) {
    const rows = entryFor(values, node.name);
    if (!rows) return null;
    if (trials === -1) trials = rows.length;
    if (rows.length !== trials) return null;
    cells[node.varName] = rows.map((row) => row.map((v) => String(v)));
  }
  return { cells, trials };
}

/**
 * The most trials a set may have and still be opened with automatically.
 *
 * A model's own module-level dict can be a whole experiment: the
 * Nieuwenhuis 2005 LC model's `stim_list_dict` is 1,100 trials. Preloading
 * that turned pressing Run from a quick look into running the full
 * experiment, seconds of backend work and far more of rendering. Such a set
 * is still offered in the "From" picker; it just isn't picked for you.
 */
export const MAX_PRELOAD_TRIALS = 100;

/** Trials in a set: its longest input list. */
export function setTrialCount(set: InputSet): number {
  return Math.max(0, ...Object.values(set.inputs).map((rows) => rows.length));
}

/** The first set small enough to open with, or undefined. */
export function preloadable(sets: InputSet[]): InputSet | undefined {
  return sets.find((s) => setTrialCount(s) <= MAX_PRELOAD_TRIALS);
}
