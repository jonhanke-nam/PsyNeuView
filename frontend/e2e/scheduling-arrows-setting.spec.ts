/**
 * Settings ▸ Appearance hides scheduling-condition arrows (#53).
 *
 * PsyNeuLink's show_graph() doesn't draw graph-structure conditions, so the
 * canvas can hide their dashed arrows to match it. Shown by default; hidden,
 * the legend that explains them goes too, and the choice holds for the next
 * model opened.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "fixtures", "gsc_afternodes.py");

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arrows53-"));
  const file = path.join(dir, "gsc_afternodes.py");
  copyFileSync(FIXTURE, file);
  return file;
}

async function openModel(page: Page, model: string) {
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.react-flow__node[data-id="TARGET"]')).toBeVisible({ timeout: 60_000 });
}

test("scheduling arrows are shown by default and can be hidden (#53)", { tag: "@ci" }, async ({ page }) => {
  const arrows = page.locator(".react-flow__edge-gscEdge");
  await page.goto("/");
  await openModel(page, scratchModel());
  await expect(arrows).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByTestId("gsc-legend-show")).toBeVisible();

  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-graph-scheduling-arrows")).toHaveValue("shown");
  await page.getByTestId("setting-graph-scheduling-arrows").selectOption("hidden");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();

  // Gone at once, with the legend that explains them.
  await expect(arrows).toHaveCount(0);
  await expect(page.getByTestId("gsc-legend-show")).toHaveCount(0);

  // And still hidden for the next model opened.
  await page.reload();
  await openModel(page, scratchModel());
  await expect(page.locator(".react-flow__edge").first()).toBeVisible({ timeout: 30_000 });
  await expect(arrows).toHaveCount(0);
});
