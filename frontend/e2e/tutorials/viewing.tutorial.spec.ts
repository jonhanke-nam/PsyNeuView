/**
 * Tutorial capture + verification — "Viewing options & the flat view" (#688).
 *
 * Loads EGO (a nested model: the EM composition contains many inner nodes) and
 * toggles the **Flatten** view, which inlines every nested composition into one
 * graph — the autodiff-flattened view (#216/#230). Verifies the flattened graph
 * exposes the inner nodes that were hidden inside EM while nested.
 *
 * Read-only.
 */
import { readOnlyTest as test, expect, canvasNode } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/viewing",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: Viewing options & the flat view", () => {
  test("Flatten inlines a nested composition into one graph", async ({ page }) => {
    // #810 looked like a test-timing flake — #818/#821 responded by raising the
    // expect() waits and slowing the test. The real cause was a BACKEND subprocess
    // deadlock (undrained sandbox-worker stderr) that made EGO's introspection
    // intermittently hang and 500, so the model never rendered — fixed in
    // app/services/sandbox.py. Keep a modest test budget above the 30s default as
    // defensive headroom (this test loads a real, heavy-ish model).
    test.setTimeout(90_000);

    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("EGO — Giallanza et al. 2024 (Study 2)").click();
    await expect(canvasNode(page, "EM").first()).toBeVisible({ timeout: 45000 });
    await page.waitForTimeout(800);

    const nestedCount = await page.locator(".react-flow__node").count();
    // While nested, EM's inner nodes (e.g. STATE [RETRIEVED]) are hidden inside it.
    await expect(canvasNode(page, "STATE [RETRIEVED]")).toHaveCount(0);
    await page.screenshot({ path: shot("01-nested.png") });

    // Flatten via the view selector (#717): the composition dropdown gained a
    // "Flatten (all compositions)" option (value __flat__).
    const viewSelect = page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
      .first();
    await viewSelect.selectOption("__flat__");

    // Flattened: EM's internals are now top-level nodes. Wait for the flatten to
    // take effect (node count grows past the nested count) before asserting a
    // specific inlined node — more robust than a fixed timeout.
    await expect
      .poll(() => page.locator(".react-flow__node").count(), { timeout: 30000 })
      .toBeGreaterThan(nestedCount);
    await expect(canvasNode(page, "STATE [RETRIEVED]").first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot("02-flat.png") });
  });
});
