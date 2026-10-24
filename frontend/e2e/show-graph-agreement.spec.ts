/**
 * Like show_graph agrees with show_graph, in every view (#34).
 *
 * Opens each reference model in each view the view menu offers (flattened,
 * every composition, PyTorch), lays it out Like show_graph, and compares the
 * canvas with show_graph's own picture: the description the app fetched,
 * laid out here by the same Graphviz. It scores
 *   - nodes show_graph draws (matched / total),
 *   - rows: pairs of nodes whose above / level / below relation agrees,
 *   - order: pairs on one show_graph row whose left/right order agrees,
 *   - edges drawn along show_graph's course,
 *   - overlapping boxes, and anything cut off after Fit.
 *
 * The full batch writes `agreement.json`, `agreement.md` and numbered
 * side-by-side sheets (canvas left, show_graph right) to
 * `test-results/show-graph-agreement/` — run it before a release and look at
 * the sheets. The @ci test holds a few representative models to thresholds.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page, Response } from "@playwright/test";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { placementFromGraphviz } from "../src/utils/showGraphLayout";
import { measureAgreement, share, type Agreement, type Box } from "../src/utils/layoutAgreement";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", "..", "backend", "reference_models");
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "show-graph-agreement");

const ALL_MODELS = [
  "Botvinick_conflict_monitoring_model.py",
  "Cohen_Huston1994_horse_race.py",
  "Cohen_Huston1994.py",
  "Giallanza2024_ego_study2.py",
  "GilzenratModel.py",
  "Kalanthroff_PCTC_2018.py",
  "MontagueDayanSejnowski96.py",
  "Nieuwenhuis2005Model.py",
  "stroop_reference_basic.py",
  "stroop_reference_with_lc.py",
];

interface ViewResult extends Omit<Agreement, "overlaps"> {
  model: string;
  view: string;
  overlaps: string[];
  /** Edges show_graph draws between canvas nodes, and how many follow its course. */
  courses: { drawn: number; showGraph: number };
  cutOff: string[];
  /** The view opened in Custom, on positions saved for it. */
  savedLayout: boolean;
  /** Why there is nothing to compare, when there isn't. */
  error?: string;
}

type Captured = { dot: string };

/** Every show_graph description the page fetches, as it arrives. */
function captureShowGraph(page: Page): { all: Captured[]; settle: () => Promise<void> } {
  const all: Captured[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (r: Response) => {
    if (!r.url().includes("/api/model/show-graph") || r.request().method() !== "POST" || !r.ok()) return;
    pending.push(
      r
        .json()
        .then((b: { dot?: string }) => {
          if (b.dot) all.push({ dot: b.dot });
        })
        .catch(() => {}),
    );
  });
  return { all, settle: () => Promise.all(pending).then(() => {}) };
}

const layoutSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Like show_graph" }) }).first();
const viewSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();

async function openModel(page: Page, file: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(MODELS_DIR, file));
  await prompt.press("Enter");
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  // The view menu appears once the load has finished drawing.
  await settledBoxes(page);
}

/** The view menu's choices, in order, or just the one view when there is no menu. */
async function views(page: Page): Promise<{ value: string; label: string }[]> {
  const select = viewSelect(page);
  if (!(await select.isVisible().catch(() => false))) return [{ value: "", label: "the model" }];
  return select.locator("option").evaluateAll((os) =>
    os.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? "").trim() })),
  );
}

/** Canvas node boxes, read until two reads a moment apart agree. */
async function settledBoxes(page: Page): Promise<Map<string, Box>> {
  const read = () =>
    page
      .getByTestId("graph-canvas")
      .locator(".react-flow__node-mechanismNode")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return [el.getAttribute("data-id") ?? "", { x: r.left, y: r.top, w: r.width, h: r.height }] as const;
        }),
      );
  let last = JSON.stringify(await read());
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(400);
    const now = JSON.stringify(await read());
    if (now === last) break;
    last = now;
  }
  return new Map(JSON.parse(last));
}

async function cutOffAfterFit(page: Page): Promise<string[]> {
  const canvas = page.getByTestId("graph-canvas");
  const pane = (await canvas.locator(".react-flow").boundingBox())!;
  const drawn = await canvas.locator(".react-flow__node, .react-flow__edge-path").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.closest("[data-id]")?.getAttribute("data-id") ?? "", x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    }),
  );
  return drawn
    .filter((r) => r.x0 < pane.x - 1 || r.y0 < pane.y - 1 || r.x1 > pane.x + pane.width + 1 || r.y1 > pane.y + pane.height + 1)
    .map((r) => r.id);
}

