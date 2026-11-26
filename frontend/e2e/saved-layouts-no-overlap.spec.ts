/**
 * No two nodes overlap in a saved layout (#420, principle 3 of #389).
 *
 * Every bundled model opens in its saved Custom layout (the `.pnlview.json`
 * beside it), with names only and with the type and role tags on. Whatever
 * the stored positions say, the nodes as drawn never sit on top of one
 * another: the bundled sidecars are kept clear, and a saved layout whose nodes
 * do overlap is nudged apart when it is applied (utils/nodeOverlap.ts), with
 * one notice and the file left as it was.
 *
 * Nodes are compared as drawn on screen, so two nodes in different frames
 * that cover each other count too. Open composition frames are left out:
 * their members sit inside them by design, and a frame's room among its
 * neighbours is #208's (composition-expand-geometry.spec.ts).
 */
import { mutatingTest as test, expect } from "./test-base";
import type { Page } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", "..", "backend", "reference_models");
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

/**
 * The app's rule: boxes may touch, or share a border's width; more than this
 * is an overlap, and is nudged apart (utils/nodeOverlap.ts).
 */
const TOLERANCE = 4;
/**
 * The bundled layouts are held to more: no overlap at all, so no outline runs
 * into another (Kalanthroff's WORDS_INPUT and BIAS did, by a pixel, #420).
 * Half a pixel allows for rounding.
 */
const BUNDLED_TOLERANCE = 0.5;
const NODE_ELEMENTS_KEY = "psyneuview.graph.nodeElements";

const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load") && r.request().method() === "POST", {
    timeout: 60000,
  });

/** Open a model in its saved layout: the nested view, where positions are saved. */
async function openSaved(page: Page, file: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await Promise.all([loaded(page), prompt.press("Enter")]);
  // Models with nested compositions open flattened (#48); their saved layout
  // is the nested view's, under the outermost composition.
  const view = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
    .first();
  if ((await view.count()) && (await view.inputValue()) === "__flat__") {
    const outer = await view.locator('optgroup[label="Composition"] option').first().getAttribute("value");
    await Promise.all([loaded(page), view.selectOption(outer!)]);
  }
  // A model with a saved layout opens in Custom (#614).
  await expect(page.getByText(/^Layout: Custom$/)).toBeVisible({ timeout: 15000 });
  // Drawn sizes, and a nudge, settle a moment after the first paint.
  await page.waitForTimeout(800);
}

/** Pairs of drawn nodes whose boxes overlap by more than `tolerance` both ways. */
async function overlappingPairs(page: Page, tolerance = TOLERANCE): Promise<string[]> {
  const canvas = page.getByTestId("graph-canvas");
  const boxes = await canvas.locator(".react-flow__node-mechanismNode").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute("data-id") ?? "", x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    }),
  );
  // Screen pixels at the current zoom: compare in the graph's own units.
  const zoom = await canvas
    .locator(".react-flow__viewport")
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a || 1);
  const pairs: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const dx = (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) / zoom;
      const dy = (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) / zoom;
      if (dx > tolerance && dy > tolerance) pairs.push(`${a.id} / ${b.id} (${Math.round(dx)}×${Math.round(dy)})`);
    }
  }
  return pairs;
}

for (const elements of [false, true]) {
  const shown = elements ? "with the type and role tags on" : "with names only";
  test(`every reference model's saved layout: no two nodes overlap, ${shown}`, { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(600000);
    await page.addInitScript(([key, v]) => localStorage.setItem(key, v), [NODE_ELEMENTS_KEY, String(elements)]);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    const found: Record<string, string[]> = {};
    for (const file of ALL_MODELS) {
      await openSaved(page, path.join(MODELS_DIR, file));
      const pairs = await overlappingPairs(page, BUNDLED_TOLERANCE);
      if (pairs.length) found[file] = pairs;
    }
    expect(found, "nodes drawn over one another in a saved layout").toEqual({});
  });
}

test("a saved layout with two nodes on top of each other opens with them nudged apart, once, the file untouched", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120000);
  const dir = mkdtempSync(path.join(tmpdir(), "overlap420-"));
  const model = path.join(dir, "Kalanthroff_PCTC_2018.py");
  copyFileSync(path.join(MODELS_DIR, "Kalanthroff_PCTC_2018.py"), model);
  const sidecar = path.join(dir, "Kalanthroff_PCTC_2018.pnlview.json");
  const layout = JSON.parse(readFileSync(path.join(MODELS_DIR, "Kalanthroff_PCTC_2018.pnlview.json"), "utf8"));
  // BIAS saved right on top of WORDS_INPUT.
  layout.positions.bias_input = { x: layout.positions.words_input_layer.x + 20, y: layout.positions.words_input_layer.y };
  const saved = JSON.stringify(layout, null, 2);
  writeFileSync(sidecar, saved);

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await openSaved(page, model);
  expect(await overlappingPairs(page)).toEqual([]);
  // Moving BIAS clear can push it onto a neighbour, which moves on in turn:
  // the notice names BIAS first, whatever else it moved (#420, with #423's sizes).
  await expect(page.getByText(/nodes overlapped in the saved layout; moved BIAS[ ,]/)).toHaveCount(1);
  // WORDS_INPUT stays where it was saved; only BIAS moved.
  const canvas = page.getByTestId("graph-canvas");
  const words = layout.positions.words_input_layer;
  await expect(canvas.locator('.react-flow__node[data-id="WORDS_INPUT"]')).toHaveCSS(
    "transform",
    `matrix(1, 0, 0, 1, ${words.x}, ${words.y})`,
  );
  // Nothing is written until the layout is next changed.
  expect(readFileSync(sidecar, "utf8")).toBe(saved);
});
