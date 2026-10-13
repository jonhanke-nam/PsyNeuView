// What the Learn tab offers for one composition, and how it labels what
// training reports (#997). Kept out of LearnPanel so the rules can be
// unit-tested.
//
// Two kinds of model learn. An AutodiffComposition trains under PyTorch and
// reports a loss. A plain Composition with learning pathways or learning
// mechanisms trains under Python, through PsyNeuLink's own LearningMechanisms;
// it reports the TD prediction error or the error at its target — or, when it
// learns without a target (Hebbian), how much its weights changed, which is
// not a loss and must not be called one.

import type { ExecutionModeInfo, LearnMetric, LearningProfile } from "@/types/model";

export const LOSS_METRIC: LearnMetric = {
  id: "loss",
  label: "Loss",
  unit: "training loss",
  description: "The loss PyTorch minimises, averaged over the epoch's trials.",
};

interface CompMeta {
  isAutodiff: boolean;
  executionModes?: ExecutionModeInfo[];
  learningProfile?: LearningProfile | null;
}

/** True when some backend can train this composition. Older backends that
 *  don't send a per-composition matrix fall back to "is it autodiff". */
export function isLearnable(meta: CompMeta | undefined): boolean {
  if (!meta) return false;
  if (meta.learningProfile) return meta.learningProfile.kind !== "none";
  if (meta.executionModes) return meta.executionModes.some((m) => m.available && m.learnable);
  return meta.isAutodiff;
}

/** Keep the current backend when it can train; otherwise the first that can. */
export function pickLearnMode(modes: ExecutionModeInfo[], current: string): string {
  const usable = modes.filter((m) => m.available && m.learnable);
  if (usable.some((m) => m.id === current)) return current;
  return usable[0]?.id ?? current;
}

const cleanName = (s: string) => s.replace(/-\d+$/, "");

export interface RoleNode {
  name: string;
  roles: string[];
}

/** Roles PsyNeuLink gives the nodes a learning pathway generates. */
const GENERATED_ROLES = ["TARGET_INPUT", "LEARNING", "LEARNING_OBJECTIVE"];

/**
 * True for a node a learning pathway generated — its TARGET, objective or
 * learning mechanisms. PsyNeuLink gives the TARGET the INPUT role, but nobody
 * types inputs into it: in the Learn tab its values go in the target grid,
 * and a run (which does not learn) takes no targets at all (#1383).
 */
export function isGeneratedLearningNode(
  node: RoleNode,
  profile: LearningProfile | null | undefined,
): boolean {
  const generated = (profile?.generatedNodes ?? []).map(cleanName);
  return generated.includes(cleanName(node.name)) || node.roles.some((r) => GENERATED_ROLES.includes(r));
}

/** The nodes a person supplies inputs for: INPUT nodes, less a learning
 *  pathway's generated ones. The Run and Learn tabs both use it. */
export function realInputNodes<T extends RoleNode>(
  nodes: T[],
  profile: LearningProfile | null | undefined,
): T[] {
  return nodes.filter((n) => n.roles.includes("INPUT") && !isGeneratedLearningNode(n, profile));
}

/**
 * Which nodes get an input grid and which a target grid.
 *
 * Inputs are INPUT nodes, less the ones a learning pathway generates: its
 * TARGET mechanism is an INPUT node to PsyNeuLink, but the reward or target
 * goes in the target grid, against the node being trained. Targets are every
 * OUTPUT node for an AutodiffComposition; for a learning pathway, the nodes
 * the profile names — none at all when the model learns without a target.
 */
export function learnGridNodes(
  nodes: RoleNode[],
  profile: LearningProfile | null | undefined,
): { inputs: string[]; targets: string[] } {
  const isGenerated = (n: RoleNode) => isGeneratedLearningNode(n, profile);
  const inputs = realInputNodes(nodes, profile).map((n) => n.name);
  let targets: string[];
  if (profile?.kind === "pathway" && profile.targetNodes) {
    const wanted = new Set(profile.targetNodes.map(cleanName));
    targets = nodes.filter((n) => wanted.has(cleanName(n.name))).map((n) => n.name);
  } else {
    targets = nodes.filter((n) => n.roles.includes("OUTPUT") && !isGenerated(n)).map((n) => n.name);
  }
  return { inputs, targets };
}

/** What the numbers are: the result's own word first, then the stream's,
 *  then what introspection predicted, else a loss (older backends). */
export function learnMetric(
  profile: LearningProfile | null | undefined,
  resultMetric?: LearnMetric | null,
  progressMetricId?: string | null,
): LearnMetric {
  if (resultMetric) return resultMetric;
  if (profile?.metric && (!progressMetricId || profile.metric.id === progressMetricId)) return profile.metric;
  return LOSS_METRIC;
}

/** Six decimals, as the Learn tab always showed — but a TD error that has
 *  fallen to 1e-9 reads as "0.000000", so tiny values go to scientific. */
export function formatMetricValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (v !== 0 && Math.abs(v) < 1e-4) return v.toExponential(2);
  return v.toFixed(6);
}