async function measureView(
  page: Page,
  gv: Graphviz,
  captured: ReturnType<typeof captureShowGraph>,
  model: string,
  view: { value: string; label: string },
  since: number,
): Promise<{ result: ViewResult; canvasPng: Buffer; svg: string }> {
  const from = captured.all.length;
  const select = viewSelect(page);
  if (view.value && (await select.inputValue()) !== view.value) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60000 }),
      select.selectOption(view.value),
    ]);
  }
  await settledBoxes(page);
  // A view with saved positions opens in Custom; what's measured here is the
  // automatic layout, so switch to it (nothing is saved).
  const custom = page.getByRole("button", { name: /^Layout: Custom$/ });
  const savedLayout = await custom.isVisible().catch(() => false);
  if (savedLayout) {
    // Switching mode reloads the view.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60000 }),
      custom.click(),
    ]);
    await settledBoxes(page);
  }
  const layout = layoutSelect(page);
  if ((await layout.inputValue()) !== "showgraph") await layout.selectOption("showgraph");
  // show_graph's description arrives, then the relayout lands. A view that
  // draws the same graph as the last one (the PyTorch view, often) reuses the
  // layout the app already has, and fetches nothing.
  await expect
    .poll(() => captured.all.length, { timeout: 15000 })
    .toBeGreaterThan(from)
    .catch(() => {});
  await page.waitForTimeout(1000);
  await captured.settle();
  await settledBoxes(page);
  await page.getByTestId("graph-canvas").locator(".react-flow__controls-fitview").click();
  const drawn = await settledBoxes(page);

  // The app keeps whichever description drew more of its nodes (it asks again
  // with learning shown when show_graph missed some); so does this, among
  // those fetched since the model opened, the latest winning a tie.
  let best: { placement: ReturnType<typeof placementFromGraphviz>; dot: string } | null = null;
  for (const { dot } of captured.all.slice(since).reverse()) {
    const placement = placementFromGraphviz(JSON.parse(gv.layout(dot, "json", "dot")), "");
    const hits = [...drawn.keys()].filter((n) => placement.nodes.has(n)).length;
    const bestHits = best ? [...drawn.keys()].filter((n) => best!.placement.nodes.has(n)).length : -1;
    if (hits > bestHits) best = { placement, dot };
  }
  const reference = best?.placement.nodes ?? new Map();
  const agreement = measureAgreement(drawn, reference);
  const names = new Set(drawn.keys());
  const showGraphEdges = (best?.placement.edges ?? []).filter((e) => names.has(e.tail) && names.has(e.head)).length;
  const curved = await page.getByTestId("graph-canvas").locator(".react-flow__edge path.pnv-edge-showgraph").count();

  const result: ViewResult = {
    model,
    view: view.label,
    ...agreement,
    overlaps: agreement.overlaps.map(([a, b]) => `${a} / ${b}`),
    courses: { drawn: curved, showGraph: showGraphEdges },
    cutOff: await cutOffAfterFit(page),
    savedLayout,
    ...(best ? {} : { error: "no show_graph description fetched" }),
  };
  const canvasPng = await page.getByTestId("graph-canvas").locator(".react-flow").screenshot();
  const svg = best ? gv.layout(best.dot, "svg", "dot") : "<p>No show_graph description.</p>";
  return { result, canvasPng, svg };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function summaryLine(r: ViewResult): string {
  return (
    `nodes ${r.matched}/${r.nodes} · rows ${pct(share(r.rows))} · order ${pct(share(r.order))} · ` +
    `courses ${r.courses.drawn}/${r.courses.showGraph} · overlaps ${r.overlaps.length} · cut off ${r.cutOff.length}` +
    (r.savedLayout ? " · had a saved layout" : "") +
    (r.error ? ` · ${r.error}` : "")
  );
}

async function writeSheet(page: Page, n: number, r: ViewResult, canvasPng: Buffer, svg: string) {
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 2400, height: 900 });
  await sheet.setContent(`<!doctype html><html><body style="margin:0;font:14px system-ui;background:#fff;color:#222">
    <div style="padding:10px 16px;border-bottom:1px solid #ccc"><b>${n}. ${r.model} — ${r.view}</b><br>${summaryLine(r)}</div>
    <div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
      <div style="flex:1"><div>PsyNeuView, Like show_graph</div>
        <img style="max-width:100%;border:1px solid #ccc" src="data:image/png;base64,${canvasPng.toString("base64")}"></div>
      <div style="flex:1"><div>show_graph</div><div style="border:1px solid #ccc">${svg.replace(/<svg width="[^"]*" height="[^"]*"/, '<svg style="max-width:100%;height:auto"')}</div></div>
    </div></body></html>`);
  await sheet.screenshot({ path: path.join(OUT_DIR, `sheet-${String(n).padStart(2, "0")}.png`), fullPage: true });
  await sheet.close();
}

async function runBatch(page: Page, models: string[], sheets: boolean): Promise<ViewResult[]> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await closePalette(page);
  const gv = await Graphviz.load();
  const captured = captureShowGraph(page);
  const results: ViewResult[] = [];
  for (const model of models) {
    const since = captured.all.length;
    await openModel(page, model);
    for (const view of await views(page)) {
      const { result, canvasPng, svg } = await measureView(page, gv, captured, model, view, since);
      results.push(result);
      if (sheets) await writeSheet(page, results.length, result, canvasPng, svg);
    }
  }
  return results;
}

function writeReport(results: ViewResult[]) {
  writeFileSync(path.join(OUT_DIR, "agreement.json"), JSON.stringify(results, null, 2));
  const rows = results.map(
    (r, i) =>
      `| ${i + 1} | ${r.model.replace(/\.py$/, "")} | ${r.view} | ${r.matched}/${r.nodes} | ${pct(share(r.rows))} | ` +
      `${pct(share(r.order))} | ${r.courses.drawn}/${r.courses.showGraph} | ${r.overlaps.length} | ${r.cutOff.length} |`,
  );
  writeFileSync(
    path.join(OUT_DIR, "agreement.md"),
    [
      "| # | Model | View | Nodes | Rows | Order | Courses | Overlaps | Cut off |",
      "|---|---|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n"),
  );
}

// The whole matrix, with review sheets: before a release.
test("every reference model, every view: agreement with show_graph", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT_DIR, { recursive: true });
  // PNV_AGREEMENT_MODELS=a.py,b.py narrows the batch while working on a gap.
  const only = process.env.PNV_AGREEMENT_MODELS?.split(",").filter(Boolean);
  const results = await runBatch(page, only?.length ? only : ALL_MODELS, true);
  writeReport(results);
  for (const r of results) console.log(`${r.model} — ${r.view}: ${summaryLine(r)}`);
});
