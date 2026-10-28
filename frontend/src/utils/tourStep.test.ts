import { describe, expect, it } from "vitest";

import {
  WALKTHROUGHS,
  getWalkthrough,
  isDone,
  matchesNodeName,
  menuGroups,
  orientationWalkthroughs,
  parseWalkthrough,
  watchesDom,
} from "./tourStep";

const state = (
  selectedNodeId: string | null,
  nodeIds: string[] = [],
  trialCount = 0,
  over: {
    runCount?: number;
    nodeParams?: Record<string, Record<string, string>>;
    lastRunInputs?: Record<string, number[][]> | null;
    nodeFunctions?: Record<string, string>;
    lastTraining?: {
      epochs: number;
      finalLoss: number | null;
      targets: Record<string, number[][]>;
      inputs?: Record<string, number[][]>;
    } | null;
  } = {},
) => ({
  selectedNodeId,
  nodeIds,
  trialCount,
  runCount: over.runCount ?? 0,
  nodeParams: over.nodeParams ?? {},
  lastRunInputs: over.lastRunInputs ?? null,
  nodeFunctions: over.nodeFunctions ?? {},
  lastTraining: over.lastTraining ?? null,
});

describe("matchesNodeName", () => {
  it("matches the plain name and a session-counter suffix", () => {
    expect(matchesNodeName("color_hidden", "color_hidden")).toBe(true);
    expect(matchesNodeName("color_hidden-7", "color_hidden")).toBe(true);
  });

  /** The bug this exists to prevent: a bare prefix catches siblings. */
  it("does not match a different node that merely starts the same", () => {
    expect(matchesNodeName("color_hidden_extra", "color_hidden")).toBe(false);
    expect(matchesNodeName("LC_objective", "LC")).toBe(false);
  });

  it("treats no selection as no match", () => {
    expect(matchesNodeName(null, "color_hidden")).toBe(false);
  });
});

describe("isDone", () => {
  it("completes when the named node is selected", () => {
    expect(isDone({ selectedNode: "color_hidden" }, state("color_hidden"))).toBe(true);
    expect(isDone({ selectedNode: "color_hidden" }, state("color_hidden-3"))).toBe(true);
  });

  it("does not complete on a different or absent selection", () => {
    expect(isDone({ selectedNode: "color_hidden" }, state("word_hidden"))).toBe(false);
    expect(isDone({ selectedNode: "color_hidden" }, state(null))).toBe(false);
  });

  /**
   * A typo'd verb must stick, not sail through. Silent auto-advance would let
   * a walkthrough "pass" while teaching nothing.
   */
  it("is never satisfied by an empty or unknown condition", () => {
    expect(isDone({}, state("color_hidden"))).toBe(false);
    expect(isDone({ selctedNode: "color_hidden" } as never, state("color_hidden"))).toBe(false);
  });
});

describe("isDone — nodeExists", () => {
  it("completes once a node of that name is in the model", () => {
    expect(isDone({ nodeExists: "New_TransferMechanism_1" }, state(null, ["input_node"]))).toBe(false);
    expect(
      isDone({ nodeExists: "New_TransferMechanism_1" }, state(null, ["input_node", "New_TransferMechanism_1"])),
    ).toBe(true);
  });

  it("accepts a session-counter suffix on the added node", () => {
    expect(isDone({ nodeExists: "New_TransferMechanism_1" }, state(null, ["New_TransferMechanism_1-4"]))).toBe(true);
  });

  it("is not fooled by a node that merely starts the same", () => {
    expect(isDone({ nodeExists: "LC" }, state(null, ["LC_objective"]))).toBe(false);
  });
});

describe("isDone — trialsAtLeast", () => {
  it("waits for the model to actually produce trials", () => {
    expect(isDone({ trialsAtLeast: 1 }, state(null, [], 0))).toBe(false);
    expect(isDone({ trialsAtLeast: 1 }, state(null, [], 1))).toBe(true);
  });

  /**
   * A count rather than a flag, so a later step can say "run it again" and
   * mean something a boolean could not express.
   */
  it("distinguishes one run from several", () => {
    expect(isDone({ trialsAtLeast: 5 }, state(null, [], 3))).toBe(false);
    expect(isDone({ trialsAtLeast: 5 }, state(null, [], 5))).toBe(true);
  });
});

