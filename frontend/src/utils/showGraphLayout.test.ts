import { afterEach, describe, it, expect, vi } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import {
  applyShowGraphPlacement,
  applyShowGraphPlacementWithCurves,
  computeShowGraphPlacement,
  curveBends,
  curvePath,
  graphSignature,
  memberAtPort,
  placementFromGraphviz,
  scaleFor,
  simplify,
  trimToBoxes,
  type ShowGraphRequest,
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

  it("keeps a frame's header clear of its members, and of the row above (#71)", () => {
    // show_graph: `top` above cluster EM, which holds `a` over `b`. Its
    // cluster box is snug around the ovals, so the enlarged boxes reach
    // past it.
    const nodes: Node[] = [
      mech("top"),
      { id: "EM", type: "compositionNode", position: { x: 0, y: 0 }, data: { label: "EM" } },
      { ...mech("a"), parentId: "EM" },
      { ...mech("b"), parentId: "EM" },
    ];
    const placement = {
      signature: graphSignature(nodes),
      nodes: new Map([
        ["top", { x: 100, y: 20, w: 60, h: 36 }],
        ["a", { x: 100, y: 100, w: 60, h: 36 }],
        ["b", { x: 100, y: 180, w: 60, h: 36 }],
      ]),
      clusters: new Map([["EM", { x: 62, y: 74, w: 76, h: 132 }]]),
      edges: [],
    };
    const laid = applyShowGraphPlacement(nodes, placement)!;
    const get = (id: string) => laid.find((n) => n.id === id)!;
    const frame = get("EM");
    const fw = frame.style!.width as number;
    const fh = frame.style!.height as number;
    for (const id of ["a", "b"]) {
      const { x, y } = get(id).position; // relative to the frame
      expect(y, `${id} reaches into the header`).toBeGreaterThanOrEqual(30);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x + 190).toBeLessThanOrEqual(fw - 10);
      expect(y + 70).toBeLessThanOrEqual(fh - 10);
    }
    expect(get("top").position.y + 70).toBeLessThanOrEqual(frame.position.y);
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

describe("Like show_graph with learning on a nested model (#72)", () => {
  // show_graph's answers for a model `M` with a nested composition `EM`:
  // without learning, EM as a box; with learning, only the PyTorch picture,
  // flat, which the backend marks with a note.
  const PLAIN = `digraph M {
    graph [rankdir=BT]
    a [shape=oval]
    subgraph cluster_EM { graph [label=EM] x [shape=oval] y [shape=oval] x -> y }
    a -> x
  }`;
  const PYTORCH = `digraph M {
    graph [rankdir=BT]
    a [shape=oval] x [shape=oval] y [shape=oval]
    a -> x x -> y
  }`;
  const NOTE = "show_graph shows learning for 'M', which has a nested composition, only as its PyTorch picture.";

  function answering() {
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const learning = JSON.parse(init.body).options.show_learning;
      return new Response(JSON.stringify(learning ? { dot: PYTORCH, note: NOTE } : { dot: PLAIN }));
    });
  }
  afterEach(() => vi.unstubAllGlobals());

  const req: ShowGraphRequest = {
    filePath: "/m.py",
    compositionName: "M",
    options: { show_controller: true, show_learning: true, show_cim: false, show_nested: "nested" },
  };

  it("follows show_graph without learning when the canvas shows the nested composition open", async () => {
    answering();
    const nodes: Node[] = [
      mech("a"),
      { id: "EM", type: "compositionNode", position: { x: 0, y: 0 }, data: { label: "EM" } },
      { ...mech("x"), parentId: "EM" },
      { ...mech("y"), parentId: "EM" },
    ];
    const placement = await computeShowGraphPlacement(req, nodes);
    expect(placement.clusters.has("EM")).toBe(true);
    expect(placement.note).toMatch(/without learning/);
  });

  it("follows the PyTorch picture when the canvas has no frame to fit", async () => {
    answering();
    const placement = await computeShowGraphPlacement(req, ["a", "x", "y"].map((n) => mech(n)));
    expect(placement.clusters.size).toBe(0);
    expect(placement.note).toMatch(/follows that picture/);
  });
});

