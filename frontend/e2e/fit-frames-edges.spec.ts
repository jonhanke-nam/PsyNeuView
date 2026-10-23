/**
 * Fit shows the whole graph, and show_graph's courses are drawn smoothly
 * (#52, #62, #63).
 *
 * After Fit, every node and every edge's drawn course lies inside the canvas,
 * at the normal app layout's size and at a wide one: nothing is ever cut off.
 * React Flow's own fit framed nodes only (#52), and the minimum zoom stopped a
 * large model from fitting a normal-size canvas (#62). In Like show_graph,
 * no course turns back on itself: redrawing show_graph's curves through
 * unevenly spaced points made spikes (#63).
 */
import { mutatingTest as test, expect } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { sharpestTurn } from "../src/utils/curveSmoothness";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", "..", "backend", "reference_models");
const EGO = "Giallanza2024_ego_study2.py";
const ALL_MODELS = [
  "Botvinick_conflict_monitoring_model.py",
  "Cohen_Huston1994_horse_race.py",
  "Cohen_Huston1994.py",
  EGO,
  "GilzenratModel.py",
  "Kalanthroff_PCTC_2018.py",
  "MontagueDayanSejnowski96.py",
  "Nieuwenhuis2005Model.py",
  "stroop_reference_basic.py",
  "stroop_reference_with_lc.py",
];

// A spike turns back by close to 180°. A smooth course, and the short
// straight lead-in from a node's oval, turn far less.
const MAX_TURN = 120;

const SIZES = [
  { name: "the normal layout", viewport: { width: 1280, height: 800 }, closePanel: false },
  { name: "a wide canvas", viewport: { width: 2600, height: 1300 }, closePanel: true },
];

async function openLikeShowGraph(page: Page, file: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(MODELS_DIR, file));
  await prompt.press("Enter");
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  const layout = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Like show_graph" }) })
    .first();
  if ((await layout.inputValue()) !== "showgraph") {
    // Wait for show_graph's description, so its courses are what gets
    // fitted (until then the Layered layout stands in).
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/show-graph") && r.ok(), { timeout: 60000 }),
      layout.selectOption({ label: "Like show_graph" }),
    ]);
  }
  // The relayout lands a moment after the response.
  await page.waitForTimeout(1500);
}

/** What lies outside the canvas after Fit, and each course's sharpest turn. */
async function afterFit(page: Page) {
  const canvas = page.getByTestId("graph-canvas");
  await canvas.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(300);
  const pane = (await canvas.locator(".react-flow").boundingBox())!;
  const drawn = await canvas
    .locator(".react-flow__node, .react-flow__edge-path")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.closest("[data-id]")?.getAttribute("data-id") ?? "",
          d: el.getAttribute("d"),
          x0: r.left, y0: r.top, x1: r.right, y1: r.bottom,
        };
      }),
    );
  const outside = drawn
    .filter((r) => r.x0 < pane.x - 1 || r.y0 < pane.y - 1 || r.x1 > pane.x + pane.width + 1 || r.y1 > pane.y + pane.height + 1)
    .map((r) => r.id);
  const spiky = drawn
    .filter((r) => r.d && sharpestTurn(r.d) > MAX_TURN)
    .map((r) => `${r.id} (${Math.round(sharpestTurn(r.d!))}°)`);
  return { outside, spiky };
}

async function check(page: Page, files: string[], size: (typeof SIZES)[number]) {
  await page.setViewportSize(size.viewport);
  await page.goto("/");
  if (size.closePanel) {
    await page.getByText("Components", { exact: true }).locator("xpath=..").getByRole("button").last().click();
  }
  for (const file of files) {
    await openLikeShowGraph(page, file);
    const { outside, spiky } = await afterFit(page);
    expect(outside, `${file}, ${size.name}: cut off after Fit`).toEqual([]);
    expect(spiky, `${file}, ${size.name}: courses with spikes`).toEqual([]);
  }
}

for (const size of SIZES) {
  test(`EGO: after Fit nothing is cut off and no course has a spike, in ${size.name}`, { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(120000);
    await check(page, [EGO], size);
  });
}

// Every bundled model: the full suite, before a release.
for (const size of SIZES) {
  test(`every reference model: after Fit nothing is cut off and no course has a spike, in ${size.name}`, async ({ page }) => {
    test.setTimeout(600000);
    await check(page, ALL_MODELS, size);
  });
}
