/**
 * Tutorial capture + verification — "Running a model" (#664, under #662).
 *
 * Follows the executable-spec pattern established by loading.tutorial.spec.ts:
 * it both verifies the run workflow and captures the screenshots embedded in
 * `docs/tutorials/02-running-a-model.md`.
 *
 * Scope: the deterministic reference models (Stroop-basic, Stroop+LC), which
 * run through PsyNeuView's executor via `Composition.run`. EGO is intentionally
 * excluded — it runs via learning / PyTorch (`.learn()`), a different path that
 * the executor doesn't yet drive (#321/#363); the doc says so.
 *
 * The numeric guarantee ("output matches stock PsyNeuLink") is proven by the
 * backend equivalence tests (#580/#653); here we assert the workflow completes
 * and produces per-trial results.
 *
 * Read-only: loads + runs but never resets backend state, so it runs against
 * any backend (no PSYNEWVIEW_TEST_MODE required).
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/running",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

const MODELS = [
  { key: "stroop-basic", label: "Stroop — Basic" },
  { key: "stroop-lc", label: "Stroop — with Locus Coeruleus (LC)" },
];

test.use({ viewport: { width: 1600, height: 1000 } });

async function loadAndOpenRun(page: import("@playwright/test").Page, label: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText(label).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: /Run Model/ })).toBeVisible();
}

test.describe("Tutorial: Running a model", () => {
  test("the Run tab shows the inputs grid and a Run Model button", async ({ page }) => {
    await loadAndOpenRun(page, MODELS[0].label);
    const panel = page.getByTestId("run-panel");
    await expect(panel.getByText(/Group by/)).toBeVisible();
    await page.screenshot({ path: shot("01-run-tab.png") });
  });

  for (const m of MODELS) {
    test(`runs "${m.key}" and shows per-trial results`, async ({ page }) => {
      await loadAndOpenRun(page, m.label);
      const panel = page.getByTestId("run-panel");

      await panel.getByRole("button", { name: /Run Model/ }).click();

      // Guarantee: a results section with per-trial output appears, no error.
      await expect(panel.getByText(/Results \(\d+ trials?\)/)).toBeVisible({ timeout: 30000 });
      await expect(panel.getByText(/Per-trial values/)).toBeVisible();
      await expect(page.getByText(/not aligned|Traceback|model error/i)).toHaveCount(0);

      await page.waitForTimeout(500);
      await page.screenshot({ path: shot(`results-${m.key}.png`) });
      // Focused capture of the Run panel so per-trial output is legible.
      await panel.getByText(/Results \(\d+ trials?\)/).scrollIntoViewIfNeeded();
      await panel.screenshot({ path: shot(`results-${m.key}-panel.png`) });
    });
  }
});
