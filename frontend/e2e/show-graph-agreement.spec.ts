/**
 * Like show_graph agrees with show_graph, in every view (#34).
 *
 * Opens each bundled model (reference models and demos) in each view the
 * view menu offers (flattened, every composition, PyTorch), and in the full
 * batch also with its compositions folded and with each of show_graph's
 * options (Controller, Learning, CIMs) flipped; lays it out Like show_graph, and compares the
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
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "show-graph-agreement");

// Every bundled model: the reference models and the demos (29), relative to
// backend/. Results name a model by its file name.
const REFERENCE_MODELS = [
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
].map((f) => `reference_models/${f}`);
const DEMOS = [
  "autodiff_feedforward.py",
  "bistable_attractor.py",
  "conflict_monitoring.py",
  "ego_coffee_shop.py",
  "episodic_memory.py",
  "feedforward_network.py",
  "hebbian_learning.py",
  "hopfield_network.py",
  "iscci_model.py",
  "logic_gate_network.py",
  "nested_compositions.py",
  "neural_network_with_ddm.py",
  "rumelhart_semantic_network.py",
  "scheduling_demo.py",
  "simple_stroop_learn.py",
  "simple_stroop.py",
  "stroop_basic.py",
  "td_learning.py",
  "vectors_and_matrices.py",
].map((f) => `demos/${f}`);
const ALL_MODELS = [...REFERENCE_MODELS, ...DEMOS];

interface ViewResult extends Omit<Agreement, "overlaps"> {
  model: string;
  view: string;
  overlaps: string[];
  /**
   * Edges show_graph draws between two different canvas nodes, and how many of
   * them the canvas draws along its course; the rest by name. Self-loops are
   * counted apart: PsyNeuView marks a recurrent node with a CYCLE badge
   * instead of drawing its loop.
   */
  courses: { drawn: number; showGraph: number; missing: string[]; selfLoops: number };
  cutOff: string[];
  /** A composition frame's buttons that something else sits on top of (#71). */
  covered: string[];
  /** The view opened in Custom, on positions saved for it. */
  savedLayout: boolean;
  /** Anything else found on the way, e.g. a control a node covers. */
  notes?: string[];
  /** Why there is nothing to compare, when there isn't. */
  error?: string;
}

type Captured = { dot: string };

/**
 * Every show_graph description the page fetches, as it arrives, and every
 * refusal (with its message), each tagged with how many descriptions had
 * arrived before it.
 */
function captureShowGraph(page: Page): {
  all: Captured[];
  refused: { at: number; detail: string }[];
  settle: () => Promise<void>;
} {
  const all: Captured[] = [];
  const refused: { at: number; detail: string }[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (r: Response) => {
    if (!r.url().includes("/api/model/show-graph") || r.request().method() !== "POST") return;
    pending.push(
      r
        .json()
        .then((b: { dot?: string; detail?: string }) => {
          if (r.ok() && b.dot) all.push({ dot: b.dot });
          else if (!r.ok()) refused.push({ at: all.length, detail: `${r.status()} ${b.detail ?? ""}`.trim() });
        })
        .catch(() => {}),
    );
  });
  return { all, refused, settle: () => Promise.all(pending).then(() => {}) };
}

const layoutSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Like show_graph" }) }).first();
const viewSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();

async function openModel(page: Page, model: string) {
  const file = path.basename(model);
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(BACKEND_DIR, model));
  // The previous model stays drawn until this one's load returns.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/model/load") && (r.request().postData() ?? "").includes(file),
      { timeout: 60000 },
    ),
    prompt.press("Enter"),
  ]);
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

const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60000 });

/** Switch to a view; returns whether it opened on saved positions. */
async function enterView(page: Page, view: { value: string; label: string }): Promise<boolean> {
  const select = viewSelect(page);
  if (view.value && (await select.inputValue()) !== view.value) {
    await Promise.all([loaded(page), select.selectOption(view.value)]);
  }
  await settledBoxes(page);
  // A view with saved positions opens in Custom; what's measured here is the
  // automatic layout, so switch to it (nothing is saved).
  const custom = page.getByRole("button", { name: /^Layout: Custom$/ });
  const savedLayout = await custom.isVisible().catch(() => false);
  if (savedLayout) {
    // Switching mode reloads the view.
    await Promise.all([loaded(page), custom.click()]);
    await settledBoxes(page);
  }
  return savedLayout;
}

/** Flip one of the graph's More ▸ show_graph options (Controller, Learning, CIMs). */
async function toggleOption(page: Page, label: string) {
  await page.getByTestId("graph-more-button").click();
  const item = page.getByTestId("graph-more-menu").getByRole("button").filter({ hasText: new RegExp(`^${label}`) });
  await Promise.all([loaded(page), item.click()]);
  await page.keyboard.press("Escape");
  await settledBoxes(page);
}

