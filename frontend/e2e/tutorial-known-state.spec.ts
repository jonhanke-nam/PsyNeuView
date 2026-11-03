/**
 * A walkthrough and other work don't collide without asking (#172): opening
 * another model during one, and starting one with something in progress.
 */
import { mutatingTest as test, expect, showCourse } from "./test-base";
import type { Page } from "@playwright/test";

const OTHER = "Hopfield Network";

// The Stroop walkthrough is in the course, which is hidden by default (#136).
test.beforeEach(async ({ page }) => showCourse(page));

async function openFromMenu(page: Page, label: string) {
  if (!(await page.getByTestId("open-menu-list").isVisible())) await page.getByTestId("open-menu").click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function startStroop(page: Page) {
  await page.getByTestId("walkthrough-menu").click();
  await page.getByTestId("walkthrough-stroop").click();
}

async function inStroopTutorial(page: Page) {
  await page.goto("/");
  await startStroop(page);
  await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 60_000 });
}


test.describe("Opening a model during a tutorial", () => {
  test("Stay here keeps the tutorial and its model", async ({ page }) => {
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    await expect(page.getByTestId("tutorial-choice")).toContainText("Hopfield Network");
    await page.screenshot({ path: process.env.TUTORIAL_SHOTS ? `${process.env.TUTORIAL_SHOTS}/1-opening-another-model.png` : undefined });
    await page.getByTestId("tutorial-choice-stay").click();
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
    await expect(page.getByText("Loaded demo: Hopfield Network")).toHaveCount(0);

    // Escape is Stay here too, and the question hides the tutorial's ring.
    await openFromMenu(page, OTHER);
    await expect(page.getByTestId("tour-highlight")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("Leave ends the tutorial and opens the model here", async ({ page }) => {
    test.setTimeout(120_000);
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    await page.getByTestId("tutorial-choice-here").click();
    await expect(page.getByTestId("tour-bar")).toHaveCount(0);
    await expect(page.getByText("Loaded demo: Hopfield Network")).toBeVisible({ timeout: 60_000 });
  });

  test("A new window opens the model, and the tutorial stays on its step", async ({ page, context }) => {
    test.setTimeout(120_000);
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    const [second] = await Promise.all([context.waitForEvent("page"), page.getByTestId("tutorial-choice-window").click()]);
    await expect(second.getByText("Loaded demo: Hopfield Network")).toBeVisible({ timeout: 60_000 });
    await expect(second.getByTestId("tour-bar")).toHaveCount(0);
    // Off the address, so reloading that window doesn't open it again.
    expect(new URL(second.url()).search).toBe("");
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
  });

  test("New Model is asked about too", async ({ page }) => {
    await inStroopTutorial(page);
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-new-model").click();
    await expect(page.getByTestId("tutorial-choice")).toContainText("a new model");
  });
});

test.describe("Starting a tutorial", () => {
  test("Nothing in progress: it starts here without asking", async ({ page }) => {
    await page.goto("/");
    await startStroop(page);
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("A bundled model with no changes doesn't count as in progress", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await openFromMenu(page, OTHER);
    await expect(page.getByText("Loaded demo: Hopfield Network")).toBeVisible({ timeout: 60_000 });
    await startStroop(page);
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("Another tutorial running: a new window keeps it here", async ({ page, context }) => {
    test.setTimeout(120_000);
    await inStroopTutorial(page);
    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-orientation-editing").click();
    await expect(page.getByTestId("tutorial-choice")).toBeVisible();
    await page.screenshot({ path: process.env.TUTORIAL_SHOTS ? `${process.env.TUTORIAL_SHOTS}/2-starting-with-work-in-progress.png` : undefined });
    const [second] = await Promise.all([context.waitForEvent("page"), page.getByTestId("tutorial-choice-window").click()]);
    await expect(second.getByTestId("tour-bar")).toContainText("step 1 of");
    expect(new URL(second.url()).search).toContain("tour=orientation-editing");
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("Replace here starts it in this window; Cancel changes nothing", async ({ page }) => {
    await inStroopTutorial(page);
    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-orientation-editing").click();
    await page.getByTestId("tutorial-choice-cancel").click();
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("Stroop");

    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-orientation-editing").click();
    await page.getByTestId("tutorial-choice-here").click();
    await expect(page.getByTestId("tour-bar")).toContainText("Editing");
  });
});
