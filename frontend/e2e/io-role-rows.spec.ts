/**
 * Inputs at the bottom, outputs at the top (#212).
 *
 * The convention: a composition's INPUT nodes (green) sit on its bottom row
 * and its OUTPUT nodes (red) on its top row. This checks it on every
 * reference model as the model opens (on the layout it ships, where it has
 * one) and in the automatic layout a model opens with otherwise, Like
 * show_graph, which always flows bottom-to-top. Nested compositions are open,
 * as the default view has them, and each composition is judged on its own
 * level: the nodes sharing a composition path.
 *
 * The rule, per level:
 *   - the INPUT nodes share one row, and nothing of the level sits below it;
 *   - the OUTPUT nodes share one row, and nothing of the level sits above it
 *     except the learning and control apparatus (targets, losses, learning
 *     mechanisms, controllers and their objective mechanisms), which hangs
 *     off the outputs rather than feeding them, and which show_graph draws
 *     beyond them (EGO's LOSS above PREDICTION, the TD model's prediction
 *     error and learning mechanism above Action Selection).
 * Nodes are compared by position, never by pixel size: "below" and "above"
 * mean two boxes' centres are more than their half-heights apart.
 *
 * Also measured, and printed for the record: the strictest reading, with
 * nothing at all above an output, and what show_graph's own picture does for
 * the same model. The layout follows show_graph (#34), so a model where
 * show_graph itself departs from the convention would be listed as an
 * exception here, not bent into shape.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page, Response } from "@playwright/test";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import path from "path";
import { fileURLToPath } from "url";
import { placementFromGraphviz } from "../src/utils/showGraphLayout";
import type { Box } from "../src/utils/layoutAgreement";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");

// Every bundled reference model (see show-graph-agreement.spec.ts).
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
];

/**
 * Departures accepted by name, each with its reason: "model — view" → the
 * violations the rule reports there, exactly, so a fix shows up here too.
 * A model whose show_graph picture broke the convention would be listed
 * the same way, since the canvas follows show_graph (#34).
 */
const AGREED_EXCEPTIONS: Record<string, string[]> = {};

/** What the load gives for a node, as far as this needs. */
interface NodeInfo {
  name: string;
  roles: string[];
  /** Composition path in the flattened view, outermost first; [] at the top. */
  level: string;
}

/** The learning and control apparatus: drawn beyond the outputs it hangs off. */
const APPARATUS = ["LEARNING", "LEARNING_OBJECTIVE", "TARGET", "CONTROLLER", "CONTROLLER_OBJECTIVE", "CONTROL_OBJECTIVE"];
const isApparatus = (n: NodeInfo) => n.roles.some((r) => APPARATUS.includes(r) || r.startsWith("TARGET"));
const isInput = (n: NodeInfo) => n.roles.includes("INPUT");
const isOutput = (n: NodeInfo) => n.roles.includes("OUTPUT");

const centerY = (b: Box) => b.y + b.h / 2;
/** Two boxes share a row when their centres are within their half-heights. */
const sameRow = (a: Box, b: Box) => Math.abs(centerY(a) - centerY(b)) < (a.h + b.h) / 4;
const above = (a: Box, b: Box) => !sameRow(a, b) && centerY(a) < centerY(b);

interface Violations {
  /**
   * The rule enforced: on each level, the inputs share the lowest row, and
   * the outputs share the highest row but for the learning and control
   * apparatus, which may sit above them.
   */
  rule: string[];
  /** The strictest reading: as above, with nothing at all above an output. */
  strict: string[];
}

/**
 * Judge boxes against the convention, level by level. Only nodes with a box
 * count: the view may hide some.
 */
