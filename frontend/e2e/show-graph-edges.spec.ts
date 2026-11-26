/**
 * Colours, projections, self-loops and line weight match show_graph (#425).
 *
 * show_graph is the gold standard for how a model looks (#306); its node
 * shapes have their own check (show-graph-shapes.spec.ts, #385). This one
 * opens every reference model, and Gilzenrat from PsyNeuLink's Library, in
 * every view it has but the PyTorch one, asks show_graph for its own description of the model,
 * and checks the canvas against it:
 *   - each node's outline colour is show_graph's (a control mechanism node
 *     such as Gilzenrat's LC is show_graph's control blue, X11 values);
 *   - each projection ends as show_graph's does (a box for a control
 *     projection, an arrow otherwise), is solid where show_graph's is, and is
 *     in show_graph's colour, exactly (X11 values);
 *   - each self-loop show_graph draws (a node's projection to itself) is on
 *     the canvas, leaving and coming back at two different points, outside the
 *     node, and selectable by a click on the loop;
 *   - an ordinary line's weight against an input or output node's outline is
 *     show_graph's (1 pt against 3 pt), within LINE_WEIGHT_TOLERANCE.
 *
 * On a mismatch it attaches a table of them (model, view, what, expected,
 * actual) to the test's results, then fails.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import { writeFileSync } from "fs";
import path from "path";
import { BACKEND_DIR, REFERENCE_MODELS, enterView, openModel, views } from "./showGraphViews";

/** show_graph's colour names, by their X11 values (as styles/showGraphColours.test.ts). */
const X11: Record<string, string> = {
  green: "#00ff00", red: "#ff0000", blue: "#0000ff", purple: "#a020f0",
  orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a", black: "#000000",
};

/** How far an ordinary line's weight over an emphasised outline may be from show_graph's. */
const LINE_WEIGHT_TOLERANCE = 0.08;

interface DotNode { color?: string; penwidth?: number }
interface DotEdge { sender: string; receiver: string; arrowhead: string; color: string; style: string; penwidth: number }

const unquote = (t: string) => (t.startsWith('"') ? t.slice(1, -1).replace(/\\(.)/g, "$1") : t);
const NAME = String.raw`(?:"(?:[^"\\]|\\.)*"|[A-Za-z_][\w.]*)`;
const NODE_RE = new RegExp(String.raw`^\s*(${NAME})\s*\[(.*)\]\s*;?\s*$`);
const EDGE_RE = new RegExp(String.raw`^\s*(${NAME})(?::${NAME})*\s*->\s*(${NAME})(?::${NAME})*\s*\[(.*)\]\s*;?\s*$`);
const attrsOf = (text: string) =>
  Object.fromEntries([...text.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|[^\s\]]+)/g)].map((m) => [m[1], unquote(m[2])]));

/** show_graph's nodes and edges, from its Graphviz description. */
function parseDot(dot: string): { nodes: Map<string, DotNode>; edges: DotEdge[] } {
  const nodes = new Map<string, DotNode>();
  const edges: DotEdge[] = [];
  for (const line of dot.split("\n")) {
    const e = EDGE_RE.exec(line);
    if (e) {
      const a = attrsOf(e[3]);
      if (a.style === "invis") continue;
      edges.push({
        sender: unquote(e[1]), receiver: unquote(e[2]),
        arrowhead: a.arrowhead ?? "normal", color: a.color ?? "black", style: a.style ?? "solid",
        penwidth: Number(a.penwidth ?? 1),
      });
      continue;
    }
    const n = NODE_RE.exec(line);
    if (!n) continue;
    const name = unquote(n[1]);
    if (["node", "edge", "graph"].includes(name)) continue;
    const a = attrsOf(n[2]);
    nodes.set(name, { color: a.color, penwidth: a.penwidth ? Number(a.penwidth) : undefined });
  }
  return { nodes, edges };
}

const arrowKind = (a: string) => (["box", "obox", "square"].includes(a) ? "box" : a === "none" ? "none" : "normal");
const lineKind = (s: string) => (s.includes("dashed") ? "dashed" : s.includes("dotted") ? "dotted" : "solid");

