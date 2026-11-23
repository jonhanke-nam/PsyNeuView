/**
 * The Inspector's legend shows only while something is customized (#109).
 *
 * "customized · at default · ↺ reset on hover" explains the purple bar on a
 * customized parameter's row. A node with every parameter at its default has
 * no purple bar, so the legend has nothing to explain and stays out of the
 * way; a node with one shows it.
 */
import { mutatingTest as test, expect, clickCanvasNode } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(here, "..", "..", "backend", "reference_models", "stroop_reference_basic.py");

test("the legend shows for a customized node and not for one at its defaults", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

  const legend = page.getByTestId("inspector-legend");
  const customized = page.locator('[data-pnv-customized="true"]');

  // word_input sets Linear(offset=1): a customized row, so the legend explains it.
  await clickCanvasNode(page, "word_input");
  await page.getByTestId("tab-inspector").click();
  await expect(customized.first()).toBeVisible();
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("customized");

  // color_input leaves everything at its default: no purple bar, no legend.
  await clickCanvasNode(page, "color_input");
  await expect(page.getByText("color_input", { exact: true }).first()).toBeVisible();
  await expect(customized).toHaveCount(0);
  await expect(legend).toBeHidden();
});
