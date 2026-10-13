/**
 * Tutorial capture + verification — "Editing via the code editor" (#668, #662).
 *
 * The Code Editor holds the model's Python source. Editing it and pressing Save
 * (Ctrl/Cmd+S) re-parses the source and rebuilds the canvas. This spec edits the
 * source and verifies the graph updates to match.
 *
 * Read-only w.r.t. backend reset (it saves into the loaded model's working copy,
 * not the pristine reference).
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/code",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

const EDITED_SOURCE = [
  "import psyneulink as pnl",
  "",
  "alpha = pnl.TransferMechanism(name='alpha')",
  "beta = pnl.TransferMechanism(name='beta')",
  "",
  "edited_comp = pnl.Composition(name='edited_comp')",
  "edited_comp.add_linear_processing_pathway([alpha, beta])",
].join("\n");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: Editing via the code editor", () => {
  test("editing the source and saving rebuilds the canvas", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop — Basic").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("01-before.png") });

    // Edit the source, then Save to re-parse + rebuild the canvas.
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(EDITED_SOURCE);
    await page.keyboard.press("ControlOrMeta+s");

    // Guarantee: the canvas rebuilds to match the edited source.
    await expect(page.locator('.react-flow__node[data-id^="alpha"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.react-flow__node[data-id^="beta"]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("02-after.png") });
  });
});
