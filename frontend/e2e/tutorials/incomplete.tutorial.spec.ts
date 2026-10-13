/**
 * Tutorial capture + verification — "Incomplete / broken state handling"
 * (#671, under #662; incomplete-state umbrella #185).
 *
 * Edits a model into an incomplete state — a projection to an undefined node —
 * and verifies PsyNeuView degrades gracefully: it renders what it can (the
 * defined node), draws a phantom endpoint + dangling projection for the missing
 * piece, and surfaces the problem, instead of failing.
 *
 * Read-only w.r.t. backend reset.
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/incomplete",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

// A model whose projection references an undefined node `b` — incomplete.
const INCOMPLETE_SOURCE = [
  "import psyneulink as pnl",
  "",
  "a = pnl.TransferMechanism(name='a')",
  "comp = pnl.Composition(name='incomplete_comp')",
  "comp.add_node(a)",
  "",
  "# b was never defined — this projection dangles:",
  "proj_ab = pnl.MappingProjection(sender=a, receiver=b)",
].join("\n");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: Incomplete / broken state handling", () => {
  test("an incomplete model renders gracefully with a phantom endpoint", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop — Basic").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    // Edit into an incomplete state and save.
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(INCOMPLETE_SOURCE);
    await page.keyboard.press("ControlOrMeta+s");

    // Graceful degradation: the defined node renders, the missing endpoint is a
    // phantom dangling node, and the problem is surfaced — app stays usable.
    await expect(page.locator('.react-flow__node[data-id="a"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.react-flow__node[data-id^="__dangling__"]')).toBeVisible();
    await expect(page.getByText(/dangling projection/i).first()).toBeVisible();

    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("01-incomplete.png") });
  });
});