describe("isDone — the analyze conditions", () => {
  /**
   * The reason `runsAtLeast` exists at all: a second run produces the same
   * trial count as the first, so `trialsAtLeast` cannot tell them apart, and a
   * "now run it again" step would complete the moment it appeared.
   */
  it("runsAtLeast distinguishes a re-run from the first run", () => {
    const afterOneRun = state(null, [], 5, { runCount: 1 });
    expect(isDone({ trialsAtLeast: 1 }, afterOneRun)).toBe(true);
    expect(isDone({ runsAtLeast: 2 }, afterOneRun)).toBe(false);
    expect(isDone({ runsAtLeast: 2 }, state(null, [], 5, { runCount: 2 }))).toBe(true);
  });

  it("paramEquals reads the parameter the Inspector shows", () => {
    const params = { nodeParams: { color_hidden: { gain: "2.5" } } };
    expect(
      isDone({ paramEquals: { node: "color_hidden", param: "gain", value: "2.5" } }, state(null, [], 0, params)),
    ).toBe(true);
    expect(
      isDone({ paramEquals: { node: "color_hidden", param: "gain", value: "1.1" } }, state(null, [], 0, params)),
    ).toBe(false);
  });

  /** A weight matrix, typed with or without spaces, is the same matrix (#45). */
  it("paramEquals compares matrices number by number", () => {
    const params = { nodeParams: { matrix_A: { matrix: "[[10,4],[2,5],[3,6]]" } } };
    const want = (value: string) =>
      isDone({ paramEquals: { node: "matrix_A", param: "matrix", value } }, state(null, [], 0, params));
    expect(want("[[10, 4], [2, 5], [3, 6]]")).toBe(true);
    expect(want("[[10.0, 4], [2, 5], [3, 6]]")).toBe(true);
    expect(want("[[1, 4], [2, 5], [3, 6]]")).toBe(false);
    expect(want("[[10, 4, 2], [5, 3, 6]]")).toBe(false);
    expect(want("[10, 4, 2, 5, 3, 6]")).toBe(false);
  });

  /** The learner typed the right number; the formatting is not the lesson. */
  it("paramEquals compares numbers numerically", () => {
    const params = { nodeParams: { color_hidden: { gain: "2.50" } } };
    expect(
      isDone({ paramEquals: { node: "color_hidden", param: "gain", value: "2.5" } }, state(null, [], 0, params)),
    ).toBe(true);
  });

  it("paramEquals accepts a session-counter suffix on the node", () => {
    const params = { nodeParams: { "color_hidden-7": { gain: "2.5" } } };
    expect(
      isDone({ paramEquals: { node: "color_hidden", param: "gain", value: "2.5" } }, state(null, [], 0, params)),
    ).toBe(true);
  });

  it("paramEquals is unsatisfied when the node or parameter is absent", () => {
    expect(
      isDone({ paramEquals: { node: "nope", param: "gain", value: "2.5" } }, state(null, [], 0, { nodeParams: {} })),
    ).toBe(false);
    expect(
      isDone(
        { paramEquals: { node: "color_hidden", param: "bias", value: "2.5" } },
        state(null, [], 0, { nodeParams: { color_hidden: { gain: "2.5" } } }),
      ),
    ).toBe(false);
  });
});

describe("isDone — lastRunInputs (#50)", () => {
  // The Dynamic Systems kick: 2 and 6 on the first trial, then nothing.
  const kick = { node_attract1: [2, 0, 0], node_attract2: [6, 0, 0] };
  const ran = (inputs: Record<string, number[][]>) => state(null, [], 3, { lastRunInputs: inputs });

  it("is not done before the model has run — typing the inputs is not enough", () => {
    expect(isDone({ lastRunInputs: kick }, state(null))).toBe(false);
  });

  it("is done when the last run used exactly those inputs", () => {
    expect(
      isDone({ lastRunInputs: kick }, ran({ node_attract1: [[2], [0], [0]], node_attract2: [[6], [0], [0]] })),
    ).toBe(true);
  });

  it("is not done when the run used the Run panel's defaults instead", () => {
    expect(
      isDone({ lastRunInputs: kick }, ran({ node_attract1: [[1], [1], [1]], node_attract2: [[1], [1], [1]] })),
    ).toBe(false);
  });

  it("is not done when the trial count differs", () => {
    expect(
      isDone({ lastRunInputs: kick }, ran({ node_attract1: [[2], [0]], node_attract2: [[6], [0]] })),
    ).toBe(false);
  });

  it("needs every named node to match, not just one", () => {
    expect(
      isDone({ lastRunInputs: kick }, ran({ node_attract1: [[2], [0], [0]], node_attract2: [[1], [0], [0]] })),
    ).toBe(false);
  });

  it("accepts vectors for multi-unit nodes", () => {
    expect(
      isDone({ lastRunInputs: { color_input: [[1, 0], [0, 1]] } }, ran({ color_input: [[1, 0], [0, 1]] })),
    ).toBe(true);
  });

  it("matches suffixed node names from a long session", () => {
    expect(
      isDone({ lastRunInputs: { node_attract1: [2] } }, ran({ "node_attract1-3": [[2]] })),
    ).toBe(true);
  });

  it("is never satisfied by an empty spec — a typo must not auto-advance", () => {
    expect(isDone({ lastRunInputs: {} }, ran({ node_attract1: [[2]] }))).toBe(false);
  });
});

