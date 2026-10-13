/**
 * Tutorial capture + verification — "Saving & exporting a model" (#687, #662).
 *
 * Verifies the Save flow (the toolbar Save button enables when there are unsaved
 * changes and disables once saved) and the unified "Save a copy as…" dialog,
 * which offers the .py copy plus export formats (.pnlproject, MDF YAML/JSON).
 *
 * Does NOT confirm "Save a copy as…" (that would write a new file / trigger a
 * download); it only verifies the formats are offered, then cancels.
 *
 * Read-only w.r.t. backend reset (Save overwrites the loaded working copy).
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/saving",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

test.use({ viewport: { width: 1500, height: 1000 } });

test.describe("Tutorial: Saving & exporting a model", () => {
  test("Save persists changes; Save-a-copy offers export formats", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("Stroop — Basic").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    const saveBtn = page.getByRole("button", { name: "Save", exact: true });
    // No unsaved changes yet → Save is disabled. Allow the post-load dirty state
    // to settle (it can lag the graph render on a slow CI runner) rather than
    // asserting on the default 5s window (#160).
    await expect(saveBtn).toBeDisabled({ timeout: 15000 });

    // Make an edit → Save enables.
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n# edited in the saving tutorial\n");
    await expect(saveBtn).toBeEnabled();
    await page.screenshot({ path: shot("01-unsaved-changes.png") });

    // Save → persists; the button disables again. The save round-trip can lag
    // on a loaded CI runner, so allow the same 15s settle window as the initial
    // disabled assertion above rather than the tighter 10s (#887 hardened the
    // first assertion but missed this one; it flaked on #893's gate).
    await saveBtn.click();
    await expect(saveBtn).toBeDisabled({ timeout: 15000 });

    // "Save a copy as…" — one dialog for a .py copy and export formats. The
    // formats live in a <select>, so assert on its contents (options are in the
    // DOM even while the dropdown is collapsed).
    await page.getByRole("button", { name: /Save a copy/i }).click();
    const formatSelect = page.locator("select").filter({ hasText: "MDF (YAML)" });
    await expect(formatSelect).toBeVisible({ timeout: 10000 });
    await expect(formatSelect).toContainText("PsyNeuLink source");
    await expect(formatSelect).toContainText("PsyNeuView Project");
    await expect(formatSelect).toContainText("MDF (JSON)");
    await page.screenshot({ path: shot("02-save-copy-dialog.png") });
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
