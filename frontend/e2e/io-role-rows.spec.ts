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
import { copyFileSync } from "fs";
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

/** Wait for Layered's arrangement to land. */
async function layeredLanded(page: Page) {
  await expect(layoutSelect(page)).toHaveValue("layered");
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node-mechanismNode").first()).toBeVisible({ timeout: 30000 });
}

interface MeasureOptions {
  /** Judge each model once, arranged by this instead. */
  flip?: (page: Page) => Promise<void>;
  /** The automatic layout the models open in: Like show_graph (the default) or Layered. */
  auto?: "showgraph" | "layered";
  /** Judge only the automatic layout, not a saved layout a model opens on. */
  autoOnly?: boolean;
}

/**
 * Open each model in turn and judge it as it opens (on its saved layout,
 * where it ships one), then in the automatic layout, Like show_graph unless
 * `auto` says Layered. With `flip`, judge it once, arranged by `flip` instead.
 */
async function measureAll(page: Page, models: string[], options: MeasureOptions = {}): Promise<Measured[]> {
  const { flip, auto = "showgraph", autoOnly = false } = options;
  const landed = auto === "layered" ? layeredLanded : showGraphLanded;
  const autoName = auto === "layered" ? "Layered" : "Like show_graph";
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
    if (!saved) await landed(page);
    if (!saved || !autoOnly) {
      await judgeNow(file, saved ? "as opened (saved layout)" : `as opened (${autoName})`, loadsBefore, dotsBefore);
    }
    if (!saved) continue;
    // Then the automatic layout: switching mode reloads the view.
    const loadsAfter = captured.loads.length;
    await Promise.all([loaded(page), custom.click()]);
    await landed(page);
    await judgeNow(file, autoName, loadsAfter, dotsBefore);
  }
  return results;
}

test.describe("inputs at the bottom, outputs at the top (#212)", () => {
  test.beforeEach(async ({ page }) => {
    // The suite keeps Layered (test-base); this is about the default.
    await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.layoutDefault"));
    // The suite has Keep inputs on the bottom and outputs on top off
    // (test-base); this is about its default, In automatic layouts (#219).
    await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.ioRows"));
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
    // #219: inputs kept on the bottom and outputs on top, in automatic layouts.
    await expect(page.getByTestId("setting-graph-io-rows")).toHaveValue("layouts");
    await expect(page.getByTestId("io-rows-not-applying")).toHaveCount(0);
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
    const [m] = await measureAll(page, ["stroop_reference_basic.py"], {
      flip: async (page) => {
        await layoutSelect(page).selectOption("layered");
        await page.getByTestId("graph-view-options-button").click();
        await page.getByTestId("graph-view-option-direction").selectOption("TB");
        await page.keyboard.press("Escape");
      },
    });
    console.log(report(m));
    // Top-down is an explicit request, and wins over the setting (#219),
    // which says it doesn't apply.
    expect(m.canvas.rule.length, "violations reported").toBeGreaterThan(0);
    await openAppearance(page);
    await expect(page.getByTestId("setting-graph-io-rows")).toHaveValue("layouts");
    await expect(page.getByTestId("io-rows-not-applying")).toContainText("top-down");
    await closeSettings(page);
  });
});

// --- The setting (#219) --------------------------------------------------
//
// Settings ▸ Appearance ▸ Automatic layout ▸ Keep inputs on the bottom and
// outputs on top: Off, In automatic layouts (the default, measured above on
// Like show_graph) or Also while dragging.

async function openAppearance(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-graph-io-rows")).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();
}

/** Choose the setting, and the automatic layout too if given, in Settings as a person would. */
async function choose(page: Page, ioRows: "off" | "layouts" | "drag", layout?: "layered" | "showgraph" | "radial" | "force") {
  await openAppearance(page);
  if (layout) await page.getByTestId("setting-graph-layout-default").selectOption(layout);
  await page.getByTestId("setting-graph-io-rows").selectOption(ioRows);
  await closeSettings(page);
}

const EGO = "Giallanza2024_ego_study2.py";
const BOTVINICK = "Botvinick_conflict_monitoring_model.py";

/** A copy of a reference model, so dragging and tidying save their layout beside the copy. */
function copyOf(file: string): string {
  const to = test.info().outputPath(file);
  copyFileSync(path.join(BACKEND_DIR, "reference_models", file), to);
  return to;
}

/** Open a model by its full path, and keep its load response. */
async function openPath(page: Page, file: string): Promise<NodeInfo[]> {
  const captured = capture(page);
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await Promise.all([loaded(page), prompt.press("Enter")]);
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  await captured.settle();
  expect(captured.loads.length, "load response").toBeGreaterThan(0);
  return captured.loads[captured.loads.length - 1];
}

