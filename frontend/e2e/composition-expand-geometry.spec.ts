/**
 * Expanding a nested composition that was folded and moved (#208, #209).
 *
 * On EGO, in the nested view with a custom layout: fold EM, drag it and a
 * neighbour about, open it again. Two things must then hold, by geometry:
 *
 *  - the open EM frame overlaps no node of the outer composition (#208);
 *  - every projection between an outer node and a member of EM still ends
 *    on that member, as show_graph draws it, rather than stopping at the
 *    frame's edge (#209).
 *
 * Both are checked again after the open frame is dragged, including onto outer
 * nodes, after Undo and Redo through the steps, and after the model is opened
 * afresh with the positions that were saved along the way. Tried in Like show_graph (the layout the
 * report came from; the page's own Graphviz build, so no `dot` is needed) and
 * in Layered.
 */
import { mutatingTest as test, expect, closePalette, canvasNode, fitGraph } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { copyFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_MODELS = path.resolve(__dirname, "..", "..", "backend", "reference_models");
const EGO_FILES = ["Giallanza2024_ego_study2.py", "Giallanza2024_ego_study2.pnlview.json", "Giallanza2024_ego_study2.psyneuview.json"];

/**
 * A copy of EGO, with its sidecars, in this test's own folder. The moves
 * here are saved to the model's layout sidecar, and the bundled one must not
 * carry them into the specs that open EGO after this one.
 */
function egoCopy(): string {
  const dir = test.info().outputPath("ego");
  mkdirSync(dir, { recursive: true });
  for (const f of EGO_FILES) copyFileSync(path.join(REFERENCE_MODELS, f), path.join(dir, f));
  return path.join(dir, EGO_FILES[0]);
}

/** EGO's own nodes, outside EM. */
const OUTER = ["STATE", "PREVIOUS STATE", "CONTEXT", "CONTEXT [NORMALIZED]", "PREDICTION", "CONTEXT [BIAS]", "LOSS for PREDICTION"];

/** The projections that cross EM's boundary, and the nodes show_graph draws them between. */
const THROUGH_EM = [
  { from: "STATE", to: "STATE [VALUE]", id: "from STATE[OutputPort-0] to EM Input_CIM[INPUT_CIM_STATE [VALUE]_" },
  { from: "PREVIOUS STATE", to: "PREVIOUS STATE [QUERY]", id: "from PREVIOUS STATE[OutputPort-0] to EM Input_CIM[INPUT_CIM_PREVIOUS STATE [QUERY]_" },
  { from: "CONTEXT [NORMALIZED]", to: "CONTEXT [QUERY]", id: "from CONTEXT [NORMALIZED][RESULT] to EM Input_CIM[INPUT_CIM_CONTEXT [QUERY]_" },
  { from: "STATE [RETRIEVED]", to: "PREDICTION", id: "from EM Output_CIM[OUTPUT_CIM_STATE [RETRIEVED]_OutputPort-0] to PREDICTION[" },
];

// Where to keep screenshots of each stage, when asked (PNV_SHOTS_DIR).
const SHOTS = process.env.PNV_SHOTS_DIR;
let shot = 0;
async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  shot += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`) });
}

const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load"), { timeout: 60_000 });
const saved = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/save-layout"), { timeout: 15_000 });

async function openFromPath(page: Page, file: string) {
  await page.goto("/");
  await closePalette(page);
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await Promise.all([loaded(page), prompt.press("Enter")]);
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

/** The view menu: Flatten (all compositions), the compositions, PyTorch. */
const viewMenu = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();

/** Show the model nested (the view that folds and opens compositions). */
async function showNested(page: Page) {
  const menu = viewMenu(page);
  const nested = await menu.locator("option").filter({ hasText: /^EGO$/ }).first().getAttribute("value");
  await Promise.all([loaded(page), menu.selectOption(nested!)]);
}

type Layout = "showgraph" | "layered";
async function chooseLayout(page: Page, layout: Layout) {
  const select = page.locator('select:has(option[value="showgraph"])');
  if ((await select.inputValue()) === layout) return;
  if (layout === "showgraph") {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/show-graph") && r.ok(), { timeout: 60_000 }),
      select.selectOption(layout),
    ]);
    // The relayout lands a moment after the response.
    await page.waitForTimeout(1000);
  } else {
    await select.selectOption(layout);
  }
}

/** Nodes are dragged in a custom layout; switch to it if the toolbar says Auto. */
async function ensureCustomLayout(page: Page) {
  const button = page.getByRole("button", { name: /^Layout: (Auto|Custom)$/ });
  if ((await button.textContent())?.includes("Auto")) await button.click();
  await expect(button).toHaveText("Layout: Custom");
}

/** Press a frame button by its aria-label and wait for the rebuild it starts. */
async function press(page: Page, name: RegExp) {
  const button = page.getByTestId("graph-canvas").getByRole("button", { name }).first();
  await expect(button).toBeVisible({ timeout: 15_000 });
  await Promise.all([loaded(page), button.click()]);
}

/**
 * Drag a node and wait for the layout save it causes. `to` is where its
 * top-left corner should land: beside another node, measured in that node's
 * own width and height (so the move means the same at any zoom), or a plain
 * offset in screen pixels.
 */
async function drag(
  page: Page,
  name: string,
  to: { beside: string; dx: number; dy: number } | { dx: number; dy: number },
) {
  await fitGraph(page);
  const node = canvasNode(page, name).first();
  await expect(node).toBeVisible();
  const box = (await node.boundingBox())!;
  let dx = to.dx;
  let dy = to.dy;
  if ("beside" in to) {
    const other = (await canvasNode(page, to.beside).first().boundingBox())!;
    dx = other.x + to.dx * other.width - box.x;
    dy = other.y + to.dy * other.height - box.y;
  }
  // Grab the frame by its header (its middle is over a member, which would
  // take the drag), and a mechanism by its middle.
  const isFrame = (await node.getAttribute("class"))?.includes("compositionNode");
  const [gx, gy] = isFrame ? [box.x + box.width * 0.4, box.y + 12] : [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + dx / 2, gy + dy / 2, { steps: 4 });
  const done = saved(page);
  await page.mouse.move(gx + dx, gy + dy, { steps: 4 });
  await page.mouse.up();
  await done;
}

/**
 * Undo or redo one step, named by its tooltip (#204); a step from another
 * view is rebuilt from the file.
 */
async function step(page: Page, which: "undo" | "redo", name: string, rebuilds: boolean) {
  const button = page.getByTestId(`${which}-button`);
  await expect(button).toHaveAttribute("title", `${which === "undo" ? "Undo" : "Redo"}: ${name} (${which === "undo" ? "⌘Z" : "⌘⇧Z"})`);
  if (rebuilds) await Promise.all([loaded(page), button.click()]);
  else await button.click();
  // The step has been taken once the tooltip names the next one.
  await expect(button).not.toHaveAttribute("title", new RegExp(`: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`));
}

interface Box { x: number; y: number; w: number; h: number }
interface Geometry {
  nodes: Record<string, Box>;
  edges: { id: string; ends: string | null; start: { x: number; y: number }; end: { x: number; y: number } }[];
}

/** Every node's box and every projection's two ends, in screen pixels. */
async function geometry(page: Page): Promise<Geometry> {
  return page.getByTestId("graph-canvas").evaluate((root) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {};
    root.querySelectorAll<HTMLElement>(".react-flow__node").forEach((el) => {
      nodes[el.dataset.id!] = rect(el);
    });
    const edges: Geometry["edges"] = [];
    root.querySelectorAll<HTMLElement>(".react-flow__edge").forEach((g) => {
      const drawn = g.querySelector<SVGPathElement>("path.react-flow__edge-path");
      const measure = g.querySelector<SVGPathElement>("[data-testid=edge-measure-path]") ?? drawn;
      if (!measure || !drawn) return;
      const m = measure.getScreenCTM();
      if (!m) return;
      const at = (len: number) => {
        const p = measure.getPointAtLength(len).matrixTransform(m);
        return { x: p.x, y: p.y };
      };
      edges.push({
        id: g.dataset.id ?? "",
        ends: drawn.getAttribute("data-ends"),
        start: at(0),
        end: at(measure.getTotalLength()),
      });
    });
    return { nodes, edges };
  });
}

/** Where each outer node and the EM frame sit on the graph, whatever the zoom. */
async function placed(page: Page): Promise<Record<string, { x: number; y: number }>> {
  const names = [...OUTER, "EM"];
  const at: Record<string, { x: number; y: number }> = {};
  for (const name of names) {
    const transform = await canvasNode(page, name).first().evaluate((el) => (el as HTMLElement).style.transform);
    const m = /translate\(([-\d.]+)px, *([-\d.]+)px\)/.exec(transform);
    expect(m, `${name} has a position (${transform})`).toBeTruthy();
    at[name] = { x: Number(m![1]), y: Number(m![2]) };
  }
  return at;
}

const nodeBox = (g: Geometry, name: string): Box | undefined =>
  g.nodes[name] ?? Object.entries(g.nodes).find(([id]) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(id))?.[1];

const overlap = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

// An edge ends on its node's outline, inside the node's box; a few pixels of
// slack for the stroke.
const SLACK = 6;
const touches = (p: { x: number; y: number }, b: Box) =>
  p.x >= b.x - SLACK && p.x <= b.x + b.w + SLACK && p.y >= b.y - SLACK && p.y <= b.y + b.h + SLACK;

/** The open EM frame holds its members and overlaps no outer node (#208). */
async function expectFrameClear(page: Page, when: string) {
  const g = await geometry(page);
  const frame = nodeBox(g, "EM");
  expect(frame, `${when}: the EM frame is drawn`).toBeTruthy();
  const outerBoxes = OUTER.map((name) => nodeBox(g, name));
  const outside = Object.entries(g.nodes).filter(([, b]) => {
    if (b === frame || outerBoxes.includes(b)) return false;
    return b.x < frame!.x - 1 || b.y < frame!.y - 1 || b.x + b.w > frame!.x + frame!.w + 1 || b.y + b.h > frame!.y + frame!.h + 1;
  });
  expect(outside.map(([id]) => id), `${when}: members sticking out of the EM frame`).toEqual([]);
  const over = OUTER.filter((name) => {
    const b = nodeBox(g, name);
    return b && overlap(frame!, b);
  });
  expect(over, `${when}: outer nodes under the open EM frame`).toEqual([]);
}

/** Each projection through EM's boundary ends on the member inside (#209). */
async function expectEdgesReachMembers(page: Page, when: string) {
  const g = await geometry(page);
  const problems: string[] = [];
  for (const want of THROUGH_EM) {
    const edge = g.edges.find((e) => e.id.includes(want.id));
    if (!edge) {
      problems.push(`${want.from} → ${want.to}: not drawn`);
      continue;
    }
    const from = nodeBox(g, want.from);
    const to = nodeBox(g, want.to);
    if (!from || !to) {
      problems.push(`${want.from} → ${want.to}: a node is missing`);
      continue;
    }
    if (!touches(edge.start, from)) problems.push(`${want.from} → ${want.to}: starts away from ${want.from}`);
    if (!touches(edge.end, to)) problems.push(`${want.from} → ${want.to}: ends away from ${want.to}`);
  }
  // And every projection ends on the nodes it says it joins.
  for (const e of g.edges) {
    if (!e.ends) continue;
    const [s, t] = e.ends.split("\u0000");
    const from = nodeBox(g, s);
    const to = nodeBox(g, t);
    if (from && !touches(e.start, from)) problems.push(`${e.id}: starts away from ${s}`);
    if (to && !touches(e.end, to)) problems.push(`${e.id}: ends away from ${t}`);
  }
  expect(problems, `${when}: projections not reaching their nodes`).toEqual([]);
}

async function expectAllGood(page: Page, when: string) {
  await fitGraph(page);
  await snap(page, when.replace(/\W+/g, "-"));
  await expectFrameClear(page, when);
  await expectEdgesReachMembers(page, when);
}

test.describe("expanding a folded, moved composition (#208, #209)", { tag: "@ci" }, () => {
  test("Like show_graph: the open frame clears the outer nodes and its projections reach its members", async ({ page }) => {
    test.setTimeout(180_000);
    const EGO = egoCopy();
    await openFromPath(page, EGO);
    await chooseLayout(page, "showgraph");

    // Fold EM (which also shows the model nested), then move it and a neighbour.
    await press(page, /^Collapse composition EM$/);
    await ensureCustomLayout(page);
    await snap(page, "folded");
    // The folded node goes just up and left of CONTEXT [NORMALIZED], among the
    // nodes below and right of it: opened from that corner, the frame would
    // cover them.
    await drag(page, "EM", { beside: "CONTEXT [NORMALIZED]", dx: -0.6, dy: -1.5 });
    await drag(page, "PREDICTION", { beside: "LOSS for PREDICTION", dx: 1.2, dy: 0 });
    await snap(page, "folded-and-moved");

    await press(page, /^Expand composition EM$/);
    await expectAllGood(page, "after expanding");

    // Moving the open frame keeps its projections on its members.
    await drag(page, "EM", { dx: 30, dy: 20 });
    await expectAllGood(page, "after moving the open frame");

    // Undo back to the folded state, and redo forward again. (A move made
    // right after a frame button is not a step of its own: History counts a
    // step by its code, view and node count, so Undo goes to "Expanded EM".)
    await step(page, "undo", "Expanded EM", true);
    await expect(page.getByTestId("graph-canvas").locator('.react-flow__node-mechanismNode[data-id="EM"]')).toBeVisible({ timeout: 15_000 });
    await step(page, "redo", "Expanded EM", true);
    await expectAllGood(page, "after undo and redo");

    // Opened afresh, with the positions saved along the way.
    await openFromPath(page, EGO);
    await chooseLayout(page, "showgraph");
    await showNested(page);
    await press(page, /^Expand composition EM$/);
    await expectAllGood(page, "after opening afresh");
  });

  test("dragging: an open frame dropped on outer nodes moves them aside, and a node dropped on it lands beside it", async ({ page }) => {
    test.setTimeout(180_000);
    const EGO = egoCopy();
    await openFromPath(page, EGO);
    await chooseLayout(page, "showgraph");
    await press(page, /^Collapse composition EM$/);
    await ensureCustomLayout(page);
    await press(page, /^Expand composition EM$/);

    // The open frame, by its header, onto the outer nodes.
    await drag(page, "EM", { beside: "CONTEXT [NORMALIZED]", dx: -0.2, dy: 0 });
    await expectAllGood(page, "after dropping the open frame on outer nodes");

    // An outer node, onto the open frame's middle.
    const frame = nodeBox(await geometry(page), "EM")!;
    const state = nodeBox(await geometry(page), "STATE")!;
    await drag(page, "STATE", { dx: frame.x + frame.w / 2 - state.x, dy: frame.y + frame.h / 2 - state.y });
    await expectAllGood(page, "after dropping STATE on the open frame");

    // The report's closing steps: fold, move a neighbour, open, move the frame.
    await press(page, /^Collapse composition EM$/);
    await drag(page, "STATE", { dx: 40, dy: -30 });
    await press(page, /^Expand composition EM$/);
    await expectAllGood(page, "after a second fold, move and expand");
    await drag(page, "EM", { dx: 25, dy: 15 });
    await expectAllGood(page, "after moving the frame again");

    // Where things were moved to is what was saved: opening afresh agrees.
    const before = await placed(page);
    await openFromPath(page, EGO);
    await chooseLayout(page, "showgraph");
    await showNested(page);
    await press(page, /^Expand composition EM$/);
    await expectAllGood(page, "after opening afresh, with the moves saved");
    const after = await placed(page);
    for (const name of [...OUTER, "EM"]) {
      expect(Math.abs(after[name].x - before[name].x), `${name} across a reopen, x`).toBeLessThan(2);
      expect(Math.abs(after[name].y - before[name].y), `${name} across a reopen, y`).toBeLessThan(2);
    }
  });

  test("Layered: the same, after fold, move and expand", async ({ page }) => {
    test.setTimeout(120_000);
    await openFromPath(page, egoCopy());
    await chooseLayout(page, "layered");
    await press(page, /^Collapse composition EM$/);
    await ensureCustomLayout(page);
    await drag(page, "EM", { beside: "CONTEXT", dx: -0.6, dy: -1.5 });
    await drag(page, "CONTEXT [BIAS]", { beside: "CONTEXT", dx: 1.3, dy: 1.2 });
    await press(page, /^Expand composition EM$/);
    await expectAllGood(page, "Layered, after expanding");
  });
});