function judge(boxes: Map<string, Box>, nodes: NodeInfo[]): Violations {
  const rule: string[] = [];
  const apparatusAbove: string[] = [];
  const placed = nodes.filter((n) => boxes.has(n.name));
  const levels = new Map<string, NodeInfo[]>();
  for (const n of placed) levels.set(n.level, [...(levels.get(n.level) ?? []), n]);

  for (const [level, members] of levels) {
    const at = level ? ` (in ${level})` : "";
    const box = (n: NodeInfo) => boxes.get(n.name)!;
    const inputs = members.filter(isInput);
    const outputs = members.filter((n) => isOutput(n) && !isInput(n));
    // Inputs: one row, with nothing below it.
    for (let a = 1; a < inputs.length; a++) {
      if (!sameRow(box(inputs[0]), box(inputs[a]))) rule.push(`inputs ${inputs[0].name} and ${inputs[a].name} on different rows${at}`);
    }
    for (const i of inputs) {
      for (const n of members) {
        if (!isInput(n) && above(box(i), box(n))) rule.push(`input ${i.name} above ${n.name}${at}`);
      }
    }
    // Outputs: one row, with nothing above it but the apparatus.
    for (let a = 1; a < outputs.length; a++) {
      if (!sameRow(box(outputs[0]), box(outputs[a]))) rule.push(`outputs ${outputs[0].name} and ${outputs[a].name} on different rows${at}`);
    }
    for (const o of outputs) {
      for (const n of members) {
        if (isOutput(n) || !above(box(n), box(o))) continue;
        (isApparatus(n) ? apparatusAbove : rule).push(`output ${o.name} below ${n.name}${at}`);
      }
    }
  }
  return { rule, strict: [...rule, ...apparatusAbove] };
}

/** Every load response and show_graph description the page fetches. */
function capture(page: Page) {
  const loads: NodeInfo[][] = [];
  const dots: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (r: Response) => {
    if (r.request().method() !== "POST") return;
    if (r.url().includes("/api/model/load") && r.ok()) {
      pending.push(
        r
          .json()
          .then((b) => {
            const comp = b?.model?.compositions?.[0];
            if (!comp) return;
            const model: NodeInfo[] = (comp.nodes ?? []).map((n: { name: string; roles?: string[]; compPath?: string[] }) => ({
              name: n.name,
              roles: n.roles ?? [],
              level: (n.compPath ?? []).join(" › "),
            }));
            loads.push(model);
          })
          .catch(() => {}),
      );
    } else if (r.url().includes("/api/model/show-graph") && r.ok()) {
      pending.push(
        r
          .json()
          .then((b: { dot?: string }) => {
            if (b.dot) dots.push(b.dot);
          })
          .catch(() => {}),
      );
    }
  });
  return { loads, dots, settle: () => Promise.all(pending).then(() => {}) };
}

const layoutSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Like show_graph" }) }).first();

async function openModel(page: Page, file: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(BACKEND_DIR, "reference_models", file));
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/model/load") && (r.request().postData() ?? "").includes(file),
      { timeout: 60000 },
    ),
    prompt.press("Enter"),
  ]);
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
}

/** Canvas node boxes by name, read until two reads a moment apart agree. */
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

/**
 * Boxes keyed by the model's node names. A node's id can carry a session
 * suffix once several models have loaded ("STATE-7"), see test-base.
 */
function byName(boxes: Map<string, Box>, nodes: NodeInfo[]): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const n of nodes) {
    const hit = boxes.get(n.name) ?? [...boxes.entries()].find(([id]) => new RegExp(`^${escapeRe(n.name)}-\\d+$`).test(id))?.[1];
    if (hit) out.set(n.name, hit);
  }
  return out;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** show_graph's own boxes for these nodes, from the description that drew most of them. */
function showGraphBoxes(gv: Graphviz, dots: string[], nodes: NodeInfo[]): Map<string, Box> {
  let best = new Map<string, Box>();
  for (const dot of dots) {
    const placement = placementFromGraphviz(JSON.parse(gv.layout(dot, "json", "dot")), "");
    const boxes = new Map<string, Box>();
    for (const n of nodes) {
      const p = placement.nodes.get(n.name);
      if (p) boxes.set(n.name, { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h });
    }
    if (boxes.size > best.size) best = boxes;
  }
  return best;
}

interface Measured {
  model: string;
  /** "as opened" (a saved layout, where the model has one) or "Like show_graph". */
  view: string;
  nodes: number;
  canvas: Violations;
  showGraph: Violations;
}

function report(m: Measured): string {
  const list = (v: string[]) => (v.length ? v.join("; ") : "none");
  return (
    `${m.model} — ${m.view} (${m.nodes} nodes)\n` +
    `  canvas, rule:        ${list(m.canvas.rule)}\n` +
    `  canvas, strict:      ${list(m.canvas.strict)}\n` +
    `  show_graph, rule:    ${list(m.showGraph.rule)}\n` +
    `  show_graph, strict:  ${list(m.showGraph.strict)}`
  );
}

const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60000 });

