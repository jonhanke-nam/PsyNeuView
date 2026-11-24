import { describe, expect, it } from "vitest";
import { portElementLabels } from "./labels";

// A node with two input ports, RED_task (2 elements) and WORD_task (1), as in
// the two-port fixture (#358).
const PORTS = [
  { name: "RED_task", shape: [2] },
  { name: "WORD_task", shape: [1] },
];

describe("portElementLabels (#358)", () => {
  it("names each port's elements from the sidecar's per-port labels", () => {
    const labels = {
      task_demand: {
        input_ports: {
          RED_task: { element_names: ["red", "green"] },
          WORD_task: { element_names: ["word"] },
        },
      },
    };
    expect(portElementLabels(labels, "task_demand", PORTS, "input")).toEqual([["red", "green"], ["word"]]);
  });

  it("prefers the model's own port labels", () => {
    const ports = [PORTS[0], { ...PORTS[1], element_names: ["w"] }];
    expect(portElementLabels(null, "task_demand", ports, "input")).toEqual([["[0]", "[1]"], ["w"]]);
  });

  it("falls back to positions when the labels don't fit the port", () => {
    const labels = { task_demand: { input_ports: { RED_task: { element_names: ["only one"] } } } };
    expect(portElementLabels(labels, "task_demand", PORTS, "input")).toEqual([["[0]", "[1]"], ["[0]"]]);
  });

  it("applies the node-level shorthand to the first port only", () => {
    const ports = [
      { name: "A", shape: [2] },
      { name: "B", shape: [2] },
    ];
    const labels = { n: { element_names: ["x", "y"] } };
    expect(portElementLabels(labels, "n", ports, "input")).toEqual([["x", "y"], ["[0]", "[1]"]]);
  });
});
