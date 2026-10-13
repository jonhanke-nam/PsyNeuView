import { describe, expect, it } from "vitest";

import type { InputSet } from "@/types/model";
import { MAX_PRELOAD_TRIALS, cellsFromSet, preloadable, setTrialCount, setsFor } from "./inputSets";

const set = (name: string, kind: InputSet["kind"], composition: string): InputSet => ({
  name, kind, composition, inputs: {},
});

describe("setsFor", () => {
  const sets = [set("kick", "run", "dyn"), set("and_gate", "learn", "gates"), set("other", "run", "stroop")];

  it("keeps the requested kind for the composition in use", () => {
    expect(setsFor(sets, "run", "dyn", 2).map((s) => s.name)).toEqual(["kick"]);
    expect(setsFor(sets, "learn", "gates", 2).map((s) => s.name)).toEqual(["and_gate"]);
  });

  it("ignores the composition name when the model has only one", () => {
    expect(setsFor([set("kick", "run", "bistable_attractor")], "run", "whatever", 1).map((s) => s.name)).toEqual([
      "kick",
    ]);
  });
});

describe("cellsFromSet", () => {
  const nodes = [
    { name: "node_attract1", varName: "node_attract1" },
    { name: "node_attract2", varName: "node_attract2" },
  ];

  it("turns each node's trials into grid cells, keyed by the grid's key", () => {
    const got = cellsFromSet({ node_attract1: [[2], [0]], node_attract2: [[6], [0]] }, nodes);
    expect(got).toEqual({ cells: { node_attract1: [["2"], ["0"]], node_attract2: [["6"], ["0"]] }, trials: 2 });
  });

  it("matches a node that picked up a session suffix", () => {
    const got = cellsFromSet({ a: [[1]] }, [{ name: "a-3", varName: "a_var" }]);
    expect(got?.cells).toEqual({ a_var: [["1"]] });
  });

  it("is null when a node isn't covered — no half-filled grids", () => {
    expect(cellsFromSet({ node_attract1: [[2]] }, nodes)).toBeNull();
  });

  it("is null when the nodes' trial counts differ", () => {
    expect(cellsFromSet({ node_attract1: [[2], [0]], node_attract2: [[6]] }, nodes)).toBeNull();
  });

  it("is null for no nodes at all", () => {
    expect(cellsFromSet({ a: [[1]] }, [])).toBeNull();
  });
});

describe("preloadable", () => {
  const set = (name: string, trials: number): InputSet => ({
    name,
    kind: "run",
    composition: "comp",
    inputs: { a: Array.from({ length: trials }, () => [0]) },
  });

  it("opens with the first small set", () => {
    expect(preloadable([set("kick", 3), set("other", 5)])?.name).toBe("kick");
  });

  it("skips a whole experiment, like the Nieuwenhuis model's 1,100 trials", () => {
    expect(setTrialCount(set("stim_list_dict", 1100))).toBe(1100);
    expect(preloadable([set("stim_list_dict", 1100)])).toBeUndefined();
    expect(preloadable([set("big", 1100), set("small", 4)])?.name).toBe("small");
  });

  it("keeps a set right at the limit", () => {
    expect(preloadable([set("edge", MAX_PRELOAD_TRIALS)])?.name).toBe("edge");
  });
});
