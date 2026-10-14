import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import {
  applyShowGraphPlacement,
  graphSignature,
  placementFromGraphviz,
  scaleFor,
} from "./showGraphLayout";

// show_graph(output_fmt="source") for the bundled Stroop reference model
// (backend/reference_models/stroop_reference_basic.py), as the backend returns
// it. show_graph draws it with word_input, task_input, color_input along the
// bottom, the hidden layers above, then output, then decision.
const STROOP_DOT = `digraph stroop_model {
	graph [label=stroop_model overlap=False rankdir=BT]
	node [color=black fontname=arial fontsize=12 penwidth=1 shape=record]
	edge [fontname=arial fontsize=10]
	task_input [color=green penwidth=3 rank=source shape=oval]
	word_input [color=green penwidth=3 rank=source shape=oval]
	color_input [color=green penwidth=3 rank=source shape=oval]
	color_hidden [color=black penwidth=1 rank=same shape=oval]
	color_input -> color_hidden [label="" arrowhead=normal color=black penwidth=1]
	task_input -> color_hidden [label="" arrowhead=normal color=black penwidth=1]
	word_hidden [color=black penwidth=1 rank=same shape=oval]
	task_input -> word_hidden [label="" arrowhead=normal color=black penwidth=1]
	word_input -> word_hidden [label="" arrowhead=normal color=black penwidth=1]
	output [color=black penwidth=1 rank=same shape=oval]
	color_hidden -> output [label="" arrowhead=normal color=black penwidth=1]
	word_hidden -> output [label="" arrowhead=normal color=black penwidth=1]
	output -> decision [label="" arrowhead=normal color=black penwidth=1]
	decision [color=red penwidth=3 rank=max shape=oval]
	{ rank=source color_input word_input task_input }
	{ rank=sink decision }
	color_input -> color_hidden [arrowhead=none constraint=true style=invis weight=100]
	color_input -> word_hidden [arrowhead=none constraint=true style=invis weight=100]
	color_input -> output [arrowhead=none constraint=true style=invis weight=100]
	color_input -> decision [arrowhead=none constraint=true style=invis weight=100]
	color_hidden -> decision [arrowhead=none constraint=true style=invis weight=100]
	word_input -> decision [arrowhead=none constraint=true style=invis weight=100]
	word_hidden -> decision [arrowhead=none constraint=true style=invis weight=100]
	output -> decision [arrowhead=none constraint=true style=invis weight=100]
	task_input -> decision [arrowhead=none constraint=true style=invis weight=100]
}`;

const NAMES = [
  "task_input",
  "word_input",
  "color_input",
  "color_hidden",
  "word_hidden",
  "output",
  "decision",
];

const mech = (id: string, w = 190, h = 70): Node => ({
  id,
  type: "mechanismNode",
  position: { x: 0, y: 0 },
  data: { label: id },
  measured: { width: w, height: h },
});

async function stroopPlacement(nodes: Node[]) {
  const gv = await Graphviz.load();
  const json = JSON.parse(gv.layout(STROOP_DOT, "json", "dot"));
  return placementFromGraphviz(json, graphSignature(nodes));
}

describe("Like show_graph layout (#19)", () => {
  it("keeps show_graph's rows and left-to-right order", async () => {
    const nodes = NAMES.map((n) => mech(n));
    const laid = applyShowGraphPlacement(nodes, await stroopPlacement(nodes))!;
    const at = (id: string) => laid.find((n) => n.id === id)!.position;

    // Rows, bottom to top: inputs, hidden layers, output, decision.
    const rows = (ids: string[]) => new Set(ids.map((id) => Math.round(at(id).y))).size;
    expect(rows(["task_input", "word_input", "color_input"])).toBe(1);
    expect(rows(["word_hidden", "color_hidden"])).toBe(1);
    expect(at("task_input").y).toBeGreaterThan(at("word_hidden").y);
    expect(at("word_hidden").y).toBeGreaterThan(at("output").y);
    expect(at("output").y).toBeGreaterThan(at("decision").y);

    // show_graph's order along the bottom row and the hidden row.
    expect(at("word_input").x).toBeLessThan(at("task_input").x);
    expect(at("task_input").x).toBeLessThan(at("color_input").x);
    expect(at("word_hidden").x).toBeLessThan(at("color_hidden").x);
  });

  it("enlarges the picture so no two boxes overlap", async () => {
    const W = 260;
    const H = 90;
    const nodes = NAMES.map((n) => mech(n, W, H));
    const placement = await stroopPlacement(nodes);
    const { sx, sy } = scaleFor(nodes, placement);
    expect(sx).toBeGreaterThan(1);
    expect(sy).toBeGreaterThan(1);

    const laid = applyShowGraphPlacement(nodes, placement)!;
    for (const a of laid) {
      for (const b of laid) {
        if (a.id >= b.id) continue;
        const apart =
          a.position.x + W <= b.position.x + 0.5 ||
          b.position.x + W <= a.position.x + 0.5 ||
          a.position.y + H <= b.position.y + 0.5 ||
          b.position.y + H <= a.position.y + 0.5;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it("declines a layout computed for a different graph", async () => {
    const placement = await stroopPlacement(NAMES.map((n) => mech(n)));
    const other = ["a", "b", "c"].map((n) => mech(n));
    expect(applyShowGraphPlacement(other, placement)).toBeNull();
  });
});
