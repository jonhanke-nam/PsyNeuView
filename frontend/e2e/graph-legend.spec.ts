/**
 * The graph legend opens collapsed, and Settings ▸ Appearance chooses (#7).
 *
 * A model with graph-structure conditions shows the legend. By default it opens
 * as the small Legend button; "Starts expanded" opens it unfolded; and the
 * legend's own Show/Hide still folds it for the open model either way.
 */
import { mutatingTest as test, expect, showSchedulingArrows } from "./test-base";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "fixtures", "gsc_afternodes.py");

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "legend7-"));
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
  await expect(page.getByTestId("gsc-edge-badge")).toHaveCount(3, { timeout: 30_000 });
}

async function chooseLegendStart(page: Page, value: "collapsed" | "expanded") {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-graph-legend-start").selectOption(value);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();
}

test.describe("Graph legend opening state (#7)", { tag: "@ci" }, () => {
  // Scheduling arrows start hidden (#123); this spec is about them.
  test.beforeEach(async ({ page }) => showSchedulingArrows(page));

  test("opens collapsed by default, and Show/Hide still folds it", async ({ page }) => {
    await page.goto("/");
    await openModel(page, scratchModel());
    await expect(page.getByTestId("gsc-legend-show")).toBeVisible();
    await expect(page.getByTestId("gsc-legend")).toHaveCount(0);

    await page.getByTestId("gsc-legend-show").click();
    await expect(page.getByTestId("gsc-legend")).toBeVisible();
    await page.getByTestId("gsc-legend-hide").click();
    await expect(page.getByTestId("gsc-legend-show")).toBeVisible();
  });

  test("Starts expanded opens it unfolded, now and for the next model opened", async ({ page }) => {
    await page.goto("/");
    await openModel(page, scratchModel());
    await expect(page.getByTestId("gsc-legend-show")).toBeVisible();

    await chooseLegendStart(page, "expanded");
    await expect(page.getByTestId("gsc-legend")).toBeVisible();

    await page.reload();
    await openModel(page, scratchModel());
    await expect(page.getByTestId("gsc-legend")).toBeVisible();
    await expect(page.getByTestId("setting-graph-legend-start")).toHaveCount(0);

    // Folding it doesn't change the setting: the next model opens expanded again.
    await page.getByTestId("gsc-legend-hide").click();
    await openModel(page, scratchModel());
    await expect(page.getByTestId("gsc-legend")).toBeVisible();
  });
});