describe("isDone — functionIs (#46)", () => {
  it("is done once the node's function is that class", () => {
    expect(
      isDone(
        { functionIs: { node: "output_node", type: "Logistic" } },
        state(null, [], 0, { nodeFunctions: { output_node: "Logistic" } }),
      ),
    ).toBe(true);
  });

  it("is not done while the node still has its starter function", () => {
    expect(
      isDone(
        { functionIs: { node: "output_node", type: "Logistic" } },
        state(null, [], 0, { nodeFunctions: { output_node: "Linear" } }),
      ),
    ).toBe(false);
  });

  it("is not done for a node that doesn't exist", () => {
    expect(
      isDone({ functionIs: { node: "nope", type: "Logistic" } }, state(null, [], 0, { nodeFunctions: {} })),
    ).toBe(false);
  });

  it("matches suffixed node names", () => {
    expect(
      isDone(
        { functionIs: { node: "output_node", type: "Logistic" } },
        state(null, [], 0, { nodeFunctions: { "output_node-2": "Logistic" } }),
      ),
    ).toBe(true);
  });
});

describe("isDone — lastTraining (#47)", () => {
  const AND = { out_layer: [0, 0, 0, 1] };
  const trained = (targets: number[][], epochs = 50) =>
    state(null, [], 0, { lastTraining: { epochs, finalLoss: 0.001, targets: { out_layer: targets } } });

  it("is not done before anything has trained", () => {
    expect(isDone({ lastTraining: { targets: AND } }, state(null))).toBe(false);
  });

  it("is done when the last training used those targets", () => {
    expect(isDone({ lastTraining: { targets: AND, epochsAtLeast: 50 } }, trained([[0], [0], [0], [1]]))).toBe(true);
  });

  it("is not done when it trained on different targets (XOR instead of AND)", () => {
    expect(isDone({ lastTraining: { targets: AND } }, trained([[0], [1], [1], [0]]))).toBe(false);
  });

  it("is not done when it trained for too few epochs", () => {
    expect(isDone({ lastTraining: { targets: AND, epochsAtLeast: 50 } }, trained([[0], [0], [0], [1]], 5))).toBe(false);
  });

  it("is never satisfied by empty targets", () => {
    expect(isDone({ lastTraining: { targets: {} } }, trained([[0], [0], [0], [1]]))).toBe(false);
  });
  it("is never satisfied when it names neither targets nor inputs", () => {
    expect(isDone({ lastTraining: { epochsAtLeast: 1 } }, trained([[0], [0], [0], [1]]))).toBe(false);
  });
});