/** Switch the open model to a layout of its own, where nodes can be dragged. */
async function toCustomLayout(page: Page) {
  const auto = page.getByRole("button", { name: /^Layout: Auto$/ });
  if (await auto.isVisible().catch(() => false)) await Promise.all([loaded(page), auto.click()]);
  await expect(page.getByRole("button", { name: /^Layout: Custom$/ })).toBeVisible();
}

/** The canvas id of a node, by its name (see byName). */
async function idOf(page: Page, name: string): Promise<string> {
  const ids = await page
    .getByTestId("graph-canvas")
    .locator(".react-flow__node-mechanismNode")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? ""));
  const id = ids.find((i) => i === name) ?? ids.find((i) => new RegExp(`^${escapeRe(name)}-\\d+$`).test(i));
  expect(id, `${name} on the canvas`).toBeTruthy();
  return id!;
}

/** Drag a node by (dx, dy) screen pixels, grabbing it by its middle. */
async function dragBy(page: Page, name: string, dx: number, dy: number) {
  const node = page.locator(`.react-flow__node[data-id="${await idOf(page, name)}"]`);
  const box = (await node.boundingBox())!;
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 6 });
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 6 });
  await page.mouse.up();
}

/** The nodes of one composition ("" at the top) by what they are for the rule. */
function kinds(nodes: NodeInfo[], level: string) {
  const at = nodes.filter((n) => n.level === level);
  return {
    inputs: at.filter((n) => isInput(n) && !isOutput(n)),
    outputs: at.filter((n) => isOutput(n) && !isInput(n)),
    others: at.filter((n) => !isInput(n) && !isOutput(n) && !isApparatus(n)),
  };
}

async function boxesOf(page: Page, nodes: NodeInfo[]) {
  return byName(await settledBoxes(page), nodes);
}

