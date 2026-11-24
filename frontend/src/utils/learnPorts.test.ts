import { describe, expect, it } from "vitest";
import { flatTrial, gridPortSizes, trialForPorts } from "./learnPorts";

const PORTS = [
  { name: "RED_task", shape: [2] },
  { name: "WORD_task", shape: [1] },
];

describe("Learn panel grids for multi-port nodes (#358)", () => {
  it("edits every input port of a multi-port input node", () => {
    expect(gridPortSizes(PORTS, [2], true)).toEqual([2, 1]);
  });

  it("keeps one port for a one-port node and for targets", () => {
    expect(gridPortSizes([PORTS[0]], [2], true)).toEqual([2]);
    expect(gridPortSizes(PORTS, [2], false)).toEqual([2]);
  });

  it("sends a multi-port trial as one array per port", () => {
    expect(trialForPorts([1, 0, 1], [2, 1])).toEqual([[1, 0], [1]]);
  });

  it("sends a one-port trial as its vector, as before", () => {
    expect(trialForPorts([1, 0], [2])).toEqual([1, 0]);
  });

  it("lays a declared multi-port trial out across the ports", () => {
    expect(flatTrial([[1, 0], [1]])).toEqual([1, 0, 1]);
    expect(flatTrial([1, 0])).toEqual([1, 0]);
  });
});
