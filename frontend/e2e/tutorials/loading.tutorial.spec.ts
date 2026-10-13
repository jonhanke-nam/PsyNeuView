/**
 * Tutorial capture + verification — "Loading a model" (#663, under #662).
 *
 * This is the canonical example of the *executable-spec* tutorial approach:
 * one spec that BOTH
 *   1. verifies the loading workflow works across our reference models, and
 *   2. captures the screenshots embedded in
 *      `docs/tutorials/01-loading-a-model.md`.
 *
 * Because the screenshots are produced from the live app, the doc can't drift:
 * after any UI change, re-run `npm run tutorials:capture` to refresh them. If
 * the workflow breaks, this spec fails — so the tutorial doubles as the test
 * that backs the "what you can expect" guarantee (ties to the testing
 * footprint, #652/#653).
 *
 * Read-only: it loads models but never resets backend state, so it can run
 * against any backend (it does not require PSYNEWVIEW_TEST_MODE).
 */
// #1010: mutatingTest, not readOnlyTest. This spec loads "Stroop — Basic",
// which code.tutorial replaces wholesale (nodes alpha/beta) and saves earlier in
// the alphabetical run order. Reopening used to overwrite the working copy every
// time, so this spec's isolation was being supplied by a product bug; now that
// reopening preserves edits, it has to reset for itself. The fixture resets
// *before* each test, so it belongs on the spec that needs the clean slate.
import { mutatingTest as test, expect, canvasNode } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

// docs/tutorials/assets/loading/ at the repo root (../../../ from e2e/tutorials).
const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/loading",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

// The reference models this tutorial walks through. `expectNode` is a node the
// loaded graph must render (its React Flow data-id), proving the model is live.
const MODELS = [
  { key: "ego", label: "EGO — Giallanza et al. 2024 (Study 2)", expectNode: "STATE" },
  { key: "stroop-basic", label: "Stroop — Basic", expectNode: "color_input" },
  { key: "stroop-lc", label: "Stroop — with Locus Coeruleus (LC)", expectNode: "LC" },
];

test.use({ viewport: { width: 1600, height: 1000 } });

async function openModelMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
}

test.describe("Tutorial: Loading a model", () => {
  test("the Open menu offers every model source", async ({ page }) => {
    await page.goto("/");
    await page.screenshot({ path: shot("01-initial.png") });

    await openModelMenu(page);
    await page.screenshot({ path: shot("02-open-menu.png") });

    // Guarantee: every bundled reference model is offered in the menu.
    for (const m of MODELS) {
      await expect(page.getByText(m.label)).toBeVisible();
    }
  });

  for (const m of MODELS) {
    test(`loads "${m.key}" and renders its graph`, async ({ page }) => {
      // Heavy models (EGO's nested EMComposition) can exceed the default 30s
      // per-test timeout on CI; test.slow() triples it to 90s so the 60s
      // expect() waits aren't capped. De-flake (#818/#662).
      test.slow();
      await page.goto("/");
      await openModelMenu(page);

      const loaded = page.waitForResponse(
        (r) => r.url().includes("/api/reference-models/load") && r.ok(),
        // EGO is heavy (nested EMComposition + PsyNeuLink import), so the load
        // can exceed the default timeout under CI load. De-flake (#818/#662).
        { timeout: 60000 },
      );
      await page.getByText(m.label).click();
      await loaded;

      // Guarantee: the graph renders, including a known node from the model.
      await expect(
        page.locator(".react-flow__node").first(),
      ).toBeVisible({ timeout: 60000 });
      // canvasNode matches the exact name or name + "-<n>" (see test-base):
      // ids pick up a session-counter suffix once several models have loaded
      // in one run.
      await expect(canvasNode(page, m.expectNode).first()).toBeVisible({ timeout: 60000 });
      expect(await page.locator(".react-flow__node").count()).toBeGreaterThan(0);

      await page.waitForTimeout(800); // let layout settle before the capture
      await page.screenshot({ path: shot(`loaded-${m.key}.png`) });
    });
  }
});
