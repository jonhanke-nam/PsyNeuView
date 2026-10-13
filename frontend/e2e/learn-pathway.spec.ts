/**
 * The Learn tab trains non-autodiff learning models (#997).
 *
 * A plain Composition with learning pathways or learning mechanisms trains
 * under Python, through PsyNeuLink's own learning mechanisms, and the chart
 * says what it measures: the Hebbian demo (no target) reports weight change,
 * the TD demo its prediction error. The autodiff demo still reports a loss
 * under PyTorch, as before.
 */
import { readOnlyTest as test, expect } from "./test-base";

async function openDemoLearn(page: any, label: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText(label, { exact: true }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
  await page.getByText("Learn", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: /Start Learning/i })).toBeVisible({ timeout: 10000 });
}

/** The y values the chart drew, read from the job the panel just finished. */
async function trainAndReadValues(page: any): Promise<number[]> {
  const done = page.waitForResponse(
    (r: any) => /\/api\/jobs\/[^/]+$/.test(r.url()) && r.request().method() === "GET",
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: /Start Learning/i }).click();
  await expect(page.getByText(/Training complete/i)).toBeVisible({ timeout: 120000 });
  const snap = await (await done).json();
  return snap.result.epochLosses as number[];
}

test.describe("Learn: non-autodiff learning", { tag: "@ci" }, () => {
  test("the Hebbian demo trains under Python and charts a falling weight change", async ({ page }) => {
    test.setTimeout(150_000);
    await openDemoLearn(page, "Hebbian Learning");
    // Preloaded from the model's own target-less training set.
    await expect(page.getByTestId("learn-training-set")).toHaveValue("three_objects");
    await expect(page.getByTestId("learn-no-targets")).toBeVisible();
    await expect(page.locator("select").filter({ hasText: "Python (graph)" }).first()).toHaveValue("Python");

    const values = await trainAndReadValues(page);
    await expect(page.getByText(/final weight change/i)).toBeVisible();
    await expect(page.getByTestId("learn-metric-title")).toHaveText("Weight change by Epoch");
    await expect(page.getByTestId("learn-metric-note")).toContainText("no loss");
    expect(values.length).toBe(20);
    expect(values[values.length - 1]).toBeLessThan(values[0] / 5);
  });

  test("the TD demo charts a falling prediction error", async ({ page }) => {
    test.setTimeout(150_000);
    await openDemoLearn(page, "TD Learning");
    // The pathway's generated TARGET node is not an input grid.
    await expect(page.getByTestId("learn-input-cue-0-0")).toBeVisible();
    await expect(page.getByTestId("learn-output-value_estimate-0-7")).toHaveValue("1");
    await expect(page.locator('[data-testid^="learn-input-TARGET"]')).toHaveCount(0);

    const values = await trainAndReadValues(page);
    await expect(page.getByText(/final prediction error/i)).toBeVisible();
    await expect(page.getByTestId("learn-metric-title")).toHaveText("Prediction error by Epoch");
    expect(values[values.length - 1]).toBeLessThan(values[0] / 100);
  });

  test("the autodiff demo still trains under PyTorch and reports a loss", async ({ page }) => {
    test.setTimeout(150_000);
    await openDemoLearn(page, "Autodiff Feedforward");
    await expect(page.locator("select").filter({ hasText: "PyTorch" }).last()).toHaveValue("PyTorch");
    await trainAndReadValues(page);
    await expect(page.getByText(/final loss/i)).toBeVisible();
    await expect(page.getByTestId("learn-metric-title")).toHaveText("Loss by Epoch");
    await expect(page.getByTestId("learn-metric-note")).toHaveCount(0);
  });
});
