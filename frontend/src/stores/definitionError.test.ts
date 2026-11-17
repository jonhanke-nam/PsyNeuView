/**
 * An error in a statement that defines the model is shown even though the
 * rest built (#254).
 *
 * The backend now reports a skipped definition statement (a scheduler
 * condition naming an undefined node, say) as the load's error, with its line,
 * alongside the compositions that did build. The page must show both: the
 * graph of what built, and the error, on every load, not only the first.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useModelStore } from "./modelStore";

const BUILT_WITH_A_BAD_CONDITION = {
  compositions: [
    {
      varName: "comp",
      name: "comp",
      nodes: [
        { varName: "A", name: "A", type: "ProcessingMechanism" },
        { varName: "B", name: "B", type: "ProcessingMechanism" },
        { varName: "C", name: "C", type: "ProcessingMechanism" },
      ],
      projections: [],
    },
  ],
  lineMap: {},
  error: "name 'AN_UNDEFINED_VAR' is not defined",
  errorLine: 9,
  partialExecution: true,
  skippedStatements: [{ line: 9, error: "name 'AN_UNDEFINED_VAR' is not defined" }],
  definitionErrors: [{ line: 9, error: "name 'AN_UNDEFINED_VAR' is not defined" }],
};

function load(model: unknown) {
  useModelStore.getState().loadModelFromServer(model);
}

describe("a definition error with a built graph (#254)", () => {
  beforeEach(() => {
    useModelStore.setState({
      nodes: [], edges: [], modelError: null, modelErrorLine: null,
      graphIsStale: false, source: "", savedSource: "", shownSkippedErrors: [],
    });
  });

  it("shows the graph that built and the error with its line", () => {
    load(BUILT_WITH_A_BAD_CONDITION);
    const s = useModelStore.getState();
    expect(s.nodes.length).toBeGreaterThanOrEqual(3);
    expect(s.modelError).toBe("name 'AN_UNDEFINED_VAR' is not defined");
    expect(s.modelErrorLine).toBe(9);
    // What built is current, not a held older graph.
    expect(s.graphIsStale).toBe(false);
  });

  it("shows it on every load, not only the first", () => {
    load(BUILT_WITH_A_BAD_CONDITION);
    load(BUILT_WITH_A_BAD_CONDITION);
    load(BUILT_WITH_A_BAD_CONDITION);
    expect(useModelStore.getState().modelError).toBe("name 'AN_UNDEFINED_VAR' is not defined");
    expect(useModelStore.getState().modelErrorLine).toBe(9);
  });

  it("never records a model with a definition error as the last good source", () => {
    useModelStore.setState({ source: "the broken text", lastGoodSource: "the good text" });
    load(BUILT_WITH_A_BAD_CONDITION);
    expect(useModelStore.getState().lastGoodSource).toBe("the good text");
  });
});