interface DrawnNode { color: string; width: number }
interface DrawnEdge {
  ends: [string, string];
  arrowhead: string;
  line: string;
  stroke: string;
  width: number;
  selfLoop: boolean;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** The canvas as drawn: each mechanism node's outline, each projection. Colours as #rrggbb. */
async function drawn(page: Page): Promise<{ nodes: Map<string, DrawnNode>; edges: DrawnEdge[] }> {
  const out = await page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const hex = (css: string) => {
      probe.style.color = "";
      probe.style.color = css;
      const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) ?? [];
      return "#" + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
    };
    const canvas = document.querySelector('[data-testid="graph-canvas"]')!;
    const nodes: [string, { color: string; width: number }][] = [];
    for (const el of Array.from(canvas.querySelectorAll<HTMLElement>(".react-flow__node-mechanismNode"))) {
      const body = el.querySelector<HTMLElement>('[data-testid="mechanism-node-body"]');
      if (!body) continue;
      // The outline as drawn: an octagon's or a circle's in its SVG, an
      // oval's as the box's border.
      const outer = body.querySelector<SVGElement>('[data-testid="node-shape-outline"] [data-outline="outer"]');
      const cs = getComputedStyle(outer ?? body);
      nodes.push([el.getAttribute("data-id") ?? "", {
        color: hex(outer ? cs.stroke : cs.borderTopColor),
        width: parseFloat(outer ? cs.strokeWidth : cs.borderTopWidth),
      }]);
    }
    const edges = Array.from(canvas.querySelectorAll<SVGPathElement>(".react-flow__edge path.react-flow__edge-path[data-ends]")).map((p) => {
      const g = p.closest(".react-flow__edge")!;
      const head = g.querySelector<SVGPolygonElement>('[data-testid="edge-arrowhead"]');
      const cs = getComputedStyle(p);
      const len = p.getTotalLength();
      const ctm = p.getScreenCTM()!;
      const at = (l: number) => {
        const q = p.getPointAtLength(l);
        return { x: ctm.a * q.x + ctm.c * q.y + ctm.e, y: ctm.b * q.x + ctm.d * q.y + ctm.f };
      };
      // What the line ends in and how it is dashed, as drawn: a box has four
      // corners, an arrow three.
      const corners = head ? head.points.numberOfItems : 0;
      const dash = cs.strokeDasharray;
      const first = parseFloat(dash);
      return {
        ends: (p.getAttribute("data-ends") ?? "").split("\u0000") as [string, string],
        arrowhead: corners === 4 ? "box" : corners === 3 ? "normal" : "none",
        line: dash === "none" || !first ? "solid" : first <= 2 ? "dotted" : "dashed",
        stroke: hex(cs.stroke),
        width: parseFloat(cs.strokeWidth),
        // Its two ends are the same node.
        selfLoop: (p.getAttribute("data-ends") ?? "").split("\u0000").every((n, _i, all) => n === all[0]),
        start: at(0),
        end: at(len),
      };
    });
    probe.remove();
    return { nodes, edges };
  });
  return { nodes: new Map(out.nodes), edges: out.edges };
}

/** The outermost composition, by the page's rule (modelStore). */
function outermost(model: { compositions?: { varName?: string; nodes?: { kind?: string; varName?: string; name?: string }[] }[] }): string | null {
  const clean = (n: string) => n.replace(/-\d+$/, "");
  const nested = new Set<string>();
  for (const c of model.compositions ?? []) {
    for (const n of c.nodes ?? []) {
      if (n.kind !== "composition") continue;
      const name = n.varName || n.name || "";
      nested.add(name);
      nested.add(clean(name));
    }
  }
  const names = (model.compositions ?? []).map((c) => c.varName).filter((n): n is string => !!n);
  return names.find((n) => !nested.has(n) && !nested.has(clean(n))) ?? names[0] ?? null;
}

interface Mismatch { model: string; view: string; what: string; expected: string; actual: string }

