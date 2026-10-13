/**
 * Tutorial capture + verification — "Stepping with the debugger" (#666, #662).
 *
 * Runs a model, then exercises the trace stepper and the Run State panel.
 *
 * IMPORTANT source dependency: the fine-grained stepping features (value pills,
 * within-trial Run State, the 'trial' step mode) are driven by PsyNeuLink's
 * `_debugger` hook. A build *with* the hook (e.g. the jonhanke-dev fork) shows
 * live per-step state; a build *without* it still steps trial-to-trial but
 * shows a "no hook" message instead of within-trial values. This spec asserts
 * the hook-backed view AND that no missing-hook message is shown, so it only
 * passes on a hook-capable build — and the doc spells out the dependency.
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/debugger",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: Stepping with the debugger", () => {
  test("a run exposes the trace stepper and live Run State", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop — Basic").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: /Run Model/ }).click();

    // The TRACE stepper appears once a run has produced steps.
    await expect(page.getByText(/TRACE/).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot("01-trace-bar.png") });

    // Value pills: node output values shown on the canvas while stepping.
    await page.getByTestId("graph-canvas").screenshot({ path: shot("02-graph-values.png") });

    // Run State shows the current step's execution detail (hook-backed).
    const runStateTab = page.getByText("Run State", { exact: true });
    await runStateTab.first().click();
    await expect(page.getByText(/RUN STATE — CURRENT STEP/)).toBeVisible({ timeout: 30000 });
    // On a hook-capable build there is no "missing hook" notice.
    await expect(page.getByText(/doesn't (include|ship).*_debugger hook/i)).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("03-run-state.png") });
  });
});