describe("isDone — lastTraining on inputs, for a model with no targets (#48)", () => {
  // Hebbian learning has no targets, so the inputs are what tell trainings apart:
  // the three objects alone, or the three objects and then a triangle by itself.
  const OBJECTS = [
    [1, 0, 0, 1, 0, 0, 1, 0, 0],
    [0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1],
  ];
  const TRIANGLE = [0, 0, 0, 0, 0, 0, 0, 0, 1];
  const hebbian = (rows: number[][], epochs = 20) =>
    state(null, [], 0, {
      lastTraining: { epochs, finalLoss: 0.05, targets: {}, inputs: { feature_layer: rows } },
    });

  it("is done when the last training used those inputs", () => {
    const want = { inputs: { feature_layer: [...OBJECTS, TRIANGLE] }, epochsAtLeast: 20 };
    expect(isDone({ lastTraining: want }, hebbian([...OBJECTS, TRIANGLE]))).toBe(true);
  });

  it("is not done when it trained on other inputs (the objects without the cue)", () => {
    expect(isDone({ lastTraining: { inputs: { feature_layer: [...OBJECTS, TRIANGLE] } } }, hebbian(OBJECTS))).toBe(false);
  });

  it("is not done for a training recorded before inputs were kept", () => {
    const old = state(null, [], 0, { lastTraining: { epochs: 20, finalLoss: 0.05, targets: {} } });
    expect(isDone({ lastTraining: { inputs: { feature_layer: OBJECTS } } }, old)).toBe(false);
  });

  it("checks both when a step names both", () => {
    const both = state(null, [], 0, {
      lastTraining: { epochs: 50, finalLoss: 0.1, targets: { value: [[1]] }, inputs: { cue: [[0, 1]] } },
    });
    expect(isDone({ lastTraining: { targets: { value: [[1]] }, inputs: { cue: [[0, 1]] } } }, both)).toBe(true);
    expect(isDone({ lastTraining: { targets: { value: [[1]] }, inputs: { cue: [[1, 1]] } } }, both)).toBe(false);
  });
});