/** Wait for show_graph's arrangement to land: it draws the edges on its courses. */
async function showGraphLanded(page: Page) {
  await expect(layoutSelect(page)).toHaveValue("showgraph");
  await expect(page.locator(".react-flow__edge path.pnv-edge-showgraph").first()).toBeVisible({ timeout: 30000 });
}

/**
 * Open each model in turn and judge it as it opens (on its saved layout,
 * where it ships one), then in the automatic Like show_graph layout. With
 * `flip`, judge it once, arranged by `flip` instead.
 */
async function measureAll(page: Page, models: string[], flip?: (page: Page) => Promise<void>): Promise<Measured[]> {
  const gv = await Graphviz.load();
  const captured = capture(page);
  const results: Measured[] = [];
  const judgeNow = async (file: string, view: string, loadsAt: number, dotsAt: number) => {
    await captured.settle();
    const load = captured.loads[loadsAt];
    expect(load, `${file}: load response`).toBeTruthy();
    const drawn = byName(await settledBoxes(page), load);
    expect(drawn.size, `${file}: nodes drawn`).toBeGreaterThan(0);
    const sg = showGraphBoxes(gv, captured.dots.slice(dotsAt), load);
    results.push({
      model: file.replace(/\.py$/, ""),
      view,
      nodes: drawn.size,
      canvas: judge(drawn, load),
      showGraph: judge(sg, load),
    });
  };
  for (const file of models) {
    const loadsBefore = captured.loads.length;
    const dotsBefore = captured.dots.length;
    await openModel(page, file);
    if (flip) {
      await flip(page);
      await judgeNow(file, "flipped", loadsBefore, dotsBefore);
      continue;
    }
    // A model that ships a layout opens on it (Layout: Custom); otherwise on
    // the default, show_graph's arrangement.
    const custom = page.getByRole("button", { name: /^Layout: Custom$/ });
    const saved = await custom.isVisible().catch(() => false);
    if (!saved) await showGraphLanded(page);
    await judgeNow(file, saved ? "as opened (saved layout)" : "as opened (Like show_graph)", loadsBefore, dotsBefore);
    if (!saved) continue;
    // Then the automatic layout: switching mode reloads the view.
    const loadsAfter = captured.loads.length;
    await Promise.all([loaded(page), custom.click()]);
    await showGraphLanded(page);
    await judgeNow(file, "Like show_graph", loadsAfter, dotsBefore);
  }
  return results;
}

test.describe("inputs at the bottom, outputs at the top (#212)", () => {
  test.beforeEach(async ({ page }) => {
    // The suite keeps Layered (test-base); this is about the default.
    await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.layoutDefault"));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await closePalette(page);
  });

  test("the default layout is Like show_graph, bottom-to-top", { tag: "@ci" }, async ({ page }) => {
    await openModel(page, "stroop_reference_basic.py");
    await expect(layoutSelect(page)).toHaveValue("showgraph");
    await page.getByTestId("graph-view-options-button").click();
    const direction = page.getByTestId("graph-view-option-direction");
    await expect(direction).toHaveValue("BT");
    // Like show_graph always flows bottom-to-top: the direction is not a choice there.
    await expect(direction).toBeDisabled();
    await page.keyboard.press("Escape");
    // The setting says so too.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-appearance").click();
    await expect(page.getByTestId("setting-graph-layout-default")).toHaveValue("showgraph");
  });

  test("every reference model keeps inputs at the bottom and outputs at the top", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const results = await measureAll(page, REFERENCE_MODELS);
    for (const m of results) console.log(report(m));
    expect(new Set(results.map((m) => m.model)).size, "models measured").toBe(REFERENCE_MODELS.length);
    for (const m of results) {
      const where = `${m.model} — ${m.view}`;
      expect(m.canvas.rule, `${where}: inputs and outputs out of place`).toEqual(AGREED_EXCEPTIONS[where] ?? []);
    }
  });

  // The check has teeth: turned upside down (Layered, top-down), it reports
  // the inputs above everything.
  test("a top-down layout is reported", { tag: "@ci" }, async ({ page }) => {
    const [m] = await measureAll(page, ["stroop_reference_basic.py"], async (page) => {
      await layoutSelect(page).selectOption("layered");
      await page.getByTestId("graph-view-options-button").click();
      await page.getByTestId("graph-view-option-direction").selectOption("TB");
      await page.keyboard.press("Escape");
    });
    console.log(report(m));
    expect(m.canvas.rule.length, "violations reported").toBeGreaterThan(0);
  });
});
