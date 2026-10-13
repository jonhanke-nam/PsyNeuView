import { describe, expect, it } from "vitest";
import type { ExecutionModeInfo, LearningProfile } from "@/types/model";
import {
  LOSS_METRIC,
  formatMetricValue,
  isLearnable,
  isGeneratedLearningNode,
  learnGridNodes,
  learnMetric,
  pickLearnMode,
  realInputNodes,
} from "./learnPlan";

const mode = (id: string, learnable: boolean, available = true): ExecutionModeInfo => ({
  id,
  label: id,
  available,
  learnable,
  reason: null,
});

const WEIGHT_CHANGE = {
  id: "weight_change" as const,
  label: "Weight change",
  unit: "‖ΔW‖ / ‖W‖ (Frobenius), per epoch",
  description: "no loss",
};
const PREDICTION_ERROR = {
  id: "prediction_error" as const,
  label: "Prediction error",
  unit: "mean squared TD error per trial",
  description: "TD",
};

const hebbian: LearningProfile = {
  kind: "pathway",
  metric: WEIGHT_CHANGE,
  targetNodes: [],
  generatedNodes: ["AutoAssociativeLearningMechanism for feature_layer"],
  reason: null,
};
const td: LearningProfile = {
  kind: "pathway",
  metric: PREDICTION_ERROR,
  targetNodes: ["value_estimate"],
  generatedNodes: ["TARGET for value_estimate", "PredictionError", "Learning Mechanism for cue_to_value"],
  reason: null,
};
const none: LearningProfile = {
  kind: "none",
  metric: null,
  targetNodes: [],
  generatedNodes: [],
  reason: "nothing to train",
};

describe("isLearnable — per composition (#997)", () => {
  it("follows the learning profile when there is one", () => {
    expect(isLearnable({ isAutodiff: false, learningProfile: hebbian })).toBe(true);
    expect(isLearnable({ isAutodiff: false, learningProfile: none })).toBe(false);
  });
  it("falls back to the mode matrix, then to autodiff, for older backends", () => {
    expect(isLearnable({ isAutodiff: false, executionModes: [mode("Python", true)] })).toBe(true);
    expect(isLearnable({ isAutodiff: false, executionModes: [mode("Python", false)] })).toBe(false);
    expect(isLearnable({ isAutodiff: true })).toBe(true);
    expect(isLearnable(undefined)).toBe(false);
  });
});

describe("pickLearnMode", () => {
  it("moves a PyTorch default to Python for a learning-pathway Composition", () => {
    const modes = [mode("PyTorch", false), mode("Python", true), mode("LLVM", false)];
    expect(pickLearnMode(modes, "PyTorch")).toBe("Python");
  });
  it("keeps a selection that can train", () => {
    expect(pickLearnMode([mode("PyTorch", true), mode("Python", false)], "PyTorch")).toBe("PyTorch");
  });
  it("skips a learnable mode that isn't installed", () => {
    expect(pickLearnMode([mode("PyTorch", true, false), mode("Python", true)], "PyTorch")).toBe("Python");
  });
});