function table(found: Mismatch[]): string {
  return [
    "| Model | View | What | Expected (show_graph) | Actual (PsyNeuView) |",
    "|---|---|---|---|---|",
    ...found.map((f) => `| ${f.model} | ${f.view} | ${f.what} | ${f.expected} | ${f.actual} |`),
  ].join("\n");
}

test("every reference model and Library Gilzenrat, every view: colours, projections, self-loops and line weight are show_graph's", { tag: "@ci" }, async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await closePalette(page);

  // Gilzenrat as PsyNeuLink's Library has it, beside the bundled reference models.
  const library = (await (await page.request.get("/api/library-models")).json()) as { models: { name: string; path: string }[] };
  const gilzenrat = library.models.find((m) => m.name.toLowerCase() === "gilzenratmodel");
  expect(gilzenrat, "the Library lists GilzenratModel").toBeTruthy();
  const models = [...REFERENCE_MODELS.map((m) => ({ open: m, file: path.join(BACKEND_DIR, m), name: path.basename(m) })),
    { open: gilzenrat!.path, file: gilzenrat!.path, name: `Library ${path.basename(gilzenrat!.path)}` }];

  let lastModel: Parameters<typeof outermost>[0] = {};
  page.on("response", (r) => {
    if (r.url().includes("/api/model/load") && r.ok()) r.json().then((b) => (lastModel = b.model ?? {})).catch(() => {});
  });

  const found: Mismatch[] = [];
  const seen = { controlNodes: 0, boxEnds: 0, selfLoops: 0, weights: 0, edges: 0 };
  let loopClicked = false;

  for (const model of models) {
    await openModel(page, model.open);
    const composition = outermost(lastModel);
    expect(composition, `${model.name}: its outermost composition`).toBeTruthy();
    const resp = await page.request.post("/api/model/show-graph", {
      data: {
        file_path: model.file,
        composition_name: composition,
        options: { show_controller: true, show_learning: false, show_cim: false, show_nested: "nested" },
        format: "dot",
      },
    });
    expect(resp.ok(), `${model.name}: show_graph's description`).toBe(true);
    const sg = parseDot(((await resp.json()) as { dot?: string }).dot ?? "");

    for (const view of await views(page)) {
      // The PyTorch view draws what PyTorch runs, a different picture from
      // show_graph's plain one (#230), so there is nothing here to hold it to.
      if (/pytorch/i.test(view.label)) continue;
      await enterView(page, view);
      const where = { model: model.name, view: view.label };
      const canvas = await drawn(page);

      // Node colours: show_graph's, exactly (X11).
      for (const [name, n] of canvas.nodes) {
        const want = sg.nodes.get(name)?.color;
        if (!want || !X11[want]) continue;
        if (want === "blue") seen.controlNodes++;
        if (n.color !== X11[want]) found.push({ ...where, what: `node ${name}: colour`, expected: `${want} ${X11[want]}`, actual: n.color });
      }

      // Projections: each canvas edge between two of show_graph's nodes is
      // drawn as one of show_graph's edges between them.
      for (const e of canvas.edges) {
        const [s, t] = e.ends;
        if (!sg.nodes.has(s) || !sg.nodes.has(t)) continue;
        const theirs = sg.edges.filter((x) => x.sender === s && x.receiver === t);
        if (!theirs.length) continue;
        seen.edges++;
        const look = (x: DotEdge) => ({
          arrowhead: arrowKind(x.arrowhead),
          line: lineKind(x.style),
          stroke: X11[x.color] ?? x.color,
        });
        const mine = { arrowhead: e.arrowhead, line: e.line, stroke: e.stroke };
        const ok = theirs.some((x) => JSON.stringify(look(x)) === JSON.stringify(mine));
        if (!ok) {
          found.push({ ...where, what: `projection ${s} → ${t}`, expected: theirs.map((x) => JSON.stringify(look(x))).join(" or "), actual: JSON.stringify(mine) });
        }
        if (e.arrowhead === "box") seen.boxEnds++;
      }

      // Self-loops: every one show_graph draws, on a node the canvas draws.
      for (const x of sg.edges.filter((x) => x.sender === x.receiver)) {
        if (!canvas.nodes.has(x.sender)) continue;
        const loop = canvas.edges.find((e) => e.ends[0] === x.sender && e.ends[1] === x.sender);
        if (!loop) {
          found.push({ ...where, what: `self-loop on ${x.sender}`, expected: "drawn", actual: "missing" });
          continue;
        }
        seen.selfLoops++;
        const apart = Math.hypot(loop.start.x - loop.end.x, loop.start.y - loop.end.y);
        if (apart < 6) {
          found.push({ ...where, what: `self-loop on ${x.sender}`, expected: "a loop with two attachment points", actual: `ends ${apart.toFixed(1)} px apart` });
        }
      }

      // Line weight: an ordinary line against an emphasised (input or output) outline.
      const emphasised = [...sg.nodes].find(([name, n]) => (n.penwidth ?? 1) > 1 && canvas.nodes.has(name));
      const plain = canvas.edges.find((e) => e.arrowhead === "normal" && !e.selfLoop && e.stroke === X11.black);
      const sgPlain = sg.edges.find((x) => arrowKind(x.arrowhead) === "normal" && x.color === "black");
      if (emphasised && plain && sgPlain) {
        seen.weights++;
        const want = sgPlain.penwidth / emphasised[1].penwidth!;
        const got = plain.width / canvas.nodes.get(emphasised[0])!.width;
        if (Math.abs(got - want) > LINE_WEIGHT_TOLERANCE) {
          found.push({ ...where, what: `line weight / ${emphasised[0]}'s outline`, expected: want.toFixed(2), actual: `${got.toFixed(2)} (${plain.width} px / ${canvas.nodes.get(emphasised[0])!.width} px)` });
        }
      }

      // A self-loop is selectable: a click on the loop selects it.
      const loop = canvas.edges.find((e) => e.selfLoop);
      if (!loopClicked && model.name.startsWith("Library") && loop) {
        const ends = loop.ends.join("\u0000");
        const strokes = () =>
          page.locator(".react-flow__edge").evaluateAll((gs, ends) => gs.flatMap((g) => {
            const p = g.querySelector<SVGPathElement>("path.react-flow__edge-path[data-ends]");
            return p && p.getAttribute("data-ends") === ends ? [getComputedStyle(p).stroke] : [];
          }), ends);
        const before = await strokes();
        // The loop's farthest point, on its own (the visible line's) course.
        const apex = await page.locator(".react-flow__edge path.react-flow__edge-path[data-ends]").evaluateAll((ps, ends) => {
          const p = ps.find((q) => q.getAttribute("data-ends") === ends) as SVGPathElement;
          const q = p.getPointAtLength(p.getTotalLength() / 2);
          const m = p.getScreenCTM()!;
          return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
        }, ends);
        await page.mouse.click(apex.x, apex.y);
        const after = await strokes();
        if (JSON.stringify(after) === JSON.stringify(before)) {
          found.push({ ...where, what: `a click on ${loop.ends[0]}'s self-loop`, expected: "selects it", actual: `stroke stays ${before.join(", ")}` });
        }
        loopClicked = true;
        await page.keyboard.press("Escape");
      }
    }
  }

  console.log(`checked: ${JSON.stringify(seen)}, a self-loop clicked: ${loopClicked}`);
  if (found.length) {
    const md = testInfo.outputPath("show-graph-edge-mismatches.md");
    writeFileSync(md, `${table(found)}\n`);
    await testInfo.attach("show-graph-edge-mismatches.md", { path: md, contentType: "text/markdown" });
    console.log(table(found));
  }
  expect(found.length, `not as show_graph draws it:\n${table(found)}`).toBe(0);
  // The checks reached what they are for.
  expect(seen.controlNodes, "a control node's colour was checked").toBeGreaterThan(0);
  expect(seen.boxEnds, "a box-ended control projection was checked").toBeGreaterThan(0);
  expect(seen.selfLoops, "a self-loop was checked").toBeGreaterThan(0);
  expect(seen.weights, "a line weight was checked").toBeGreaterThan(0);
  expect(loopClicked, "a self-loop was clicked").toBe(true);
});
