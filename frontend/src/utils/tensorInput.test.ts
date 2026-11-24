import { describe, expect, it } from "vitest";
import {
  defaultPortText,
  describeShape,
  formatTensor,
  joinElements,
  parsePortInput,
  parseTensor,
  pastedPortRows,
  pastedRows,
  portValues,
  shapeOf,
  splitElements,
  trialValue,
  wholeTrialText,
} from "./tensorInput";

describe("parseTensor (#330)", () => {
  it("reads bracket notation, flat and nested", () => {
    expect(parseTensor("[0, 1]")).toEqual({ ok: true, value: [0, 1] });
    expect(parseTensor(" [ [0, 1], [1, 0] ] ")).toEqual({ ok: true, value: [[0, 1], [1, 0]] });
    expect(parseTensor("[-1.5, .25, 2e-3]")).toEqual({ ok: true, value: [-1.5, 0.25, 0.002] });
    expect(parseTensor("[]")).toEqual({ ok: true, value: [] });
    expect(parseTensor("3")).toEqual({ ok: true, value: 3 });
  });

  it("reads numpy's printed form, spaces between elements", () => {
    expect(parseTensor("[0. 1.]")).toEqual({ ok: true, value: [0, 1] });
    expect(parseTensor("[[1 0]\n [0 1]]")).toEqual({ ok: true, value: [[1, 0], [0, 1]] });
  });

  it("says what is wrong", () => {
    expect(parseTensor("[0, 1")).toEqual({ ok: false, error: "Missing a closing ]" });
    expect(parseTensor("[0, x]")).toEqual({ ok: false, error: '"x" isn\'t a number' });
    expect(parseTensor("[0, 1x]")).toEqual({ ok: false, error: '"1x" isn\'t a number' });
    expect(parseTensor("[0, 1]]")).toEqual({ ok: false, error: "Unexpected text after the closing ]" });
    expect(parseTensor("[0, ]")).toEqual({ ok: false, error: "Missing a number after the last comma" });
    expect(parseTensor("")).toEqual({ ok: false, error: "Missing a number or [" });
    expect(parseTensor("[1e999]").ok).toBe(false);
  });
});

describe("formatTensor", () => {
  it("writes the standard notation, nested", () => {
    expect(formatTensor([0, 1])).toBe("[0, 1]");
    expect(formatTensor([[0, 1], [1]])).toBe("[[0, 1], [1]]");
    expect(formatTensor([0.123456, 2], 4)).toBe("[0.1235, 2]");
  });

  it("round-trips through the parser", () => {
    for (const v of [[0, 1], [[1, 0], [0, 1]], [[0.5, -2], [3]], [1e-7, 42]]) {
      const parsed = parseTensor(formatTensor(v));
      expect(parsed).toEqual({ ok: true, value: v });
    }
  });
});

describe("shapes", () => {
  it("measures regular arrays and refuses ragged ones", () => {
    expect(shapeOf([0, 1])).toEqual([2]);
    expect(shapeOf([[0, 1, 2], [3, 4, 5]])).toEqual([2, 3]);
    expect(shapeOf(7)).toEqual([]);
    expect(shapeOf([[0, 1], [1]])).toBeNull();
  });

  it("describes shapes in words", () => {
    expect(describeShape([2])).toBe("2 numbers");
    expect(describeShape([1])).toBe("1 number");
    expect(describeShape([2, 3])).toBe("2 lists of 3 numbers");
    expect(describeShape([2, 3, 4])).toBe("a 2×3×4 array");
  });
});

describe("parsePortInput", () => {
  it("accepts the port's shape", () => {
    expect(parsePortInput("[0, 1]", [2])).toEqual({ ok: true, value: [0, 1] });
    expect(parsePortInput("[[1, 2, 3], [4, 5, 6]]", [2, 3])).toEqual({ ok: true, value: [[1, 2, 3], [4, 5, 6]] });
  });

  it("flags a wrong length or shape", () => {
    expect(parsePortInput("[0, 1, 1]", [2])).toEqual({ ok: false, error: "Needs 2 numbers, got 3" });
    expect(parsePortInput("[0, 1]", [2, 3])).toEqual({ ok: false, error: "Needs 2 lists of 3 numbers, got 2 numbers" });
    expect(parsePortInput("[[0, 1], [1]]", [2, 2])).toEqual({ ok: false, error: "Rows have different lengths" });
  });

  it("accepts PsyNeuLink's extra brackets and a bare number for one element", () => {
    expect(parsePortInput("[[0, 1]]", [2])).toEqual({ ok: true, value: [0, 1] });
    expect(parsePortInput("5", [1])).toEqual({ ok: true, value: [5] });
    expect(parsePortInput("5", [])).toEqual({ ok: true, value: [5] });
    expect(parsePortInput("5", [2])).toEqual({ ok: false, error: "Needs 2 numbers, got a single number" });
  });
});

