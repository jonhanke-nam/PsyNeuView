import { describe, expect, it } from "vitest";

import { prunePositions } from "./prunePositions";

const at = (x: number, y: number) => ({ x, y });

describe("prunePositions", () => {
  it("drops a node the model no longer declares", () => {
    const out = prunePositions({
      saved: { a: at(1, 1), gone: at(9, 9) },
      current: { a: at(1, 1) },
      declared: new Set(["a"]),
    });
    expect(out).toEqual({ a: at(1, 1) });
  });

  /** The bug this exists to prevent. */
  it("stops a reused name inheriting a stranger's position", () => {
    const first = prunePositions({
      saved: { old_node: at(500, 500) },
      current: {},
      declared: new Set(["something_else"]),
    });
    expect(first.old_node).toBeUndefined();
  });

  it("keeps a node that is declared but not on the canvas", () => {
    // Collapsed compositions and the other view's nodes (#659).
    const out = prunePositions({
      saved: { offscreen: at(3, 3) },
      current: {},
      declared: new Set(["offscreen"]),
    });
    expect(out.offscreen).toEqual(at(3, 3));
  });

  it("keeps a node on the canvas even if the model does not name it", () => {
    // CIM and derived nodes are real and positioned, without a lineMap entry.
    const out = prunePositions({
      saved: { "CIM a": at(2, 2) },
      current: { "CIM a": at(2, 2) },
      declared: new Set(["a"]),
    });
    expect(out["CIM a"]).toEqual(at(2, 2));
  });

  /** The refusal that matters most: never read "cannot tell" as "delete all". */
  it("prunes nothing when the model declares nothing", () => {
    const saved = { a: at(1, 1), b: at(2, 2) };
    expect(prunePositions({ saved, current: {}, declared: new Set() })).toEqual(saved);
  });

  it("lets current positions win over saved ones", () => {
    const out = prunePositions({
      saved: { a: at(1, 1) },
      current: { a: at(7, 7) },
      declared: new Set(["a"]),
    });
    expect(out.a).toEqual(at(7, 7));
  });

  it("keeps a position at the origin", () => {
    const out = prunePositions({
      saved: { a: at(0, 0) },
      current: {},
      declared: new Set(["a"]),
    });
    expect(out.a).toEqual(at(0, 0));
  });
});
