/**
 * Every node is drawn in show_graph's shape, at show_graph's proportions (#385).
 *
 * show_graph is the gold standard for how a node looks: its role colours
 * (backend/tests/test_show_graph_palette.py) and its shape. This opens every
 * reference model in every view it has (each composition, flattened, PyTorch)
 * and with CIMs shown, asks show_graph for its own picture of the model, and
 * checks each node the canvas draws:
 *   - its shape kind is the one show_graph's Graphviz `shape` names (oval,
 *     circle, double circle, octagon, double octagon, box), double outlines
 *     included;
 *   - its width over height is within 5% of show_graph's.
 * Sizes differ (PsyNeuView's text is bigger); proportions mustn't.
 *
 * On a mismatch it attaches, to the test's results, a sheet with each
 * mismatched node beside show_graph's drawing of it, and a table of them
 * (model, view, node, expected shape and ratio, actual), then fails.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page, TestInfo } from "@playwright/test";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { writeFileSync } from "fs";
import path from "path";
import { placementFromGraphviz, type ShowGraphPlacement } from "../src/utils/showGraphLayout";
import { measureShapes, ASPECT_TOLERANCE, type ShapeMismatch } from "../src/utils/layoutAgreement";
import { shapeFromShowGraph } from "../src/utils/nodeShape";
import {
  BACKEND_DIR,
  REFERENCE_MODELS,
  drawnShapes,
  enterView,
  openModel,
  toggleOption,
  views,
} from "./showGraphViews";

interface Found extends ShapeMismatch {
  model: string;
  view: string;
  /** PsyNeuView's node, as drawn. */
  canvasPng: Buffer;
  /** show_graph's description the node was compared with. */
  dot: string;
}

/** The outermost composition, by the page's rule (modelStore): the first that isn't a node of another. */
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

/**
 * show_graph's picture of the model, laid out by the same Graphviz the page
 * uses: the plain one, and for nodes it draws only with learning shown
 * (TARGET, prediction error), the one with learning shown.
 */
async function showGraphNodes(
  page: Page,
  gv: Graphviz,
  file: string,
  composition: string,
  cims: boolean,
): Promise<{ nodes: ShowGraphPlacement["nodes"]; dotOf: Map<string, string> }> {
  const nodes: ShowGraphPlacement["nodes"] = new Map();
  const dotOf = new Map<string, string>();
  for (const learning of [false, true]) {
    const resp = await page.request.post("/api/model/show-graph", {
      data: {
        file_path: file,
        composition_name: composition,
        options: { show_controller: true, show_learning: learning, show_cim: cims, show_nested: "nested" },
        format: "dot",
      },
    });
    if (!resp.ok()) continue;
    const { dot } = (await resp.json()) as { dot?: string };
    if (!dot) continue;
    const placed = placementFromGraphviz(JSON.parse(gv.layout(dot, "json", "dot")), "");
    for (const [name, n] of placed.nodes) {
      // A node a picture only names in an edge (with CIMs shown, a learning
      // TARGET the input CIM feeds, though learning isn't shown) takes the
      // graph's default shape, a record; the picture that draws the node
      // gives its real one.
      const had = nodes.get(name);
      if (had && had.shape !== "record") continue;
      nodes.set(name, n);
      dotOf.set(name, dot);
    }
  }
  return { nodes, dotOf };
}

const ratio = (x: number) => x.toFixed(2);

function table(found: Found[]): string {
  return [
    "| Model | View | Node | Expected (show_graph) | Actual (PsyNeuView) |",
    "|---|---|---|---|---|",
    ...found.map(
      (f) =>
        `| ${f.model} | ${f.view} | ${f.node} | ${f.expected.shape}, ${ratio(f.expected.aspect)} | ` +
        `${f.actual.shape}, ${ratio(f.actual.aspect)} |`,
    ),
  ].join("\n");
}

