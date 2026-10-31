/**
 * A course walkthrough always ends up on its own model (#1392).
 *
 * The course walkthroughs teach opening the model, in a step of their own, so
 * they don't open it on start. Started with another model open, a learner who
 * skipped that step was left on "Select STATE" with Stroop on the canvas, and
 * the PsyNeuLink Library's EGO (the obvious pick in the Open menu) also passed
 * the step, though it is not the Coffee Shop demo the walkthrough is written for.
 */
import { mutatingTest as test, expect, showCourse } from "../test-base";
import type { Page } from "@playwright/test";

const OTHER = "Stroop — Basic";
const EGO = "EGO Coffee Shop";

test.use({ viewport: { width: 1600, height: 1000 } });

// The course is hidden by default (#136); this spec needs it in the menu.
test.beforeEach(async ({ page }) => showCourse(page));

async function openFromMenu(page: Page, label: string) {
  if (!(await page.getByTestId("open-menu-list").isVisible())) await page.getByTestId("open-menu").click();
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 60_000 });
}

async function startEgo(page: Page) {
  await page.getByTestId("walkthrough-menu").click();
  await page.getByTestId("walkthrough-ego").click();
  await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
}

const stateNode = (page: Page) => page.locator('.react-flow__node[data-id="STATE"]');

test.describe("Course walkthroughs open their model", () => {
  test("skipping the open step opens the walkthrough's model", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await openFromMenu(page, OTHER);
    await startEgo(page);

    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-bar")).toContainText("step 2 of");
    await expect(stateNode(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("tour-missing-anchor")).toHaveCount(0);
  });

  test("the ring points at the model's own entry, and another EGO doesn't pass the step", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await openFromMenu(page, OTHER);
    await startEgo(page);

    // With the Open menu open, the ring is on the Coffee Shop demo's entry
    // (or its folded section's header), not on the Open button.
    await page.getByTestId("open-menu").click();
    const ring = page.getByTestId("tour-highlight");
    const openButton = (await page.getByTestId("open-menu").boundingBox())!;
    await expect
      .poll(async () => {
        const r = await ring.boundingBox();
        return r ? r.y > openButton.y + openButton.height : false;
      }, { timeout: 5_000 })
      .toBe(true);

    // The Library's EGO has the demo's nodes, but it is not the demo.
    await openFromMenu(page, "Giallanza2024 EGO Study2");
    await expect(page.locator('.react-flow__node[data-id="PREDICTION"]')).toBeVisible({ timeout: 60_000 });
    // A finished step moves on 1.2 s later; give it twice that to (wrongly) do so.
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");

    // The demo itself passes it.
    await openFromMenu(page, EGO);
    await expect(page.getByTestId("tour-bar")).toContainText("step 2 of", { timeout: 30_000 });
  });
});
