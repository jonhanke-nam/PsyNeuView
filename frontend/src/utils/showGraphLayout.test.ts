import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import {
  applyShowGraphPlacement,
  applyShowGraphPlacementWithCurves,
  curveBends,
  curvePath,
  graphSignature,
  placementFromGraphviz,
  scaleFor,
  simplify,
  trimToBoxes,
} from "./showGraphLayout";
import { curveFits } from "@/stores/showGraphCurvesStore";

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

// The projections PsyNeuView draws for the Stroop model, as edges.
const STROOP_EDGES: [string, string][] = [
  ["color_input", "color_hidden"],
  ["task_input", "color_hidden"],
  ["task_input", "word_hidden"],
  ["word_input", "word_hidden"],
  ["color_hidden", "output"],
  ["word_hidden", "output"],
  ["output", "decision"],
];
const edgesOf = (pairs: [string, string][]): Edge[] =>
  pairs.map(([source, target], i) => ({ id: `e${i}-${source}-${target}`, source, target }));

describe("Like show_graph edges (#23)", () => {
  it("keeps show_graph's drawn edges, not the invisible ones that steer its layout", async () => {
    const nodes = NAMES.map((n) => mech(n));
    const placement = await stroopPlacement(nodes);
    expect(placement.edges).toHaveLength(7);
    expect(placement.edges.map((e) => `${e.tail}>${e.head}`).sort()).toEqual(
      STROOP_EDGES.map(([a, b]) => `${a}>${b}`).sort(),
    );
    for (const e of placement.edges) {
      expect((e.spline.length - 1) % 3).toBe(0); // a cubic Bézier chain
      expect(e.tip).toBeDefined();
    }
  });

  it("gives every matched edge a course from its source oval to its target oval", async () => {
    const nodes = NAMES.map((n) => mech(n));
    const edges = edgesOf(STROOP_EDGES);
    const placed = applyShowGraphPlacementWithCurves(nodes, edges, await stroopPlacement(nodes))!;
    const box = (id: string) => {
      const n = placed.nodes.find((x) => x.id === id)!;
      return { x: n.position.x, y: n.position.y, w: 190, h: 70 };
    };
    // On the oval that fills the box: (dx/rx)² + (dy/ry)² ≈ 1.
    const onEdge = (p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) => {
      const rx = b.w / 2, ry = b.h / 2;
      const dx = (p.x - b.x - rx) / rx, dy = (p.y - b.y - ry) / ry;
      return Math.abs(dx * dx + dy * dy - 1) < 0.02;
    };
    for (const e of edges) {
      const c = placed.curves[e.id];
      expect(c, e.id).toBeDefined();
      expect(onEdge(c.points[0], box(e.source)), `${e.id} starts on its source`).toBe(true);
      expect(onEdge(c.points[c.points.length - 1], box(e.target)), `${e.id} ends on its target`).toBe(true);
      // BT: show_graph draws upward, so every Stroop edge rises.
      expect(c.points[c.points.length - 1].y).toBeLessThan(c.points[0].y);
      expect(curveFits(c, box(e.source), box(e.target))).toBe(true);
      expect(curvePath(c.points)).toMatch(/^M [-\d.]+ [-\d.]+( C [-\d. ]+)+$/);
    }
  });

  it("leaves edges show_graph doesn't draw to normal routing", async () => {
    const nodes = NAMES.map((n) => mech(n));
    const extra = edgesOf([...STROOP_EDGES, ["decision", "task_input"]]);
    const placed = applyShowGraphPlacementWithCurves(nodes, extra, await stroopPlacement(nodes))!;
    expect(Object.keys(placed.curves)).toHaveLength(7);
    expect(placed.curves[extra[7].id]).toBeUndefined();
  });

  it("stops fitting once a node moves", () => {
    const curve = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], source: { x: 10, y: 20 }, target: { x: 30, y: 40 } };
    expect(curveFits(curve, { x: 10.4, y: 20 }, { x: 30, y: 40 })).toBe(true);
    expect(curveFits(curve, { x: 60, y: 20 }, { x: 30, y: 40 })).toBe(false);
    expect(curveFits(curve, undefined, { x: 30, y: 40 })).toBe(false);
  });

  it("trims a course to the boxes it joins", () => {
    const source = { x: 0, y: 0, w: 10, h: 10 };
    const target = { x: 0, y: 40, w: 10, h: 10 };
    const course = [0, 5, 10, 20, 30, 40, 45].map((y) => ({ x: 5, y }));
    const t = trimToBoxes(course, source, target)!;
    expect(t[0].y).toBeCloseTo(10, 3);
    expect(t[t.length - 1].y).toBeCloseTo(40, 3);
    expect(trimToBoxes(course, source, { x: -100, y: -100, w: 300, h: 300 })).toBeNull();
  });

  it("leads a course that stops short of a box in from the box's edge", () => {
    const source = { x: 0, y: 0, w: 10, h: 10 };
    const target = { x: 0, y: 40, w: 10, h: 10 };
    const short = [15, 20, 25].map((y) => ({ x: 5, y })); // touches neither box
    const t = trimToBoxes(short, source, target)!;
    expect(t[0]).toEqual({ x: 5, y: expect.closeTo(10, 3) });
    expect(t[t.length - 1]).toEqual({ x: 5, y: expect.closeTo(40, 3) });
  });

  it("simplifies a straight run to its ends, and grabs a curve by its turning points", () => {
    const straight = [0, 1, 2, 3, 4].map((i) => ({ x: i * 10, y: i * 10 }));
    expect(simplify(straight)).toEqual([straight[0], straight[4]]);
    const elbow = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }];
    expect(curveBends(elbow)).toEqual([{ x: 100, y: 0 }]);
    expect(curveBends(straight)).toEqual([{ x: 20, y: 20 }]); // nearly straight: its middle
  });
});
