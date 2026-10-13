/**
 * TypeScript types matching the backend Pydantic schema.
 */

export interface PortInfo {
  name: string;
  shape: number[];
}

export interface FunctionInfo {
  type: string;
  params: Record<string, unknown>;
  validTypes?: string[];
}

export interface MechanismInfo {
  name: string;
  kind: "mechanism";
  type: string;
  inputPorts: PortInfo[];
  outputPorts: PortInfo[];
  parameterPorts?: PortInfo[];
  params: Record<string, unknown>;
  function: FunctionInfo | null;
}

export interface GSCInfo {
  id: string;
  type: string;       // "BeforeNode", "AddEdgeTo", etc.
  owner: string;      // varName of owner node
  nodes: string[];    // varNames of target nodes
  params: Record<string, unknown>;
}

export interface ProjectionInfo {
  name: string;
  type: string;
  sender: { mechanism: string; port: string };
  receiver: { mechanism: string; port: string };
}

export interface ConditionInfo {
  type: string;
  args?: Record<string, unknown>;
  children?: ConditionInfo[];
  n?: number;
  explanation?: string;
}

export interface BasicConditionEntry {
  owner: string;
  condition: ConditionInfo;
}

export interface SchedulerConfig {
  mode?: string;
  considerationQueue?: string[][];
}

export interface CompositionInfo {
  varName: string;
  name: string;
  kind: "composition";
  nodes: (MechanismInfo | CompositionInfo)[];
  projections: ProjectionInfo[];
  scheduling?: GSCInfo[];
  basicConditions?: BasicConditionEntry[];
  terminationConditions?: Record<string, ConditionInfo>;
  schedulerConfig?: SchedulerConfig;
}

export interface DanglingProjectionInfo {
  varName: string;
  type: string;            // "MappingProjection", "ControlProjection", etc.
  line: number;            // 1-based source line of the declaration
  senderRef: string | null;
  receiverRef: string | null;
  missing: string[];       // referenced names that are not defined
  missingSide: "sender" | "receiver" | "both";
}

/**
 * A projection PsyNeuLink refused to make, usually because its endpoints'
 * shapes don't match (#1235). Unlike a dangling one, both endpoints exist.
 */
export interface BrokenProjectionInfo {
  varName: string;
  type: string;
  line: number;
  senderRef: string | null;
  receiverRef: string | null;
  /** PsyNeuLink's reason, e.g. "Width (2) of the value of ... (3)." */
  error: string;
}

export interface ModelGraph {
  compositions: CompositionInfo[];
  danglingProjections?: DanglingProjectionInfo[];
  brokenProjections?: BrokenProjectionInfo[];
  inputSets?: InputSet[];
}

/**
 * Run inputs or a training set the model declares itself (#1216): a
 * module-level dict in the shape `Composition.run` or
 * `AutodiffComposition.learn` takes, named by its variable. Values are one
 * flat vector per trial, keyed by node name.
 */
export interface InputSet {
  name: string;
  kind: "run" | "learn";
  /** Variable name of the composition whose nodes it uses. */
  composition: string;
  inputs: Record<string, number[][]>;
  targets?: Record<string, number[][]>;
  epochs?: number;
}

/** A PsyNeuLink execution backend as reported by `/api/execution-modes`.
 *  `available` gates whether it can run at all; `learnable` additionally gates
 *  autodiff training, so the Run selector checks only the former (#764). */
export interface ExecutionModeInfo {
  id: string;              // "Python" | "PyTorch" | "LLVM" — capability id, not the enum member
  label: string;
  available: boolean;
  learnable: boolean;
  reason: string | null;   // why unavailable / not learnable — UI tooltip
}

/** One backend judged against a *specific* composition (#763).
 *  `available` is install-level, `supported` is structural; `runnable` and
 *  `learnable` are the conjunctions a selector gates on, so the UI never
 *  re-derives the capability matrix. */
export interface CompositionExecutionModeInfo extends ExecutionModeInfo {
  supported: boolean;
  runnable: boolean;
}

/** What a training epoch reports (#997). `loss` for an AutodiffComposition;
 *  for a Composition with learning pathways, the TD prediction error or the
 *  error at the target; for one that learns without a target (Hebbian), the
 *  relative weight change — which is not a loss, and is labelled so. */
export interface LearnMetric {
  id: "loss" | "prediction_error" | "target_error" | "weight_change";
  label: string;
  unit: string;
  description: string;
}

/** How a composition learns, from introspection (#997). `targetNodes` names
 *  the nodes that take targets on a learning pathway (empty for Hebbian; null
 *  for autodiff, where every OUTPUT node does). `generatedNodes` are the
 *  learning nodes a learning pathway creates — not inputs a person types. */
export interface LearningProfile {
  kind: "autodiff" | "pathway" | "none";
  metric: LearnMetric | null;
  targetNodes: string[] | null;
  generatedNodes: string[];
  reason: string | null;
}
