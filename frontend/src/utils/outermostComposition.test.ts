/** #252: "the top level" is the composition no other contains, not the first listed. */
import { describe, expect, it } from "vitest";
import { outermostComposition } from "./nodeActions";

describe("outermostComposition", () => {
  it("finds the outer one when an inner one is listed first", () => {
    const comps = [
      { varName: "inner_comp", name: "inner_comp", nodes: [{ name: "inner_a" }, { name: "inner_b" }] },
      { varName: "model", name: "model", nodes: [{ name: "outer_in" }, { name: "inner_comp" }, { name: "outer_out" }] },
    ];
    expect(outermostComposition(comps)).toBe("model");
  });

  it("finds the outer one in the flattened view, where it lists the inner one's nodes", () => {
    const comps = [
      { varName: "inner_comp", nodes: [{ name: "inner_a" }, { name: "inner_b" }] },
      { varName: "model", nodes: [{ name: "outer_in" }, { name: "inner_a" }, { name: "inner_b" }, { name: "outer_out" }] },
    ];
    expect(outermostComposition(comps)).toBe("model");
  });

  it("takes the only one, or the first when nothing says otherwise", () => {
    expect(outermostComposition([{ varName: "m", nodes: [] }])).toBe("m");
    expect(outermostComposition([])).toBeUndefined();
  });
});
