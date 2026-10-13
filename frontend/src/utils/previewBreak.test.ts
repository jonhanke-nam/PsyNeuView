import { describe, expect, it } from "vitest";

import { newlyBrokenStatement } from "./previewBreak";

const NONE = new Set<number>();

describe("newlyBrokenStatement (#1367)", () => {
  it("is null when nothing was skipped", () => {
    expect(newlyBrokenStatement(undefined, [], NONE)).toBeNull();
    expect(newlyBrokenStatement([], ["x"], NONE)).toBeNull();
  });

  it("names a statement the shown build did not skip", () => {
    const s = { line: 15, error: "name 'this' is not defined" };
    expect(newlyBrokenStatement([s], [], NONE)).toEqual(s);
  });

  it("ignores a skip the shown build had too, wherever it moved", () => {
    // A library model's driver line fails on every build (#796).
    const driver = { line: 90, error: "Parameter 'value' has no value" };
    expect(newlyBrokenStatement([driver], ["Parameter 'value' has no value"], NONE)).toBeNull();
    expect(newlyBrokenStatement([{ ...driver, line: 91 }], ["Parameter 'value' has no value"], NONE)).toBeNull();
  });

  it("counts a second copy of a shown failure as new", () => {
    const e = "name 'b' is not defined";
    const got = newlyBrokenStatement([{ line: 3, error: e }, { line: 9, error: e }], [e], NONE);
    expect(got).toEqual({ line: 9, error: e });
  });

  it("leaves a dangling projection to the phantom node", () => {
    const s = { line: 8, error: "name 'b' is not defined" };
    expect(newlyBrokenStatement([s], [], new Set([8]))).toBeNull();
  });

  it("returns the first new one, past the ones accounted for", () => {
    const got = newlyBrokenStatement(
      [
        { line: 2, error: "old" },
        { line: 5, error: "dangling" },
        { line: 7, error: "new" },
      ],
      ["old"],
      new Set([5]),
    );
    expect(got).toEqual({ line: 7, error: "new" });
  });
});