/**
 * Fold every open composition (`fold`), or open every folded one. Returns how
 * many it changed, and each button a node covered: a person couldn't press
 * it, so that is a finding, but it is pressed anyway to carry on measuring.
 */
async function setFolded(page: Page, fold: boolean): Promise<{ changed: number; covered: string[] }> {
  const name = fold ? /^Collapse composition / : /^Expand composition /;
  const covered: string[] = [];
  let changed = 0;
  // Folding an outer composition hides its inner ones' buttons; opening it
  // shows them again, still in the state they were left in.
  for (; changed < 12; changed++) {
    const button = page.getByTestId("graph-canvas").getByRole("button", { name }).first();
    if (!(await button.isVisible().catch(() => false))) break;
    const label = (await button.getAttribute("aria-label")) ?? "";
    const pressed = Promise.all([loaded(page), button.click({ timeout: 3000 })]);
    try {
      await pressed;
    } catch {
      // Where the click would land, what's on top?
      const onTop = await button.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el?.closest("[data-id]")?.getAttribute("data-id") ?? el?.tagName ?? "?";
      });
      covered.push(`${label} is covered by ${onTop}`);
      await Promise.all([loaded(page), button.dispatchEvent("click")]);
    }
    await settledBoxes(page);
  }
  return { changed, covered };
}

/**
 * Each composition frame button (Focus, Inset, Collapse, Expand) that a press
 * at its middle wouldn't reach, and what is on top of it (#71).
 */
async function coveredControls(page: Page): Promise<string[]> {
  return page
    .getByTestId("graph-canvas")
    .getByRole("button", { name: / composition / })
    .evaluateAll((buttons) =>
      buttons.flatMap((b) => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (el && b.contains(el)) return [];
        const onTop = el?.closest("[data-id]")?.getAttribute("data-id") ?? el?.tagName ?? "?";
        return [`${b.getAttribute("aria-label")} is covered by ${onTop}`];
      }),
    );
}

