/**
 * Node shapes follow show_graph (#192, #193).
 *
 * show_graph draws a feedback sender as an octagon, a nested composition as a
 * rectangle and a controller as a double octagon; the canvas now does too,
 * and each shaped node says what its shape means. EGO is the model the
 * issues were raised on: `COMBINED SCORES` inside `EM` is its one feedback
 * sender and `EM` its one nested composition. The connection dots of the
 * edges into a shaped node sit on its outline, not on the oval it replaced,
 * and collapsing `EM` keeps its edges and its Expand button working.
 *
 * Set NODE_SHAPES_SHOTS to a folder to also save screenshots for review.
 */
import { mutatingTest as test, expect, canvasNode, closePalette, fitGraph } from "./test-base";
import type { Page } from "@playwright/test";
import { fixturePath } from "./fixtures";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EGO = path.resolve(__dirname, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py");
const SHOTS = process.env.NODE_SHAPES_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Connection dots are off by default; the dots are what this spec measures.
const SHOW_PORTS_KEY = "psyneuview.graph.showPorts";

// The octagon's corner cut, as a share of the half-extent (tan 22.5°).
const K = Math.tan(Math.PI / 8);

async function openModel(page: Page, file: string, label: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await expect(page.getByText(label).first()).toBeVisible({ timeout: 30_000 });
}

/** Models open flattened (#48); the nested view is where EM is a composition. */
async function nestedView(page: Page) {
  const viewSelect = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
    .first();
  await expect(viewSelect).toBeVisible({ timeout: 30_000 });
  const values = await viewSelect.locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).value),
  );
  const outer = values.find((v) => !v.startsWith("__"))!;
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/model/load") && r.request().method() === "POST"),
    viewSelect.selectOption(outer),
  ]);
  await expect(page.locator(".react-flow__edge").first()).toBeVisible({ timeout: 30_000 });
}

/** A canvas node's box in graph coordinates, from its transform and size. */
async function nodeBox(page: Page, name: string) {
  return canvasNode(page, name).first().evaluate((el) => {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((el as HTMLElement).style.transform);
    const x = m ? parseFloat(m[1]) : 0;
    const y = m ? parseFloat(m[2]) : 0;
    return { x, y, w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight };
  });
}

/** The floating connection dots whose title starts with `prefix`, in graph coordinates. */
async function dotsFor(page: Page, prefix: string) {
  return page.locator('[data-testid="edge-port-dot"]').evaluateAll((dots, prefix) =>
    dots.flatMap((d) => {
      const title = d.querySelector("[title]")?.getAttribute("title") ?? "";
      if (!title.startsWith(prefix)) return [];
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((d as HTMLElement).style.transform);
      return m ? [{ x: parseFloat(m[1]), y: parseFloat(m[2]), title }] : [];
    }),
  prefix);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.getByTestId("graph-canvas").screenshot({ path: path.join(SHOTS, name) });
}

/** For review: the node by itself, at rest and selected. */
async function nodeShots(page: Page, name: string, file: string) {
  if (!SHOTS) return;
  const node = canvasNode(page, name).first();
  await node.screenshot({ path: path.join(SHOTS, `${file}-node.png`) });
  await node.click();
  await node.screenshot({ path: path.join(SHOTS, `${file}-node-selected.png`) });
  await page.keyboard.press("Escape");
}

