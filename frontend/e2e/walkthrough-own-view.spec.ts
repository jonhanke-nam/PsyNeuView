/**
 * A walkthrough opens in the view it was written for (#428).
 *
 * Once every open honoured the view menu (#428), EGO's walkthrough opened its
 * model flattened, the page's default: EM was a frame there, not a node, and
 * the "Select EM" step said "EM isn't in the model you have open". Each
 * walkthrough now names its view (`view:` in its YAML) and starts in it.
 *
 * This starts EGO's walkthrough with the flattened view selected (EGO open from
 * its path, so the view menu shows), checks the graph switches to nested as it
 * starts and stays nested when the walkthrough opens its model, and drives the
 * steps through "Select EM" (its node there, folded), then checks the learner's
 * flattened view comes back when the walkthrough ends.
 */
import { mutatingTest as test, expect, closePalette, showCourse } from "./test-base";
import { loadWalkthrough, runWalkthrough } from "./tourDriver";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EGO = path.resolve(__dirname, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py");

const ego = loadWalkthrough("ego");
const memory = ego.steps.findIndex((s) => s.id === "the-memory");

test.use({ viewport: { width: 1600, height: 1000 } });
// The course is hidden by default (#136); EGO's walkthrough is in it.
test.beforeEach(async ({ page }) => showCourse(page));

/** The view menu: Flatten (all compositions), PyTorch, the compositions. */
const viewMenu = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();
const emFolded = (page: Page) => page.getByTestId("graph-canvas").locator('.react-flow__node-mechanismNode[data-id="EM"]');
const emFrame = (page: Page) =>
  page.getByTestId("graph-canvas").locator('.react-flow__node-compositionNode[data-id="EM"], .react-flow__node-compositionNode[data-id="cluster::EM"]');

test.describe("a walkthrough opens in its own view (#428)", { tag: "@ci" }, () => {
  test("EGO's, started flattened, switches to nested and its Select EM step completes", async ({ page }) => {
    test.setTimeout(240_000);
    expect(ego.view).toBe("nested");
    expect(memory).toBeGreaterThan(0);

    await page.goto("/");
    await closePalette(page);
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(EGO);
    await prompt.press("Enter");
    await expect(viewMenu(page)).toHaveValue("__flat__", { timeout: 60_000 });
    await expect(emFrame(page)).toBeVisible({ timeout: 60_000 });

    // Starting it redraws the model on screen nested (EGO's teaches opening
    // its own model, so none opens on start).
    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-ego").click();
    // A model is open, so it asks first; this window it is.
    await page.getByTestId("tutorial-choice").getByRole("button", { name: "Replace what's in this window" }).click();
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
    await expect(viewMenu(page)).not.toHaveValue("__flat__", { timeout: 60_000 });
    await expect(emFolded(page)).toBeVisible({ timeout: 60_000 });

    // Through Select EM, and the step after it, so EM's is seen to complete.
    await runWalkthrough(page, { ...ego, steps: ego.steps.slice(0, memory + 2) }, async (step) => {
      if (step.id !== "the-memory") return;
      await expect(page.getByTestId("tour-missing-anchor")).toHaveCount(0);
      await expect(viewMenu(page)).not.toHaveValue("__flat__");
      await expect(emFolded(page)).toBeVisible();
    });

    // Ended, the learner's flattened view comes back.
    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toHaveCount(0);
    await expect(viewMenu(page)).toHaveValue("__flat__", { timeout: 60_000 });
  });
});