/** A sheet of each mismatched node beside show_graph's drawing of it, attached to the results. */
async function attachSheet(page: Page, gv: Graphviz, found: Found[], testInfo: TestInfo) {
  const sheet = await page.context().newPage();
  const rows: string[] = [];
  for (const f of found) {
    // show_graph's node, cut from its own picture.
    await sheet.setContent(`<!doctype html><body style="margin:0;background:#fff">${gv.layout(f.dot, "svg", "dot")}</body>`);
    const shot = await sheet
      .locator("g.node")
      .filter({ has: sheet.locator("title", { hasText: new RegExp(`^${f.node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) })
      .first()
      .screenshot()
      .catch(() => null);
    // Both at one height, so the shapes compare at a glance (the canvas may
    // be zoomed far out).
    const img = (b: Buffer | null) =>
      b ? `<img style="height:90px;width:auto" src="data:image/png;base64,${b.toString("base64")}">` : "(not found)";
    rows.push(
      `<tr><td>${f.model}<br>${f.view}<br><b>${f.node}</b></td>` +
        `<td>${img(f.canvasPng)}<br>${f.actual.shape}, ${ratio(f.actual.aspect)}</td>` +
        `<td>${img(shot)}<br>${f.expected.shape}, ${ratio(f.expected.aspect)}</td></tr>`,
    );
  }
  await sheet.setViewportSize({ width: 1400, height: 900 });
  await sheet.setContent(`<!doctype html><body style="margin:0;padding:16px;font:14px system-ui;background:#fff;color:#222">
    <h3>Node shapes not show_graph's (kind, or width/height beyond ${ASPECT_TOLERANCE * 100}%)</h3>
    <table cellpadding="8" border="1" style="border-collapse:collapse">
      <tr><th>Where</th><th>PsyNeuView</th><th>show_graph</th></tr>${rows.join("")}
    </table></body>`);
  // Written beside the test's other results (test-results/, uploaded by CI)
  // as well as attached to the report.
  const png = testInfo.outputPath("shape-mismatches.png");
  await sheet.screenshot({ path: png, fullPage: true });
  await testInfo.attach("shape-mismatches.png", { path: png, contentType: "image/png" });
  await sheet.close();
}

test("every reference model, every view: each node has show_graph's shape and proportions", { tag: "@ci" }, async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await closePalette(page);
  const gv = await Graphviz.load();

  let lastModel: Parameters<typeof outermost>[0] = {};
  page.on("response", (r) => {
    if (r.url().includes("/api/model/load") && r.ok()) {
      r.json().then((b) => (lastModel = b.model ?? {})).catch(() => {});
    }
  });

  const found: Found[] = [];
  const measured: { model: string; view: string; nodes: number; kinds: string[] }[] = [];
  for (const model of REFERENCE_MODELS) {
    const file = path.join(BACKEND_DIR, model);
    await openModel(page, model);
    const name = path.basename(model);
    const composition = outermost(lastModel);
    expect(composition, `${name}: its outermost composition`).toBeTruthy();
    const pictures = new Map<boolean, Awaited<ReturnType<typeof showGraphNodes>>>();
    const picture = async (cims: boolean) => {
      if (!pictures.has(cims)) pictures.set(cims, await showGraphNodes(page, gv, file, composition!, cims));
      return pictures.get(cims)!;
    };

    const check = async (view: string, cims: boolean) => {
      const drawn = await drawnShapes(page);
      const { nodes, dotOf } = await picture(cims);
      const score = measureShapes(drawn, nodes, shapeFromShowGraph);
      measured.push({
        model: name,
        view,
        nodes: score.nodes,
        kinds: [...new Set([...drawn.values()].map((d) => d.shape))],
      });
      for (const m of score.mismatches) {
        const canvasPng = await page
          .getByTestId("graph-canvas")
          .locator(`.react-flow__node-mechanismNode[data-id=${JSON.stringify(m.node)}]`)
          .first()
          .screenshot();
        found.push({ ...m, model: name, view, canvasPng, dot: dotOf.get(m.node) ?? "" });
      }
    };

    const all = await views(page);
    for (const [i, view] of all.entries()) {
      await enterView(page, view);
      await check(view.label, false);
      if (i > 0) continue;
      // With CIMs shown, on the model's first view.
      await toggleOption(page, "CIMs");
      await check(`${view.label} · CIMs shown`, true);
      await toggleOption(page, "CIMs");
    }
  }

  for (const m of measured) console.log(`${m.model} — ${m.view}: ${m.nodes} nodes compared (${m.kinds.join(", ")})`);
  // Every view compared something, and show_graph's circles were among them.
  for (const m of measured) expect(m.nodes, `${m.model} — ${m.view}: nodes compared`).toBeGreaterThan(0);
  expect(measured.some((m) => m.kinds.includes("doublecircle")), "a double circle was checked").toBe(true);
  expect(measured.some((m) => m.kinds.includes("octagon")), "an octagon was checked").toBe(true);

  if (found.length) {
    const md = testInfo.outputPath("shape-mismatches.md");
    writeFileSync(md, `${table(found)}\n`);
    await testInfo.attach("shape-mismatches.md", { path: md, contentType: "text/markdown" });
    await attachSheet(page, gv, found, testInfo);
  }
  expect(found.length, `nodes not in show_graph's shape:\n${table(found)}`).toBe(0);
});