test.describe("node shapes follow show_graph (#192, #193)", { tag: "@ci" }, () => {
  // Crisp close-ups for review; CI renders at the usual scale.
  test.use({ deviceScaleFactor: SHOTS ? 3 : 1 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, "true");
    }, SHOW_PORTS_KEY);
  });

  test("EGO: EM opens collapsed as a rectangle; inside it COMBINED SCORES is an octagon that says why", async ({ page }) => {
    await openModel(page, EGO, "Giallanza2024_ego_study2.py");
    await nestedView(page);
    await closePalette(page);
    await fitGraph(page);

    // The nested view opens with EM folded: a rectangle, with its edges,
    // their dots on its sides, and the Expand button.
    const em = canvasNode(page, "EM").first();
    await expect(em).toBeVisible({ timeout: 30_000 });
    const emBody = em.locator("[data-node-shape]");
    await expect(emBody).toHaveAttribute("data-node-shape", "rectangle");
    await expect(emBody).toHaveAttribute("title", /^Collapsed composition: .*rectangle/);
    await expect(emBody).toHaveCSS("border-top-left-radius", "0px");
    await expect(emBody.getByTestId("node-name")).toHaveText("EM");
    await expect(page.locator('.react-flow__edge[data-id*="EM Input_CIM["]')).toHaveCount(3);
    await expect(page.locator('.react-flow__edge[data-id*="EM Output_CIM["]')).toHaveCount(1);
    const emBox = await nodeBox(page, "EM");
    const emDots = [...(await dotsFor(page, "input — EM")), ...(await dotsFor(page, "output — EM"))];
    expect(emDots.length).toBe(4);
    for (const d of emDots) {
      const toSide = Math.min(
        Math.abs(d.x - emBox.x), Math.abs(d.x - (emBox.x + emBox.w)),
        Math.abs(d.y - emBox.y), Math.abs(d.y - (emBox.y + emBox.h)),
      );
      expect(toSide, `${d.title} sits on the rectangle's side`).toBeLessThan(3);
      expect(d.x).toBeGreaterThan(emBox.x - 3);
      expect(d.x).toBeLessThan(emBox.x + emBox.w + 3);
      expect(d.y).toBeGreaterThan(emBox.y - 3);
      expect(d.y).toBeLessThan(emBox.y + emBox.h + 3);
    }

    // The legend names the shapes the model draws, and only those.
    await page.getByTestId("gsc-legend-show").click();
    await expect(page.getByTestId("legend-shape-rectangle")).toContainText("collapsed composition");
    await expect(page.getByTestId("legend-shape-octagon")).toHaveCount(0);
    await shot(page, "ego-collapsed-ours.png");
    await nodeShots(page, "EM", "em-rectangle");

    // Expand EM: inside, the one feedback sender is the one octagon, and
    // hovering it explains the shape.
    await emBody.getByRole("button", { name: "Expand composition EM" }).click();
    const scores = canvasNode(page, "COMBINED SCORES").first();
    await expect(scores).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-node-shape="rectangle"]')).toHaveCount(0);
    const scoresBody = scores.locator("[data-node-shape]");
    await expect(scoresBody).toHaveAttribute("data-node-shape", "octagon");
    await expect(scoresBody).toHaveAttribute("title", /^Feedback sender: .*octagon/);
    await expect(scoresBody.locator('[data-testid="node-shape-outline"] polygon[data-outline="outer"]')).toHaveCount(1);
    await expect(page.locator('[data-node-shape="octagon"]')).toHaveCount(1);
    // The box has no CSS border of its own: the drawn octagon is the outline.
    await expect(scoresBody).toHaveCSS("border-top-width", "0px");

    // Its edges end on the octagon, not on the oval it replaced: every dot is
    // within a few pixels of the octagon's outline (|x|≤1, |y|≤1, |x|+|y|≤1+K
    // in half-extent units).
    await fitGraph(page);
    const box = await nodeBox(page, "COMBINED SCORES");
    const dots = [...(await dotsFor(page, "output — COMBINED SCORES")), ...(await dotsFor(page, "input — COMBINED SCORES"))];
    expect(dots.length, "COMBINED SCORES has edges with connection dots").toBeGreaterThan(0);
    for (const d of dots) {
      const nx = Math.abs(d.x - (box.x + box.w / 2)) / (box.w / 2);
      const ny = Math.abs(d.y - (box.y + box.h / 2)) / (box.h / 2);
      const r = Math.max(nx, ny, (nx + ny) / (1 + K));
      expect(Math.abs(r - 1) * Math.min(box.w, box.h) / 2, `${d.title} sits on the octagon`).toBeLessThan(3);
    }
    await expect(page.getByTestId("legend-shape-octagon")).toContainText("feedback sender");
    await expect(page.getByTestId("legend-shape-rectangle")).toHaveCount(0);
    await shot(page, "ego-nested-ours.png");
    await nodeShots(page, "COMBINED SCORES", "combined-scores-octagon");

    // Collapse brings the rectangle back.
    await page.getByRole("button", { name: "Collapse composition EM" }).click();
    await expect(canvasNode(page, "EM").first().locator('[data-node-shape="rectangle"]')).toBeVisible({ timeout: 30_000 });
  });

  test("a controller is a double octagon", async ({ page }) => {
    await openModel(page, fixturePath("with_controller"), "with_controller.py");
    await closePalette(page);
    const ctrl = canvasNode(page, "ctrl").first();
    await expect(ctrl).toBeVisible({ timeout: 30_000 });
    const body = ctrl.locator("[data-node-shape]");
    await expect(body).toHaveAttribute("data-node-shape", "doubleoctagon");
    await expect(body).toHaveAttribute("title", /^Controller: .*double octagon/);
    await expect(body.locator('polygon[data-outline="outer"]')).toHaveCount(1);
    await expect(body.locator('polygon[data-outline="inner"]')).toHaveCount(1);
    // The plain mechanism beside it is still an oval, drawn by its CSS border.
    const driven = canvasNode(page, "driven").first().locator("[data-node-shape]");
    await expect(driven).toHaveAttribute("data-node-shape", "oval");
    await expect(driven).toHaveCSS("border-top-left-radius", /%/);
    await fitGraph(page);
    await shot(page, "with-controller-ours.png");
    await nodeShots(page, "ctrl", "ctrl-doubleoctagon");
  });
});