describe("menuGroups", () => {
  const w = (id: string, course?: string) => ({ id, title: id, course, steps: [] as never[] });
  const o = (id: string, orientation: number) => ({ id, title: id, orientation, steps: [] as never[] });
  const p = (id: string, psyneulink: number) => ({ id, title: id, psyneulink, steps: [] as never[] });

  /** #1310: the orientation leads the menu, in its own numbered order. */
  it("puts PsyNeuView First Steps first, in part order", () => {
    const groups = menuGroups([w("demo"), o("o-two", 2), w("ddm", "2.1"), o("o-one", 1)]);
    expect(groups.map((g) => g.id)).toEqual(["orientation", "general", "course"]);
    expect(groups[0].title).toBe("PsyNeuView First Steps");
    expect(groups[0].walkthroughs.map((x) => x.id)).toEqual(["o-one", "o-two"]);
    expect(groups[1].walkthroughs.map((x) => x.id)).toEqual(["demo"]);
  });

  it("ships the eight orientation parts in order, each with its docs and a short length", () => {
    const parts = orientationWalkthroughs();
    expect(parts.map((p) => p.orientation)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parts.map((p) => p.id)).toEqual([
      "orientation-window", "orientation-open", "orientation-editing", "orientation-saving",
      "orientation-psyneulink", "orientation-running", "orientation-settings", "orientation-developers",
    ]);
    for (const p of parts) {
      expect(p.docs?.length, `"${p.id}" cites no docs page`).toBeGreaterThan(0);
      expect(p.minutes, `"${p.id}" has no length`).toBeGreaterThanOrEqual(2);
      expect(p.minutes, `"${p.id}" is too long`).toBeLessThanOrEqual(4);
      for (const step of p.steps) expect(step.say, `"${p.id}"/"${step.id}" has no caption`).toBeTruthy();
    }
    expect(parts.find((p) => p.id === "orientation-developers")?.developerMode).toBe(true);
    expect(parts.filter((p) => p.developerMode).length, "only the developer track turns developer mode on").toBe(1);
  });

  it("puts the general walkthroughs first, then the course in lesson order", () => {
    const groups = menuGroups([w("demo"), w("dynamics", "1.3"), w("build"), w("logistic", "0.2"), w("ddm", "2.1")]);
    expect(groups.map((g) => g.title)).toEqual(["Getting started", "Cognitive Neuroscience Course"]);
    expect(groups[0].walkthroughs.map((x) => x.id)).toEqual(["demo", "build"]);
    expect(groups[1].walkthroughs.map((x) => x.id)).toEqual(["logistic", "dynamics", "ddm"]);
  });

  it("orders lessons numerically, not as strings", () => {
    const groups = menuGroups([w("b", "0.10"), w("a", "0.9")]);
    expect(groups[0].walkthroughs.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("omits an empty section", () => {
    expect(menuGroups([w("demo")]).map((g) => g.title)).toEqual(["Getting started"]);
  });

  /** #9: PsyNeuLink's own tutorials sit between the app's walkthroughs and the course, in lesson order. */
  it("puts PsyNeuLink Tutorials after Getting started and before the course, in lesson order", () => {
    const groups = menuGroups([o("o-one", 1), w("ddm", "2.1"), p("p-two", 2), w("demo"), p("p-one", 1)]);
    expect(groups.map((g) => g.id)).toEqual(["orientation", "general", "psyneulink", "course"]);
    expect(groups[2].title).toBe("PsyNeuLink Tutorials");
    expect(groups[2].walkthroughs.map((x) => x.id)).toEqual(["p-one", "p-two"]);
    expect(groups[1].walkthroughs.map((x) => x.id)).toEqual(["demo"]);
  });

  it("ships the first PsyNeuLink lesson, with a caption on every step", () => {
    const lessons = menuGroups().find((g) => g.id === "psyneulink")?.walkthroughs ?? [];
    expect(lessons.map((l) => [l.id, l.psyneulink])).toEqual([["pnl-mechanism", 1]]);
    for (const l of lessons) {
      expect(l.docs?.length, `"${l.id}" cites no docs page`).toBeGreaterThan(0);
      for (const step of l.steps) expect(step.say, `"${l.id}"/"${step.id}" has no caption`).toBeTruthy();
    }
  });

  it("rejects a psyneulink lesson number that isn't a whole number from 1, or a second section", () => {
    const doc = (extra: string) =>
      `id: x\ntitle: X\n${extra}steps:\n  - id: s\n    anchor: {testid: t}\n    instruct: i\n    done: {nodeExists: n}\n`;
    expect(() => parseWalkthrough(doc("psyneulink: 0\n"))).toThrow(/psyneulink must be/);
    expect(() => parseWalkthrough(doc("psyneulink: first\n"))).toThrow(/psyneulink must be/);
    expect(() => parseWalkthrough(doc("psyneulink: 1\ncourse: \"0.1\"\n"))).toThrow(/one section only/);
    expect(parseWalkthrough(doc("psyneulink: 2\n")).psyneulink).toBe(2);
  });

  it("orders the shipped course walkthroughs as the course does", () => {
    const course = menuGroups().find((g) => g.title === "Cognitive Neuroscience Course");
    expect(course?.walkthroughs.map((x) => x.id)).toEqual([
      "vectors", "logistic", "perceptron", "hebbian", "hopfield", "dynamics", "ddm", "td", "semantic", "memory",
      "ego", "stroop", "conflict", "iscci",
    ]);
  });
});

describe("parseWalkthrough", () => {
  it("rejects a course number that isn't module.lesson", () => {
    expect(() =>
      parseWalkthrough("id: x\ntitle: X\ncourse: module zero\nsteps:\n  - id: s\n    anchor: {testid: t}\n    instruct: i\n    done: {nodeExists: n}\n"),
    ).toThrow(/course must look like/);
  });

  const good = `
id: t
title: T
model: M
steps:
  - id: s1
    anchor:
      node: n
    instruct: do it
    done:
      selectedNode: n
`;

  it("reads a well-formed walkthrough", () => {
    const w = parseWalkthrough(good);
    expect(w.id).toBe("t");
    expect(w.steps).toHaveLength(1);
    expect(w.steps[0].done.selectedNode).toBe("n");
  });

  it("refuses a walkthrough with no steps", () => {
    expect(() => parseWalkthrough("id: t\ntitle: T\nmodel: M\nsteps: []\n")).toThrow(/needs steps/);
  });

  it("refuses a step with no done condition", () => {
    const bad = "id: t\ntitle: T\nmodel: M\nsteps:\n  - id: s1\n    anchor:\n      node: n\n    instruct: do it\n";
    expect(() => parseWalkthrough(bad)).toThrow(/needs a done condition/);
  });

  it("refuses a step missing its anchor", () => {
    const bad = "id: t\ntitle: T\nmodel: M\nsteps:\n  - id: s1\n    instruct: do it\n    done:\n      selectedNode: n\n";
    expect(() => parseWalkthrough(bad)).toThrow(/needs id, anchor and instruct/);
  });

  it("refuses an anchor that points at neither a node nor a testid", () => {
    const bad = "id: t\ntitle: T\nmodel: M\nsteps:\n  - id: s1\n    anchor:\n      nope: x\n    instruct: do it\n    done:\n      selectedNode: n\n";
    expect(() => parseWalkthrough(bad)).toThrow(/needs a node or a testid/);
  });
});

describe("the shipped walkthroughs", () => {
  it("all parse and have steps", () => {
    for (const [id, w] of Object.entries(WALKTHROUGHS)) {
      expect(w.steps.length, `"${id}" has no steps`).toBeGreaterThan(0);
    }
  });

  /**
   * A walkthrough either opens a model or builds one. Requiring `model` would
   * have ruled out exactly the case #1180 cares about — the DDM walkthrough
   * starts from an empty canvas — so the rule is that it must do one or the
   * other, never neither.
   */
  it("either name a model to open, get one in a step, or never point at the canvas", () => {
    for (const [id, w] of Object.entries(WALKTHROUGHS)) {
      const getsItsOwn = w.steps.some((s) => s.act?.newModel || s.act?.openModel);
      // The orientation's Settings parts (#1310) teach the window, not a
      // model: no step rings a canvas node, so no model is needed.
      const needsNone = w.steps.every((s) => !s.anchor.node);
      expect(
        Boolean(w.model) || getsItsOwn || needsNone,
        `"${id}" rings a canvas node but neither opens a model nor creates one`,
      ).toBe(true);
    }
  });

  /** The driver plays the learner; a step it can't act on would hang CI. */
  it("give every step an action the CI driver can perform", () => {
    for (const [id, w] of Object.entries(WALKTHROUGHS)) {
      for (const step of w.steps) {
        expect(step.act, `${id}/"${step.id}" has no act`).toBeDefined();
      }
    }
  });

  it("give every step something to point at", () => {
    for (const [id, w] of Object.entries(WALKTHROUGHS)) {
      for (const step of w.steps) {
        expect(
          step.anchor.node ?? step.anchor.testid,
          `${id}/"${step.id}" anchors to nothing`,
        ).toBeTruthy();
      }
    }
  });

  it("are selected by id, and an unknown id selects nothing", () => {
    expect(getWalkthrough("demo")?.id).toBe("demo");
    expect(getWalkthrough("build")?.id).toBe("build");
    expect(getWalkthrough("nope")).toBeNull();
    expect(getWalkthrough(null)).toBeNull();
  });

  it("include a walkthrough that teaches running a model", () => {
    const run = WALKTHROUGHS.run;
    expect(run.steps.some((s) => s.act?.runModel)).toBe(true);
    expect(run.steps.some((s) => s.done.trialsAtLeast)).toBe(true);
  });

  /**
   * The two course models so far, and deliberately opposite shapes: the DDM is
   * small enough to build, Stroop is not and is explored instead (#1180).
   */
  it("include Stroop, which opens a bundled model rather than building it", () => {
    const stroop = WALKTHROUGHS.stroop;
    expect(stroop.steps[0].act?.openModel).toBeTruthy();
    expect(stroop.steps.some((s) => s.act?.newModel)).toBe(false);
    // The pedagogical link back to chapter 2: Stroop's decision node is a DDM.
    expect(stroop.steps.some((s) => s.anchor.node === "decision")).toBe(true);
  });

  /** The course pilot (#51): the first walkthrough that builds its own model. */
  it("include the DDM walkthrough, which opens nothing and builds instead", () => {
    const ddm = WALKTHROUGHS.ddm;
    expect(ddm.model).toBeUndefined();
    expect(ddm.steps[0].act?.newModel).toBeTruthy();
    expect(ddm.steps.some((s) => s.act?.addFromPalette === "DDM")).toBe(true);
    expect(ddm.steps.some((s) => s.act?.runModel)).toBe(true);
  });

  /** The build walkthrough is the one that carries #1180's premise. */
  it("include a walkthrough that teaches building, not just looking", () => {
    const build = WALKTHROUGHS.build;
    expect(build.steps.some((s) => s.act?.addFromPalette)).toBe(true);
    expect(build.steps.some((s) => s.done.nodeExists)).toBe(true);
    expect(build.steps.some((s) => s.anchor.testid)).toBe(true);
  });
});

describe("isDone — the orientation's conditions (#1310)", () => {
  const seen = (ids: string[]) => (id: string) => ids.includes(id);

  it("visible: once the element is on screen; never without a way to look", () => {
    expect(isDone({ visible: "settings-panel" }, { ...state(null), isVisible: seen(["settings-panel"]) })).toBe(true);
    expect(isDone({ visible: "settings-panel" }, { ...state(null), isVisible: seen([]) })).toBe(false);
    expect(isDone({ visible: "settings-panel" }, state(null))).toBe(false);
  });

  it("hidden: once the element is gone; never without a way to look", () => {
    expect(isDone({ hidden: "settings-panel" }, { ...state(null), isVisible: seen([]) })).toBe(true);
    expect(isDone({ hidden: "settings-panel" }, { ...state(null), isVisible: seen(["settings-panel"]) })).toBe(false);
    expect(isDone({ hidden: "settings-panel" }, state(null))).toBe(false);
  });

  it("next: only when Next was pressed on this step", () => {
    expect(isDone({ next: true }, { ...state(null), nextPressed: true })).toBe(true);
    expect(isDone({ next: true }, { ...state(null), nextPressed: false })).toBe(false);
    expect(isDone({ next: true }, state(null))).toBe(false);
  });

  it("traceStepAtLeast: judged on the trace bar's step", () => {
    expect(isDone({ traceStepAtLeast: 1 }, { ...state(null), traceStep: 1 })).toBe(true);
    expect(isDone({ traceStepAtLeast: 1 }, { ...state(null), traceStep: 0 })).toBe(false);
    expect(isDone({ traceStepAtLeast: 1 }, { ...state(null), traceStep: null })).toBe(false);
  });

  it("fileNamed: the open file's name, wherever it is", () => {
    expect(isDone({ fileNamed: "orientation_edit.py" }, { ...state(null), filePath: "/Users/me/PsyNeuView-My-Models/orientation_edit.py" })).toBe(true);
    expect(isDone({ fileNamed: "orientation_edit.py" }, { ...state(null), filePath: "/Users/me/orientation_edit.py.bak" })).toBe(false);
    expect(isDone({ fileNamed: "orientation_edit.py" }, { ...state(null), filePath: null })).toBe(false);
  });

  it("says which conditions need the DOM watched", () => {
    expect(watchesDom({ visible: "x" })).toBe(true);
    expect(watchesDom({ hidden: "x" })).toBe(true);
    expect(watchesDom({ next: true })).toBe(false);
    expect(watchesDom({ selectedNode: "n" })).toBe(false);
  });
});

describe("parseWalkthrough — the orientation's fields (#1310)", () => {
  /** A one-step walkthrough; `head` goes between the title and the steps. */
  const doc = (head: string, step = "") =>
    "id: x\ntitle: X\n" + head + "steps:\n  - id: s\n    anchor: {testid: t}\n    instruct: i\n" + step + "    done: {next: true}\n";

  it("reads say, pointer, orientation, docs, developerMode and minutes", () => {
    const w = parseWalkthrough(
      "id: x\ntitle: X\norientation: 3\nminutes: 2\ndeveloperMode: true\ndocs: where-things-live.md\n" +
        "steps:\n  - id: s\n    anchor: {testid: t}\n    instruct: i\n    say: look here\n    pointer: true\n    done: {next: true}\n",
    );
    expect(w.orientation).toBe(3);
    expect(w.minutes).toBe(2);
    expect(w.developerMode).toBe(true);
    expect(w.docs).toEqual(["where-things-live.md"]);
    expect(w.steps[0].say).toBe("look here");
    expect(w.steps[0].pointer).toBe(true);
  });

  it("accepts a list of docs pages", () => {
    const w = parseWalkthrough(doc("docs:\n  - a.md\n  - tutorials/b.md\n"));
    expect(w.docs).toEqual(["a.md", "tutorials/b.md"]);
  });

  it("rejects a docs entry that isn't a markdown page", () => {
    expect(() => parseWalkthrough(doc("docs: https://example.com\n"))).toThrow(/docs must be paths/);
  });

  it("rejects an orientation number that isn't a whole number from 1", () => {
    expect(() => parseWalkthrough(doc("orientation: 0\n"))).toThrow(/orientation must be/);
    expect(() => parseWalkthrough(doc("orientation: first\n"))).toThrow(/orientation must be/);
  });

  it("rejects a pointer or say of the wrong shape", () => {
    expect(() => parseWalkthrough(doc("", "    pointer: yes please\n"))).toThrow(/pointer must be/);
    expect(() => parseWalkthrough(doc("", "    say: [a, b]\n"))).toThrow(/say must be text/);
  });

  it("takes say_phonemes only as text beside a say (#1407)", () => {
    expect(parseWalkthrough(doc("", "    say: Where it has been.\n    say_phonemes: Where it has [[ bˈɪn ]].\n")).steps[0].say_phonemes)
      .toBe("Where it has [[ bˈɪn ]].");
    expect(() => parseWalkthrough(doc("", "    say_phonemes: Where it has [[ bˈɪn ]].\n"))).toThrow(/needs a say/);
  });
});