describe("one array per port", () => {
  it("sends one port's array, or one array per port", () => {
    expect(trialValue([[0, 1]])).toEqual([0, 1]);
    expect(trialValue([[0, 1], [1]])).toEqual([[0, 1], [1]]);
  });

  it("splits a trial's value back into its ports", () => {
    expect(portValues([0, 1], 1)).toEqual([[0, 1]]);
    expect(portValues([[0, 1], [1]], 2)).toEqual([[0, 1], [1]]);
  });
});

describe("grid cells and pasted rows", () => {
  it("splits and joins elements, keeping cells mid-edit", () => {
    expect(splitElements("[0, 1]")).toEqual(["0", "1"]);
    expect(splitElements("[0, ]")).toEqual(["0", ""]);
    expect(splitElements("[0. 1.]")).toEqual(["0.", "1."]);
    expect(joinElements(["0", ""])).toBe("[0, ]");
    expect(splitElements(joinElements(["1", "abc"]))).toEqual(["1", "abc"]);
  });

  it("defaults to a one-hot vector stepping through the elements", () => {
    expect(defaultPortText([2], 0)).toBe("[1, 0]");
    expect(defaultPortText([2], 1)).toBe("[0, 1]");
    expect(defaultPortText([2], 2)).toBe("[1, 0]");
    expect(defaultPortText([], 0)).toBe("[1]");
    expect(defaultPortText([2, 2], 0)).toBe("[[0, 0], [0, 0]]");
  });

  it("reads pasted CSV and bracket lines", () => {
    expect(pastedRows("1, 0\n0\n\n[0, 1]\n", 2)).toEqual(["[1, 0]", "[0, 0]", "[0, 1]"]);
    expect(pastedRows("1,2,3", 2)).toEqual(["[1, 2]"]);
  });
});

describe("multi-port input nodes (#332)", () => {
  it("writes a two-port trial as Composition.run takes it", () => {
    const parsed = [parsePortInput("[1, 0]", [2]), parsePortInput("0", [1])];
    expect(wholeTrialText(["[1, 0]", "0"], parsed)).toBe("[[1, 0], [0]]");
    expect(trialValue(parsed.map((r) => (r.ok ? r.value : 0)))).toEqual([[1, 0], [0]]);
  });

  it("shows a port that doesn't parse as typed", () => {
    const parsed = [parsePortInput("[1, 0, 1]", [2]), parsePortInput("[1]", [1])];
    expect(parsed[0].ok).toBe(false);
    expect(wholeTrialText(["[1, 0, 1]", "[1]"], parsed)).toBe("[[1, 0, 1], [1]]");
  });

  it("splits a trial back into one value per port", () => {
    expect(portValues([[1, 0], [0]], 2)).toEqual([[1, 0], [0]]);
  });

  it("pastes a bracketed trial into its ports", () => {
    expect(pastedPortRows("[[1, 0], [1]]\n[[0, 1], [0]]", [2, 1])).toEqual([
      ["[1, 0]", "[1]"],
      ["[0, 1]", "[0]"],
    ]);
  });

  it("deals a comma-separated line out across the ports", () => {
    expect(pastedPortRows("1, 0, 1\n0, 1", [2, 1])).toEqual([
      ["[1, 0]", "[1]"],
      ["[0, 1]", "[0]"],
    ]);
  });

  it("keeps one-port pasting as it was", () => {
    expect(pastedPortRows("1, 0\n[0, 1]", [2])).toEqual([["[1, 0]"], ["[0, 1]"]]);
  });
});