test.describe("Keep inputs on the bottom and outputs on top (#219)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.layoutDefault"));
    await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.ioRows"));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await closePalette(page);
  });

  test("Layered follows it on every reference model", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(6 * 60_000);
    await choose(page, "layouts", "layered");
    const results = await measureAll(page, REFERENCE_MODELS, { auto: "layered", autoOnly: true });
    for (const m of results) console.log(report(m));
    expect(new Set(results.map((m) => m.model)).size, "models measured").toBe(REFERENCE_MODELS.length);
    for (const m of results) {
      const where = `${m.model} — ${m.view}`;
      expect(m.canvas.rule, `${where}: inputs and outputs out of place`).toEqual(AGREED_EXCEPTIONS[where] ?? []);
    }
  });

  // Off is no constraint: Layered's own ranking breaks the rule on EGO
  // (inside EM) and Botvinick, as measured on #219, so the setting is what
  // puts them right above.
  test("Off leaves Layered's own rows", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await choose(page, "off", "layered");
    const results = await measureAll(page, [EGO, BOTVINICK], { auto: "layered", autoOnly: true });
    for (const m of results) console.log(report(m));
    expect(results.map((m) => m.model)).toEqual([EGO, BOTVINICK].map((f) => f.replace(/\.py$/, "")));
    for (const m of results) expect(m.canvas.rule.length, `${m.model}: Layered's own rows`).toBeGreaterThan(0);
  });

  test("Radial and Force: the setting says it doesn't apply", { tag: "@ci" }, async ({ page }) => {
    await openAppearance(page);
    const note = page.getByTestId("io-rows-not-applying");
    await expect(note).toHaveCount(0);
    await page.getByTestId("setting-graph-layout-default").selectOption("radial");
    await expect(note).toContainText("Radial");
    await page.getByTestId("setting-graph-layout-default").selectOption("force");
    await expect(note).toContainText("Force");
    // Off has nothing to apply.
    await page.getByTestId("setting-graph-io-rows").selectOption("off");
    await expect(note).toHaveCount(0);
    await page.getByTestId("setting-graph-io-rows").selectOption("layouts");
    await page.getByTestId("setting-graph-layout-default").selectOption("layered");
    await expect(note).toHaveCount(0);
  });

  test("while dragging, inputs and outputs keep their rows, and the rest stays between", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(2 * 60_000);
    await choose(page, "drag");
    const nodes = await openPath(page, copyOf("stroop_reference_basic.py"));
    await toCustomLayout(page);
    const { inputs, outputs, others } = kinds(nodes, "");
    expect(inputs.length && outputs.length && others.length, "an input, an output and another node").toBeTruthy();
    const [input, output, other] = [inputs[0], outputs[0], others[0]];

    // An input dragged up and sideways only goes sideways.
    let before = await boxesOf(page, nodes);
    await dragBy(page, input.name, 80, -200);
    let after = await boxesOf(page, nodes);
    expect(Math.abs(after.get(input.name)!.y - before.get(input.name)!.y), "input's row").toBeLessThan(2);
    expect(after.get(input.name)!.x - before.get(input.name)!.x, "input moved sideways").toBeGreaterThan(40);

    // An output dragged down only goes sideways.
    before = after;
    await dragBy(page, output.name, -60, 250);
    after = await boxesOf(page, nodes);
    expect(Math.abs(after.get(output.name)!.y - before.get(output.name)!.y), "output's row").toBeLessThan(2);

    // Another node dragged far below the inputs stops on their row, and far above the outputs, on theirs.
    await dragBy(page, other.name, 0, 600);
    after = await boxesOf(page, nodes);
    expect(centerY(after.get(other.name)!), "not below the inputs").toBeLessThanOrEqual(centerY(after.get(input.name)!) + 2);
    await dragBy(page, other.name, 0, -900);
    after = await boxesOf(page, nodes);
    expect(centerY(after.get(other.name)!), "not above the outputs").toBeGreaterThanOrEqual(centerY(after.get(output.name)!) - 2);

    // In automatic layouts only, dragging is free.
    await choose(page, "layouts");
    before = await boxesOf(page, nodes);
    await dragBy(page, input.name, 0, -150);
    after = await boxesOf(page, nodes);
    expect(before.get(input.name)!.y - after.get(input.name)!.y, "input dragged up freely").toBeGreaterThan(100);
  });

  test("while dragging inside a composition, its own rows hold, and the frame moves freely", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(2 * 60_000);
    await choose(page, "drag");
    const nodes = await openPath(page, copyOf(EGO));
    await toCustomLayout(page);
    const level = nodes.find((n) => n.level && isInput(n) && !isOutput(n))?.level;
    expect(level, "a composition with an input").toBeTruthy();
    const { inputs, others } = kinds(nodes, level!);
    const input = inputs[0];
    let before = await boxesOf(page, nodes);
    await dragBy(page, input.name, 60, -200);
    let after = await boxesOf(page, nodes);
    expect(Math.abs(after.get(input.name)!.y - before.get(input.name)!.y), `${input.name}'s row in ${level}`).toBeLessThan(2);
    if (others.length) {
      await dragBy(page, others[0].name, 0, 600);
      after = await boxesOf(page, nodes);
      expect(centerY(after.get(others[0].name)!), `not below ${level}'s inputs`).toBeLessThanOrEqual(centerY(after.get(input.name)!) + 2);
    }
    // The frame itself goes where it is dragged, its members with it.
    const frame = page.getByTestId("graph-canvas").locator(".react-flow__node-compositionNode").first();
    const fb = (await frame.boundingBox())!;
    before = await boxesOf(page, nodes);
    await page.mouse.move(fb.x + 40, fb.y + 12);
    await page.mouse.down();
    await page.mouse.move(fb.x + 40, fb.y + 112, { steps: 6 });
    await page.mouse.move(fb.x + 40, fb.y + 212, { steps: 6 });
    await page.mouse.up();
    after = await boxesOf(page, nodes);
    expect(after.get(input.name)!.y - before.get(input.name)!.y, "frame dragged down with its members").toBeGreaterThan(100);
  });

  test("Tidy inputs and outputs puts a saved layout right, and Undo puts it back", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(2 * 60_000);
    const nodes = await openPath(page, copyOf("stroop_reference_basic.py"));
    const tidy = page.getByTestId("layout-menu-tidy-io-rows");
    const openLayoutMenu = async () => {
      await page.getByTestId("layout-menu-button").click();
      await expect(page.getByTestId("layout-menu-list")).toBeVisible();
    };
    // Automatic: the setting looks after it.
    await openLayoutMenu();
    await expect(tidy).toHaveAttribute("aria-disabled", "true");
    await expect(tidy).toHaveAttribute("title", /automatic/);
    await page.keyboard.press("Escape");

    await toCustomLayout(page);
    // Nothing to tidy yet.
    await openLayoutMenu();
    await expect(tidy).toHaveAttribute("aria-disabled", "true");
    await expect(tidy).toHaveAttribute("title", /already/);
    await page.keyboard.press("Escape");

    // Dragging is free by default: an input dragged to the top breaks the rule.
    const { inputs } = kinds(nodes, "");
    await dragBy(page, inputs[0].name, 0, -500);
    const broken = judge(await boxesOf(page, nodes), nodes).rule;
    expect(broken.length, "the drag broke the rule").toBeGreaterThan(0);

    await openLayoutMenu();
    await expect(tidy).not.toHaveAttribute("aria-disabled", "true");
    await tidy.click();
    await expect.poll(async () => judge(await boxesOf(page, nodes), nodes).rule, { timeout: 15000 }).toEqual([]);

    await page.getByTestId("undo-button").click();
    await expect.poll(async () => judge(await boxesOf(page, nodes), nodes).rule, { timeout: 15000 }).toEqual(broken);
    await openLayoutMenu();
    await expect(tidy).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
  });
});