/** Lay the canvas out like show_graph as it stands, and score it. */
async function measureCurrent(
  page: Page,
  gv: Graphviz,
  captured: ReturnType<typeof captureShowGraph>,
  model: string,
  label: string,
  since: number,
  from: number,
  savedLayout: boolean,
): Promise<{ result: ViewResult; canvasPng: Buffer; svg: string }> {
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
  // A refusal since this view was entered: the app shows the Layered
  // stand-in, with a notice, so there is nothing of show_graph's to compare.
  const refusal = captured.refused.find((x) => x.at >= from);
  let best: { placement: ReturnType<typeof placementFromGraphviz>; dot: string } | null = null;
  for (const { dot } of refusal ? [] : captured.all.slice(since).reverse()) {
    const placement = placementFromGraphviz(JSON.parse(gv.layout(dot, "json", "dot")), "");
    const hits = [...drawn.keys()].filter((n) => placement.nodes.has(n)).length;
    const bestHits = best ? [...drawn.keys()].filter((n) => best!.placement.nodes.has(n)).length : -1;
    if (hits > bestHits) best = { placement, dot };
  }
  const reference = best?.placement.nodes ?? new Map();
  const agreement = measureAgreement(drawn, reference);
  const names = new Set(drawn.keys());
  const between = (best?.placement.edges ?? []).filter((e) => names.has(e.tail) && names.has(e.head));
  const selfLoops = between.filter((e) => e.tail === e.head).length;
  // Each edge drawn on show_graph's course names that edge's ends; for an
  // edge into an open frame, the member inside (#73).
  const curved = await page
    .getByTestId("graph-canvas")
    .locator("path.pnv-edge-showgraph")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-showgraph-ends") ?? ""));
  const unclaimed = [...curved];
  const missing: string[] = [];
  for (const e of between) {
    if (e.tail === e.head) continue;
    const i = unclaimed.indexOf(`${e.tail}\u0000${e.head}`);
    if (i >= 0) unclaimed.splice(i, 1);
    else missing.push(`${e.tail} → ${e.head}`);
  }

  const result: ViewResult = {
    model: path.basename(model),
    view: label,
    ...agreement,
    overlaps: agreement.overlaps.map(([a, b]) => `${a} / ${b}`),
    courses: { drawn: between.length - selfLoops - missing.length, showGraph: between.length - selfLoops, missing, selfLoops },
    cutOff: await cutOffAfterFit(page),
    covered: await coveredControls(page),
    savedLayout,
    ...(refusal ? { error: `show_graph refused: ${refusal.detail.slice(0, 200)}` } : {}),
    ...(!best && !refusal ? { error: "no show_graph description fetched" } : {}),
  };
  const canvasPng = await page.getByTestId("graph-canvas").locator(".react-flow").screenshot();
  const svg = best ? gv.layout(best.dot, "svg", "dot") : "<p>No show_graph description.</p>";
  return { result, canvasPng, svg };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function summaryLine(r: ViewResult): string {
  return (
    `nodes ${r.matched}/${r.nodes} · rows ${pct(share(r.rows))} · order ${pct(share(r.order))} · ` +
    `courses ${r.courses.drawn}/${r.courses.showGraph}` +
    (r.courses.selfLoops ? ` (+${r.courses.selfLoops} self-loops)` : "") +
    (r.courses.missing.length ? ` — not drawn: ${r.courses.missing.join(", ")}` : "") +
    ` · overlaps ${r.overlaps.length} · cut off ${r.cutOff.length}` +
    (r.covered.length ? ` · ${r.covered.join("; ")}` : "") +
    (r.savedLayout ? " · had a saved layout" : "") +
    (r.notes?.length ? ` · ${r.notes.join("; ")}` : "") +
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

const failed = (model: string, view: string, e: unknown): ViewResult => ({
  model: path.basename(model),
  view,
  nodes: 0,
  matched: 0,
  unmatched: [],
  rows: { agree: 0, pairs: 0 },
  order: { agree: 0, pairs: 0 },
  overlaps: [],
  courses: { drawn: 0, showGraph: 0, missing: [], selfLoops: 0 },
  cutOff: [],
  covered: [],
  savedLayout: false,
  error: String(e).split("\n")[0],
});

// show_graph's options, each measured flipped from its default on a model's
// first view, then flipped back.
const OPTIONS = [
  { label: "Controller", variant: "Controller hidden" },
  { label: "Learning", variant: "Learning shown" },
  { label: "CIMs", variant: "CIMs shown" },
];

/**
 * Measure each model in each view. With `variants`, also with its open
 * compositions folded, and with each show_graph option flipped.
 */
async function runBatch(
  page: Page,
  models: string[],
  { sheets, variants }: { sheets: boolean; variants: boolean },
): Promise<ViewResult[]> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await closePalette(page);
  const gv = await Graphviz.load();
  const captured = captureShowGraph(page);
  const results: ViewResult[] = [];
  const record = async (
    model: string,
    label: string,
    measure: () => Promise<{ result: ViewResult; canvasPng: Buffer; svg: string }>,
  ) => {
    try {
      const { result, canvasPng, svg } = await measure();
      results.push(result);
      if (sheets) await writeSheet(page, results.length, result, canvasPng, svg);
    } catch (e) {
      // One view that can't be measured shouldn't hide the rest.
      results.push(failed(model, label, e));
    }
  };
  for (const model of models) {
    const since = captured.all.length;
    try {
      await openModel(page, model);
    } catch (e) {
      results.push(failed(model, "opening", e));
      continue;
    }
    const all = await views(page);
    for (const [i, view] of all.entries()) {
      let savedLayout = false;
      const from = captured.all.length;
      try {
        savedLayout = await enterView(page, view);
      } catch (e) {
        results.push(failed(model, view.label, e));
        continue;
      }
      await record(model, view.label, () =>
        measureCurrent(page, gv, captured, model, view.label, since, from, savedLayout),
      );

      // A view that opens with compositions folded: open them too, so the
      // edges that cross a frame are measured (#73). They stay open.
      const opened = `${view.label} · compositions open`;
      try {
        const before = captured.all.length;
        const { changed, covered } = await setFolded(page, false);
        if (changed > 0) {
          await record(model, opened, async () => {
            const m = await measureCurrent(page, gv, captured, model, opened, since, before, false);
            if (covered.length) m.result.notes = [...(m.result.notes ?? []), ...covered];
            return m;
          });
        }
      } catch (e) {
        results.push(failed(model, opened, e));
      }
      if (!variants) continue;

      const folded = `${view.label} · compositions folded`;
      try {
        const before = captured.all.length;
        const { changed, covered } = await setFolded(page, true);
        if (changed > 0) {
          await record(model, folded, async () => {
            const m = await measureCurrent(page, gv, captured, model, folded, since, before, false);
            if (covered.length) m.result.notes = [...(m.result.notes ?? []), ...covered];
            return m;
          });
          await setFolded(page, false);
        }
      } catch (e) {
        results.push(failed(model, folded, e));
      }

      if (i > 0) continue;
      for (const option of OPTIONS) {
        const label = `${view.label} · ${option.variant}`;
        try {
          const before = captured.all.length;
          await toggleOption(page, option.label);
          await record(model, label, () =>
            measureCurrent(page, gv, captured, model, label, since, before, false),
          );
          await toggleOption(page, option.label);
        } catch (e) {
          results.push(failed(model, label, e));
        }
      }
    }
  }
  return results;
}

function writeReport(results: ViewResult[]) {
  writeFileSync(path.join(OUT_DIR, "agreement.json"), JSON.stringify(results, null, 2));
  const rows = results.map(
    (r, i) =>
      `| ${i + 1} | ${r.model.replace(/\.py$/, "")} | ${r.view} | ${r.matched}/${r.nodes} | ${pct(share(r.rows))} | ` +
      `${pct(share(r.order))} | ${r.courses.drawn}/${r.courses.showGraph} | ${r.courses.selfLoops} | ${r.overlaps.length} | ${r.cutOff.length} | ` +
      `${[...r.courses.missing.map((m) => `not drawn: ${m}`), ...r.covered, ...(r.savedLayout ? ["had a saved layout"] : []), ...(r.notes ?? []), ...(r.error ? [r.error] : [])].join("; ")} |`,
  );
  writeFileSync(
    path.join(OUT_DIR, "agreement.md"),
    [
      "| # | Model | View | Nodes | Rows | Order | Courses | Self-loops | Overlaps | Cut off | Notes |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n"),
  );
}

// The whole matrix, with review sheets: before a release.
test("every bundled model, every view: agreement with show_graph", async ({ page }) => {
  test.setTimeout(90 * 60_000);
  mkdirSync(OUT_DIR, { recursive: true });
  // PNV_AGREEMENT_MODELS=demos/a.py,reference_models/b.py narrows the batch
  // while working on a gap.
  const only = process.env.PNV_AGREEMENT_MODELS?.split(",").filter(Boolean);
  const results = await runBatch(page, only?.length ? only : ALL_MODELS, { sheets: true, variants: true });
  writeReport(results);
  for (const r of results) console.log(`${r.model} — ${r.view}: ${summaryLine(r)}`);
});

// Representative models, held to thresholds in CI: the basic Stroop, EGO in
// each of its views (nested, flattened, PyTorch), a learning model, and a
// composition open inside another, with edges crossing its frame (#73).
const REPRESENTATIVE = [
  ...["stroop_reference_basic.py", "Giallanza2024_ego_study2.py", "MontagueDayanSejnowski96.py"].map(
    (f) => `reference_models/${f}`,
  ),
  "demos/nested_compositions.py",
];

// Edges show_graph draws that the canvas doesn't yet, each with its issue.
// Listed exactly, so a fix shows up here as well as a new gap.
const KNOWN_MISSING: Record<string, string[]> = {
  // #66: the flattened graph leaves out COMBINED SCORES' second projection to
  // each field (to its MIN NORM INDEX port).
  "Giallanza2024_ego_study2.py — Flatten (all compositions)": [
    "COMBINED SCORES → STATE [FIELD_MEMORY]",
    "COMBINED SCORES → PREVIOUS STATE [FIELD_MEMORY]",
    "COMBINED SCORES → CONTEXT [FIELD_MEMORY]",
  ],
};
// The nested view with EM open draws the same projections.
for (const view of ["PyTorch view", "EGO · compositions open"]) {
  KNOWN_MISSING[`Giallanza2024_ego_study2.py — ${view}`] =
    KNOWN_MISSING["Giallanza2024_ego_study2.py — Flatten (all compositions)"];
}

test("representative models agree with show_graph in every view", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const results = await runBatch(page, REPRESENTATIVE, { sheets: false, variants: false });
  for (const r of results) console.log(`${r.model} — ${r.view}: ${summaryLine(r)}`);
  expect(results.length, "views measured").toBeGreaterThanOrEqual(REPRESENTATIVE.length + 2);
  for (const r of results) {
    const where = `${r.model} — ${r.view}`;
    expect(r.error, where).toBeUndefined();
    expect(r.unmatched, `${where}: nodes show_graph doesn't draw`).toEqual([]);
    expect(share(r.rows), `${where}: rows`).toBe(1);
    expect(share(r.order), `${where}: left-to-right order`).toBe(1);
    expect(r.overlaps, `${where}: overlapping boxes`).toEqual([]);
    expect(r.cutOff, `${where}: cut off after Fit`).toEqual([]);
    expect(r.covered, `${where}: frame buttons something sits on`).toEqual([]);
    expect(r.courses.missing, `${where}: show_graph edges not drawn on its course`).toEqual(KNOWN_MISSING[where] ?? []);
  }
});