describe("learnGridNodes", () => {
  it("gives a Hebbian model inputs and no targets", () => {
    const nodes = [
      { name: "feature_layer", roles: ["INPUT", "OUTPUT", "CYCLE"] },
      { name: "AutoAssociativeLearningMechanism for feature_layer", roles: ["LEARNING", "INTERNAL"] },
    ];
    expect(learnGridNodes(nodes, hebbian)).toEqual({ inputs: ["feature_layer"], targets: [] });
  });

  it("keeps a TD pathway's TARGET mechanism out of the inputs and targets the trained node", () => {
    const nodes = [
      { name: "cue", roles: ["INPUT", "ORIGIN"] },
      { name: "value_estimate", roles: ["OUTPUT", "SAMPLE"] },
      { name: "TARGET for value_estimate", roles: ["INPUT", "LEARNING", "TARGET_INPUT"] },
      { name: "PredictionError", roles: ["LEARNING_OBJECTIVE"] },
    ];
    expect(learnGridNodes(nodes, td)).toEqual({ inputs: ["cue"], targets: ["value_estimate"] });
  });

  it("tolerates PsyNeuLink's -N session suffix on names", () => {
    const nodes = [
      { name: "cue-1", roles: ["INPUT"] },
      { name: "value_estimate-1", roles: ["OUTPUT"] },
    ];
    expect(learnGridNodes(nodes, td).targets).toEqual(["value_estimate-1"]);
  });

  it("targets every OUTPUT node of an autodiff model, as before", () => {
    const nodes = [
      { name: "input_layer", roles: ["INPUT"] },
      { name: "hidden_layer", roles: ["INTERNAL"] },
      { name: "output_layer", roles: ["OUTPUT"] },
    ];
    const auto: LearningProfile = { kind: "autodiff", metric: LOSS_METRIC, targetNodes: null, generatedNodes: [], reason: null };
    expect(learnGridNodes(nodes, auto)).toEqual({ inputs: ["input_layer"], targets: ["output_layer"] });
    expect(learnGridNodes(nodes, undefined)).toEqual({ inputs: ["input_layer"], targets: ["output_layer"] });
  });
});

describe("realInputNodes — what the Run tab offers as inputs (#1383)", () => {
  const tdNodes = [
    { name: "cue", roles: ["INPUT", "ORIGIN"] },
    { name: "value_estimate", roles: ["OUTPUT", "SAMPLE"] },
    { name: "TARGET for value_estimate", roles: ["INPUT", "LEARNING", "ORIGIN", "TARGET_INPUT"] },
    { name: "PredictionError", roles: ["INTERNAL", "LEARNING", "LEARNING_OBJECTIVE"] },
  ];

  it("leaves a TD pathway's TARGET out", () => {
    expect(realInputNodes(tdNodes, td).map((n) => n.name)).toEqual(["cue"]);
  });

  it("leaves it out by its roles alone, before the profile arrives", () => {
    expect(realInputNodes(tdNodes, null).map((n) => n.name)).toEqual(["cue"]);
  });

  it("leaves it out by the profile's name alone, with the session suffix", () => {
    const bare = [
      { name: "cue", roles: ["INPUT"] },
      { name: "TARGET for value_estimate-1", roles: ["INPUT"] },
    ];
    expect(realInputNodes(bare, td).map((n) => n.name)).toEqual(["cue"]);
    expect(isGeneratedLearningNode(bare[1], td)).toBe(true);
    expect(isGeneratedLearningNode(bare[0], td)).toBe(false);
  });

  it("keeps every INPUT node of a model that doesn't learn, and its extra fields", () => {
    const nodes = [
      { name: "a", roles: ["INPUT"], id: 1 },
      { name: "b", roles: ["INPUT", "OUTPUT"], id: 2 },
      { name: "c", roles: ["OUTPUT"], id: 3 },
    ];
    expect(realInputNodes(nodes, none)).toEqual([nodes[0], nodes[1]]);
  });
});

describe("learnMetric — label the numbers as what they are", () => {
  it("prefers the result's metric", () => {
    expect(learnMetric(hebbian, PREDICTION_ERROR, "weight_change")).toBe(PREDICTION_ERROR);
  });
  it("uses the profile's metric while training streams", () => {
    expect(learnMetric(hebbian, null, "weight_change").label).toBe("Weight change");
  });
  it("calls it a loss for autodiff and for older backends", () => {
    expect(learnMetric(undefined)).toBe(LOSS_METRIC);
    expect(learnMetric(null, undefined, "loss")).toBe(LOSS_METRIC);
  });
});

describe("formatMetricValue", () => {
  it("keeps six decimals for ordinary values", () => {
    expect(formatMetricValue(0.0557269)).toBe("0.055727");
  });
  it("switches to scientific for a value that has fallen near zero", () => {
    expect(formatMetricValue(1.09e-9)).toBe("1.09e-9");
    expect(formatMetricValue(0)).toBe("0.000000");
  });
  it("says n/a for nothing", () => {
    expect(formatMetricValue(null)).toBe("n/a");
    expect(formatMetricValue(Number.NaN)).toBe("n/a");
  });
});
