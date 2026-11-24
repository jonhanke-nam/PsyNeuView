import { describe, expect, it } from "vitest";
import { classifyStepRow, compositionMemberNames, ranAtStep } from "./stepHighlight";

// Two trials of a small Stroop-like run: inputs, then hidden, then output.
const trace = [
  ["color_input", "word_input"], // trial 1 starts
  ["color_hidden", "word_hidden"],
  ["output"],
  ["color_input", "word_input"], // trial 2 starts
  ["color_hidden", "word_hidden"],
  ["output"],
];

describe("ranAtStep (#365)", () => {
  it("is false with no step", () => {
    expect(ranAtStep(trace, null, ["output"])).toBe(false);
  });
  it("matches any of the node's names", () => {
    expect(ranAtStep(trace, 2, ["Output", "output"])).toBe(true);
    expect(ranAtStep(trace, 2, ["color_hidden"])).toBe(false);
  });
  it("is false past the end of the trace", () => {
    expect(ranAtStep(trace, 99, ["output"])).toBe(false);
  });
});

describe("classifyStepRow (#365)", () => {
  it("marks the nodes at the current step active", () => {
    expect(classifyStepRow(trace, 1, 0, ["color_hidden"])).toBe("active");
    expect(classifyStepRow(trace, 1, 0, ["word_hidden"])).toBe("active");
  });
  it("marks nodes that ran earlier in this trial done", () => {
    expect(classifyStepRow(trace, 1, 0, ["color_input"])).toBe("done");
    expect(classifyStepRow(trace, 2, 0, ["color_hidden"])).toBe("done");
  });
  it("marks nodes not reached yet in this trial pending", () => {
    expect(classifyStepRow(trace, 1, 0, ["output"])).toBe("pending");
    expect(classifyStepRow(trace, 0, 0, ["color_hidden"])).toBe("pending");
  });
  it("does not count steps from an earlier trial", () => {
    // At trial 2's first step, the output ran in trial 1 but not yet here.
    expect(classifyStepRow(trace, 3, 3, ["output"])).toBe("pending");
    expect(classifyStepRow(trace, 4, 3, ["color_input"])).toBe("done");
  });
  it("tries a log name without its -N suffix", () => {
    expect(classifyStepRow(trace, 2, 0, ["output-1"])).toBe("active");
  });
  it("ignores empty and missing names", () => {
    expect(classifyStepRow(trace, 2, 0, [undefined, null, ""])).toBe("pending");
  });
});

describe("compositionMemberNames (#365)", () => {
  it("lists every node inside, at any depth, with and without its -N suffix", () => {
    const em = {
      nodes: [
        { name: "STORE" },
        { name: "RETRIEVE-1" },
        { name: "INNER", nodes: [{ name: "DEEP" }] },
      ],
    };
    expect(compositionMemberNames(em).sort()).toEqual(
      ["DEEP", "INNER", "RETRIEVE", "RETRIEVE-1", "STORE"],
    );
  });
  it("is empty for a composition with no nodes", () => {
    expect(compositionMemberNames({})).toEqual([]);
  });
  it("lets a collapsed composition match a member's step", () => {
    const names = compositionMemberNames({ nodes: [{ name: "color_hidden" }] });
    expect(ranAtStep(trace, 1, ["EM", ...names])).toBe(true);
    expect(ranAtStep(trace, 2, ["EM", ...names])).toBe(false);
  });
});
