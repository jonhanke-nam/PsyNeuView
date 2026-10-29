/**
 * The Inspector's instant edit of the code must not break a list value (#45).
 *
 * Before the backend answers, the Inspector rewrites the parameter in the
 * editor itself. That rewrite replaced up to the first comma, so editing a
 * projection's matrix, [[1, 4], [2, 5], [3, 6]], left `[[10,4],[2,5],[3,6]],
 * 4], [2, 5], [3, 6]]` behind — and the buffer was saved before the backend's
 * own (bracket-aware) edit ran, so the model file broke. A list, tuple or dict
 * now goes to the backend alone.
 */
import { describe, expect, it } from "vitest";

import { applyOptimisticUpdate } from "./InspectorPanel";

const SOURCE = [
  "vector_b = pnl.TransferMechanism(",
  "    name='vector_b',",
  "    function=pnl.Linear(slope=1),",
  ")",
  "",
  "matrix_A = pnl.MappingProjection(",
  "    name='matrix_A',",
  "    matrix=[[1, 4],",
  "            [2, 5],",
  "            [3, 6]],",
  ")",
].join("\n");

describe("applyOptimisticUpdate", () => {
  it("leaves a multi-line matrix to the backend", () => {
    expect(applyOptimisticUpdate(SOURCE, "matrix_A", "matrix", "[[10,4],[2,5],[3,6]]", "mechanism", false)).toBeNull();
  });

  it("leaves a one-line matrix to the backend too", () => {
    const oneLine = SOURCE.replace("[[1, 4],\n            [2, 5],\n            [3, 6]]", "[[1, 4], [2, 5], [3, 6]]");
    expect(applyOptimisticUpdate(oneLine, "matrix_A", "matrix", "[[10,4],[2,5],[3,6]]", "mechanism", false)).toBeNull();
  });

  it("still edits a plain number at once", () => {
    const updated = applyOptimisticUpdate(SOURCE, "vector_b", "slope", "2", "function", false);
    expect(updated).toContain("function=pnl.Linear(slope=2),");
  });

  /** #9: the Primer's Stroop model writes its mechanisms on one line each. */
  const STROOP = [
    "output = pnl.ProcessingMechanism(name='OUTPUT', input_shapes=2, function=pnl.Logistic)",
    "color_pathway = [color_input, color_hidden, output]",
    "word_hidden = pnl.ProcessingMechanism(name='WORD HIDDEN', input_shapes=2, function=pnl.Logistic(bias=-4))",
  ].join("\n");

  it("never edits the next mechanism: a bare function class goes to the backend", () => {
    expect(applyOptimisticUpdate(STROOP, "output", "gain", "2", "function", false)).toBeNull();
  });

  it("puts a new function parameter inside the function's call, not the mechanism's", () => {
    const updated = applyOptimisticUpdate(STROOP, "word_hidden", "gain", "2", "function", false)!;
    expect(updated.split("\n")[2]).toBe(
      "word_hidden = pnl.ProcessingMechanism(name='WORD HIDDEN', input_shapes=2, function=pnl.Logistic(bias=-4, gain=2))",
    );
    expect(updated.split("\n")[0]).toBe(STROOP.split("\n")[0]);
  });
});
