/**
 * No "React Flow" credit in the canvas corner; About credits it instead (#290).
 *
 * The canvas sets proOptions.hideAttribution, which React Flow's MIT licence
 * allows; its maintainers ask that projects then credit it elsewhere, which
 * Settings ▸ About does under "Built with".
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(__dirname, "..", "..", "backend", "reference_models", "stroop_reference_basic.py");

test.describe("React Flow credit (#290)", { tag: "@ci" }, () => {
  test("the canvas shows no React Flow credit after a model loads", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(MODEL);
    await prompt.press("Enter");
    await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
    const canvas = page.getByTestId("graph-canvas");
    await expect(canvas.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".react-flow__attribution")).toHaveCount(0);
  });

  test("Settings ▸ About credits React Flow, with a link", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-about").click();
    const builtWith = page.getByTestId("about-built-with");
    await expect(builtWith).toContainText("React Flow");
    await expect(builtWith).toContainText("xyflow");
    await expect(builtWith.getByRole("link", { name: "React Flow" })).toHaveAttribute("href", "https://reactflow.dev");
  });
});
