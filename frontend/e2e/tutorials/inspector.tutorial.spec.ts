/**
 * Tutorial capture + verification — "Editing via the inspector" (#667, #662).
 *
 * Selects a node, edits one of its function parameters in the Inspector, and
 * verifies the change propagates to the model source in the Code Editor — the
 * canvas, inspector, and code stay in sync.
 *
 * Read-only w.r.t. backend reset (loads a reference model, edits in memory).
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
  "../../../docs/tutorials/assets/inspector",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

test.use({ viewport: { width: 1600, height: 1000 } });

// The inspector for color_hidden shows its Logistic function params; gain
// defaults to 1.1, which is unique among the visible inputs.
async function findInputByValue(page: import("@playwright/test").Page, value: string) {
  const all = page.locator("input");
  const n = await all.count();
  for (let k = 0; k < n; k++) {
    if ((await all.nth(k).inputValue().catch(() => "")) === value) return all.nth(k);
  }
  return null;
}

test.describe("Tutorial: Editing via the inspector", () => {
  test("editing a node's parameter updates the model source", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop — Basic").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    // Select a node — the Inspector shows its parameters. clickCanvasNode
    // closes the palette (which overlays the canvas and swallowed the click
    // in #160) and fits the graph first. This spec only ever had the first
    // guard; missing the second is what made #999 look like a flake.
    await clickCanvasNode(page, "color_hidden");
    await expect(page.getByText("gain", { exact: true })).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("01-inspector-selected.png") });

    // Edit the Logistic gain from its default (1.1) to 2.5.
    const gain = await findInputByValue(page, "1.1");
    expect(gain, "gain input (value 1.1) should be present").not.toBeNull();
    await gain!.click();
    await gain!.fill("2.5");
    await gain!.press("Enter");

    // Guarantee: the edit propagates to the model source.
    await expect(page.locator(".cm-content")).toContainText(/gain\s*=\s*2\.5/, { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("02-after-edit.png") });
  });
});
