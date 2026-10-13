/**
 * Tutorial capture + verification — "Live editing" (#669, #662).
 *
 * Demonstrates the edit -> re-run loop: run a model, change a parameter, and
 * run again without reloading — the model, its inputs, and the layout persist
 * across the edit.
 *
 * Read-only w.r.t. backend reset.
 */
// #1010: mutatingTest, not readOnlyTest. This spec loads "Stroop — Basic",
// which code.tutorial replaces wholesale (nodes alpha/beta) and saves earlier in
// the alphabetical run order. Reopening used to overwrite the working copy every
// time, so this spec's isolation was being supplied by a product bug; now that
// reopening preserves edits, it has to reset for itself. The fixture resets
// *before* each test, so it belongs on the spec that needs the clean slate.
import { mutatingTest as test, expect, clickCanvasNode } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/live",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

async function findInputByValue(page: import("@playwright/test").Page, value: string) {
  const all = page.locator("input");
  const n = await all.count();
  for (let k = 0; k < n; k++) {
    if ((await all.nth(k).inputValue().catch(() => "")) === value) return all.nth(k);
  }
  return null;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: Live editing", () => {
  test("edit a parameter and re-run without reloading", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop — Basic").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    // First run.
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByTestId("run-panel").getByRole("button", { name: /Run Model/ }).click();
    await expect(page.getByTestId("run-panel").getByText(/Results \(\d+ trials?\)/)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("01-first-run.png") });

    // Edit a parameter (Logistic gain on color_hidden) — no reload.
    // Both hazards this used to guard against by hand — the palette covering
    // the node, and the run's results panel shrinking the canvas until the
    // node leaves the viewport — now live in clickCanvasNode (#999, #160).
    await clickCanvasNode(page, "color_hidden");
    // After a run the bottom panel is on the Run tab; bring the Inspector forward.
    await page.getByText("Inspector", { exact: true }).first().click();
    await expect(page.getByText("gain", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    const gain = await findInputByValue(page, "1.1");
    expect(gain, "gain input should be present").not.toBeNull();
    await gain!.click();
    await gain!.fill("2.5");
    await gain!.press("Enter");
    await expect(page.locator(".cm-content")).toContainText(/gain\s*=\s*2\.5/, { timeout: 10000 });

    // Re-run with the edit applied — the model still runs, inputs persisted.
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByTestId("run-panel").getByRole("button", { name: /Run Model/ }).click();
    await expect(page.getByTestId("run-panel").getByText(/Results \(\d+ trials?\)/)).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("02-rerun-after-edit.png") });
  });
});
