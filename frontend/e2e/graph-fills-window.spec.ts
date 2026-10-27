/**
 * The graph fills the window by default (#110).
 *
 * With nothing remembered, a freshly opened model gets most of the window:
 * the code editor starts at about a quarter of the width (still visible), the
 * inspector tabs at about a fifth of the height, and the model is fitted to
 * the canvas. A split the person has dragged (stored in localStorage) wins.
 */
import { mutatingTest as test, expect } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(__dirname, "..", "..", "backend", "reference_models", "stroop_reference_basic.py");
const SHOTS = process.env.PNV_SHOT_DIR;

async function openModel(page: Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

test.describe("graph fills the window by default (#110)", { tag: "@ci" }, () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1000, height: 670 },
  ]) {
    test(`a fresh open gives the canvas most of the window at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await openModel(page);

      if (SHOTS) {
        const tag = process.env.PNV_SHOT_TAG ?? "after";
        await page.screenshot({ path: path.join(SHOTS, `${tag}-${viewport.width}x${viewport.height}.png`) });
      }
      const canvas = (await page.getByTestId("graph-canvas").boundingBox())!;
      const editor = (await page.getByTestId("code-editor-pane").boundingBox())!;
      // The code is still on screen, one glance away, but narrow.
      expect(editor.width).toBeGreaterThan(150);
      expect(editor.width).toBeLessThan(canvas.width / 2);
      // The canvas is the biggest thing: over half the window's area.
      expect(canvas.width * canvas.height).toBeGreaterThan(0.45 * viewport.width * viewport.height);

      // Fitted: every node lies inside the canvas, and the nodes span a good
      // share of it (not a postage stamp in a corner).
      const boxes = await page
        .getByTestId("graph-canvas")
        .locator(".react-flow__node")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
      const minX = Math.min(...boxes.map((b) => b.left));
      const maxX = Math.max(...boxes.map((b) => b.right));
      const minY = Math.min(...boxes.map((b) => b.top));
      const maxY = Math.max(...boxes.map((b) => b.bottom));
      expect(minX).toBeGreaterThanOrEqual(canvas.x - 1);
      expect(maxX).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
      expect(minY).toBeGreaterThanOrEqual(canvas.y - 1);
      expect(maxY).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
      expect(Math.max((maxX - minX) / canvas.width, (maxY - minY) / canvas.height)).toBeGreaterThan(0.4);

    });
  }

  test("a split the person chose wins over the default", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("psynewview_layout_outer_sizes", JSON.stringify([800, 640]));
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto("/");
    await openModel(page);
    const editor = (await page.getByTestId("code-editor-pane").boundingBox())!;
    expect(editor.width).toBeGreaterThan(700);
  });
});
