/**
 * Fit fills the canvas (#54).
 *
 * After Fit, the drawn graph (nodes and edge courses) fills the canvas in
 * whichever direction limits it, less a small even margin, and sits centred
 * in both directions. A wide graph (EGO, Like show_graph) is limited by the
 * canvas's width, so it should span nearly all of it; the space left above
 * and below is just what the graph's shape leaves over. Fit used to pad by
 * 20% of the canvas on each axis, so a wide graph got only ~83% of the width.
 *
 * PW_FIT_SCREENSHOT_DIR, if set, saves a picture of the fitted canvas there.
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", "..", "backend", "reference_models");
const EGO = "Giallanza2024_ego_study2.py";

test("Fit: a wide graph fills the canvas's width and is centred (#54)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/");
  // Close the Components panel, for a canvas big enough to see the margins.
  await page.getByText("Components", { exact: true }).locator("xpath=..").getByRole("button").last().click();

  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(MODELS_DIR, EGO));
  await prompt.press("Enter");
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  const layout = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Like show_graph" }) })
    .first();
  if ((await layout.inputValue()) !== "showgraph") {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/show-graph") && r.ok(), { timeout: 60000 }),
      layout.selectOption({ label: "Like show_graph" }),
    ]);
  }
  await page.waitForTimeout(1500);

  await canvas.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(300);

  const pane = (await canvas.locator(".react-flow").boundingBox())!;
  const box = await canvas
    .locator(".react-flow__node, .react-flow__edge-path")
    .evaluateAll((els) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        x0 = Math.min(x0, r.left);
        y0 = Math.min(y0, r.top);
        x1 = Math.max(x1, r.right);
        y1 = Math.max(y1, r.bottom);
      }
      return { x0, y0, x1, y1 };
    });

  if (process.env.PW_FIT_SCREENSHOT_DIR) {
    await canvas.screenshot({ path: path.join(process.env.PW_FIT_SCREENSHOT_DIR, "ego-after-fit.png") });
  }

  const left = box.x0 - pane.x;
  const right = pane.x + pane.width - box.x1;
  const top = box.y0 - pane.y;
  const bottom = pane.y + pane.height - box.y1;
  const spanX = (box.x1 - box.x0) / pane.width;
  const spanY = (box.y1 - box.y0) / pane.height;
  const margins = `left ${left.toFixed(0)}, right ${right.toFixed(0)}, top ${top.toFixed(0)}, bottom ${bottom.toFixed(0)} px`;

  // Nothing cut off (#52, #62).
  expect(Math.min(left, right, top, bottom), margins).toBeGreaterThanOrEqual(-1);
  // EGO is wide: the width limits it, and it spans nearly all of it.
  expect(spanX, `width spanned; ${margins}`).toBeGreaterThan(spanY);
  expect(spanX, `width spanned; ${margins}`).toBeGreaterThanOrEqual(0.9);
  // Centred both ways (the drawn curves can stray a few px from the points
  // Fit frames, so allow 2% of the canvas).
  expect(Math.abs(left - right), margins).toBeLessThanOrEqual(pane.width * 0.02);
  expect(Math.abs(top - bottom), margins).toBeLessThanOrEqual(pane.height * 0.02);
});