describe("Like show_graph edges into an open frame (#73)", () => {
  // nested_compositions: outer_a -> [inner_comp: inner_x -> inner_y] -> outer_b.
  // show_graph draws the two outer projections to and from the members.
  const DOT = `digraph outer_comp {
    graph [rankdir=BT]
    outer_a [shape=oval] outer_b [shape=oval]
    subgraph cluster_inner_comp { graph [label=inner_comp] inner_x [shape=oval] inner_y [shape=oval] inner_x -> inner_y }
    outer_a -> inner_x
    inner_y -> outer_b
  }`;
  const nodes: Node[] = [
    mech("outer_a"),
    mech("outer_b"),
    { id: "inner_comp", type: "compositionNode", position: { x: 0, y: 0 }, data: { label: "inner_comp" } },
    { ...mech("inner_x"), parentId: "inner_comp" },
    { ...mech("inner_y"), parentId: "inner_comp" },
  ];
  // PsyNeuView ends the outer projections at the frame's interface ports.
  const edges: Edge[] = [
    { id: "in", source: "outer_a", target: "inner_comp", targetHandle: "INPUT_CIM_inner_x_InputPort-0" },
    { id: "inner", source: "inner_x", target: "inner_y" },
    { id: "out", source: "inner_comp", sourceHandle: "OUTPUT_CIM_inner_y_RESULT", target: "outer_b" },
  ];

  it("names the member a frame's port carries to or from, however deep", () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(memberAtPort("inner_comp", "INPUT_CIM_inner_x_InputPort-0", "INPUT_CIM_", byId, nodes)).toBe("inner_x");
    expect(memberAtPort("inner_comp", "OUTPUT_CIM_inner_y_RESULT", "OUTPUT_CIM_", byId, nodes)).toBe("inner_y");
    expect(memberAtPort("outer_a", "RESULT", "OUTPUT_CIM_", byId, nodes)).toBe("outer_a");
    // PsyNeuLink names a port of a frame within a frame after the inner one's.
    const deep: Node[] = [
      { id: "mid", type: "compositionNode", position: { x: 0, y: 0 }, data: {} },
      { id: "inner", type: "compositionNode", position: { x: 0, y: 0 }, data: {}, parentId: "mid" },
      { ...mech("x"), parentId: "inner" },
    ];
    const deepById = new Map(deep.map((n) => [n.id, n]));
    expect(memberAtPort("mid", "INPUT_CIM_inner_INPUT_CIM_x_InputPort-0", "INPUT_CIM_", deepById, deep)).toBe("x");
  });

  it("draws them along show_graph's course, to and from the member", async () => {
    const gv = await Graphviz.load();
    const placement = placementFromGraphviz(JSON.parse(gv.layout(DOT, "json", "dot")), graphSignature(nodes));
    const { nodes: laid, curves } = applyShowGraphPlacementWithCurves(nodes, edges, placement)!;
    expect(Object.keys(curves).sort()).toEqual(["in", "inner", "out"]);
    expect(curves.in.ends).toEqual(["outer_a", "inner_x"]);
    expect(curves.out.ends).toEqual(["inner_y", "outer_b"]);

    // The course ends on inner_x's box, inside the frame, not at the frame's edge.
    const frame = laid.find((n) => n.id === "inner_comp")!;
    const x = laid.find((n) => n.id === "inner_x")!;
    const xAbs = { x: frame.position.x + x.position.x, y: frame.position.y + x.position.y };
    const end = curves.in.points[curves.in.points.length - 1];
    expect(end.x).toBeGreaterThanOrEqual(xAbs.x - 1);
    expect(end.x).toBeLessThanOrEqual(xAbs.x + 190 + 1);
    expect(end.y).toBeGreaterThanOrEqual(xAbs.y - 1);
    expect(end.y).toBeLessThanOrEqual(xAbs.y + 70 + 1);

    // It holds while the member stays put, and lets go once it moves.
    const at = (p: { x: number; y: number }) => p;
    const pos = (id: string) => (id === "inner_x" ? xAbs : undefined);
    const fPos = { x: frame.position.x, y: frame.position.y };
    const aPos = at(laid.find((n) => n.id === "outer_a")!.position);
    expect(curveFits(curves.in, aPos, fPos, pos)).toBe(true);
    expect(curveFits(curves.in, aPos, fPos, () => ({ x: xAbs.x + 50, y: xAbs.y }))).toBe(false);
  });
});
