/**
 * Lines are drawn smooth (#416): in every reference model, every view, laid
 * out Layered and Like show_graph, no line has
 *   - a wiggle: a bump shorter than 80 units between two changes of direction;
 *   - a hook: a turn of more than 150° within 150 units (a loop or hairpin);
 * and, Like show_graph, no line drawn on show_graph's course changes direction
 * more often than show_graph's own curve for it (laid out here by the same
 * Graphviz, from the description the app fetched).
 *
 * Measured in flow units (zoom-independent), each line sampled every 2 units
 * along the drawn SVG path. See `smoothness` in utils/curveSmoothness.ts.
 *
 * The loading helpers follow show-graph-agreement.spec.ts's.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page, Response } from "@playwright/test";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import path from "path";
import { fileURLToPath } from "url";
import { placementFromGraphviz, sampleCourse } from "../src/utils/showGraphLayout";
import { resample, smoothness } from "../src/utils/curveSmoothness";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");
const STEP = 2;

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

const layoutSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Like show_graph" }) }).first();
const viewSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();
const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60000 });

/** Every show_graph description the page fetches. */
function captureShowGraph(page: Page) {
  const all: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (r: Response) => {
    if (!r.url().includes("/api/model/show-graph") || r.request().method() !== "POST") return;
    pending.push(r.json().then((b: { dot?: string }) => { if (r.ok() && b.dot) all.push(b.dot); }).catch(() => {}));
  });
  return { all, settle: () => Promise.all(pending).then(() => {}) };
}

/** Nodes and lines, read until two reads a moment apart agree. */
async function settled(page: Page) {
  await expect(page.getByTestId("busy-wheel")).toHaveCount(0, { timeout: 60000 }).catch(() => {});
  const read = () =>
    page
      .getByTestId("graph-canvas")
      .locator(".react-flow__node, path.react-flow__edge-path")
      .evaluateAll((els) => els.map((el) => el.getAttribute("d") ?? el.getAttribute("style") ?? "").join("|"));
  let last = await read();
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(300);
    const now = await read();
    if (now === last) break;
    last = now;
  }
}

async function openModel(page: Page, model: string) {
  const file = path.basename(model);
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(BACKEND_DIR, model));
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/model/load") && (r.request().postData() ?? "").includes(file),
      { timeout: 60000 },
    ),
    prompt.press("Enter"),
  ]);
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  await settled(page);
}

async function views(page: Page): Promise<{ value: string; label: string }[]> {
  const select = viewSelect(page);
  if (!(await select.isVisible().catch(() => false))) return [{ value: "", label: "the model" }];
  return select.locator("option").evaluateAll((os) =>
    os.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? "").trim() })),
  );
}

async function setLayout(page: Page, style: "layered" | "showgraph") {
  const sel = layoutSelect(page);
  if ((await sel.inputValue()) === style) {
    // Re-apply, so the positions are this engine's and not left from a switch.
    await sel.selectOption(style === "layered" ? "showgraph" : "layered");
    await settled(page);
  }
  await sel.selectOption(style);
  if (style === "showgraph") {
    await page.waitForResponse((r) => r.url().includes("/api/model/show-graph"), { timeout: 20000 }).catch(() => {});
    await expect(page.locator("path.pnv-edge-showgraph").first()).toBeAttached({ timeout: 20000 }).catch(() => {});
  }
  await settled(page);
}

interface Line { id: string; ends: string; pts: { x: number; y: number }[] }

/** Every visible line, sampled every STEP flow units along its drawn path. */
async function readLines(page: Page): Promise<Line[]> {
  return page.getByTestId("graph-canvas").locator(".react-flow__edge").evaluateAll((gs, STEP) => {
    const out: { id: string; ends: string; pts: { x: number; y: number }[] }[] = [];
    for (const g of gs) {
      const path = g.querySelector("path.react-flow__edge-path") as SVGPathElement | null;
      if (!path) continue;
      const cs = getComputedStyle(path);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      let total = 0;
      try { total = path.getTotalLength(); } catch { continue; }
      if (!total) continue;
      const pts: { x: number; y: number }[] = [];
      for (let l = 0; l < total; l += STEP) { const q = path.getPointAtLength(l); pts.push({ x: q.x, y: q.y }); }
      const q = path.getPointAtLength(total);
      pts.push({ x: q.x, y: q.y });
      out.push({
        id: (g.getAttribute("aria-label") ?? g.getAttribute("data-id") ?? "").replace(/^Edge from /, ""),
        ends: path.classList.contains("pnv-edge-showgraph") ? (path.getAttribute("data-showgraph-ends") ?? "") : "",
        pts,
      });
    }
    return out;
  }, STEP);
}

