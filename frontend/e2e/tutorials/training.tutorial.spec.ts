/**
 * Tutorial capture + verification — "Training a learning model" (#689, #662).
 *
 * Training (`.learn()`) is distinct from running (`Composition.run`): it happens
 * in the Learn panel, which runs learning as a job and streams per-epoch
 * progress. This spec trains the Autodiff Feedforward demo and verifies it
 * completes with a final loss, then trains the Hebbian Learning demo — a plain
 * Composition, trained under Python — and verifies it reports weight change,
 * not a loss (#997).
 *
 * Read-only w.r.t. backend reset.
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/training",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: Training a learning model", () => {
  test("the Learn panel trains an autodiff model to completion", async ({ page }) => {
    // Real autodiff training: the first learn job spawns a one-shot worker that
    // cold-imports torch and runs several epochs, which can exceed Playwright's
    // default 30s test budget on a loaded CI runner — the actual cause of this
    // spec's flakiness (it died at exactly 30.0s mid-wait, not on a real
    // failure). Give the whole test a budget that comfortably covers a cold run.
    test.setTimeout(150_000);
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Autodiff Feedforward", { exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    // Open the Learn tab — targets, epochs, learning rate, Start Learning.
    await page.getByText("Learn", { exact: true }).first().click();
    const startBtn = page.getByRole("button", { name: /Start Learning/i });
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("01-learn-config.png") });

    // Train — runs as a job, streaming per-epoch loss.
    await startBtn.click();

    // Guarantee: training completes with a final loss. The "Training complete
    // — final loss …" banner only renders on success, so it's the reliable
    // signal; a whole-page scan for "error"/"failed" is too broad (it matches
    // incidental UI text and flaked in CI).
    await expect(page.getByText(/Training complete/i)).toBeVisible({ timeout: 120000 });
    await expect(page.getByText(/final loss/i)).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("02-training-complete.png") });
  });

  test("the Learn panel trains a Hebbian model and reports weight change", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Hebbian Learning", { exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    await page.getByText("Learn", { exact: true }).first().click();
    const startBtn = page.getByRole("button", { name: /Start Learning/i });
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    // No targets: the model learns without a teacher, and says so.
    await expect(page.getByTestId("learn-no-targets")).toBeVisible();

    await startBtn.click();
    // Guarantee: a non-autodiff model trains to completion, and what it
    // reports is labelled as weight change, not loss.
    await expect(page.getByText(/Training complete — final weight change/i)).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId("learn-metric-title")).toHaveText("Weight change by Epoch");
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("03-hebbian-weight-change.png") });
  });
});