/** Most changes of direction among show_graph's own curves, by their ends. */
function showGraphChanges(gv: Graphviz, dots: string[], names: Set<string>): Map<string, number> {
  // The description that draws most of the canvas's nodes, the latest on a tie.
  let best: ReturnType<typeof placementFromGraphviz> | null = null;
  let bestHits = -1;
  for (const dot of [...dots].reverse()) {
    const pl = placementFromGraphviz(JSON.parse(gv.layout(dot, "json", "dot")), "");
    const hits = [...names].filter((n) => pl.nodes.has(n)).length;
    if (hits > bestHits) { best = pl; bestHits = hits; }
  }
  const most = new Map<string, number>();
  for (const e of best?.edges ?? []) {
    if (e.tail === e.head) continue;
    const key = `${e.tail}\u0000${e.head}`;
    const c = smoothness(resample(sampleCourse(e.spline, e.tip), STEP), { step: STEP }).changes;
    most.set(key, Math.max(most.get(key) ?? 0, c));
  }
  return most;
}

test("lines are smooth in every reference model, Layered and Like show_graph (#416)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await closePalette(page);
  const gv = await Graphviz.load();
  const captured = captureShowGraph(page);
  const problems: string[] = [];
  let measured = 0, lines = 0, onCourse = 0;

  for (const model of REFERENCE_MODELS) {
    await openModel(page, model);
    for (const view of await views(page)) {
      const select = viewSelect(page);
      if (view.value && (await select.inputValue()) !== view.value) {
        await Promise.all([loaded(page), select.selectOption(view.value)]);
      }
      await settled(page);
      // A view with saved positions opens in Custom; what's measured is the
      // automatic layout, so switch to it (nothing is saved).
      const custom = page.getByRole("button", { name: /^Layout: Custom$/ });
      if (await custom.isVisible().catch(() => false)) {
        await Promise.all([loaded(page), custom.click()]);
        await settled(page);
      }
      for (const layout of ["layered", "showgraph"] as const) {
        const from = captured.all.length;
        await setLayout(page, layout);
        const where = `${path.basename(model)} · ${view.label} · ${layout === "layered" ? "Layered" : "Like show_graph"}`;
        const drawn = await readLines(page);
        let reference: Map<string, number> | null = null;
        if (layout === "showgraph") {
          await captured.settle();
          // A view drawing the same graph reuses the layout and fetches nothing.
          const dots = captured.all.length > from ? captured.all.slice(from) : captured.all.slice(-1);
          const names = new Set(
            await page
              .getByTestId("graph-canvas")
              .locator(".react-flow__node")
              .evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? "")),
          );
          reference = showGraphChanges(gv, dots, names);
        }
        measured++;
        for (const line of drawn) {
          lines++;
          const s = smoothness(line.pts, { step: STEP });
          if (s.wiggles) problems.push(`${where}: ${line.id} has ${s.wiggles} wiggle(s), ripple ${s.ripple}`);
          if (s.hooks) problems.push(`${where}: ${line.id} hooks back on itself`);
          const own = reference && line.ends ? reference.get(line.ends) : undefined;
          if (own !== undefined) {
            onCourse++;
            if (s.changes > own) {
              problems.push(`${where}: ${line.id} changes direction ${s.changes} times, show_graph's curve ${own}`);
            }
          }
        }
      }
    }
  }
  console.log(`edge smoothness: ${measured} layouts, ${lines} lines, ${onCourse} on show_graph's course`);
  for (const p of problems) console.log(p);
  expect(measured, "layouts measured").toBeGreaterThanOrEqual(REFERENCE_MODELS.length * 2);
  expect(onCourse, "lines compared with show_graph's own").toBeGreaterThan(50);
  expect(problems).toEqual([]);
});
