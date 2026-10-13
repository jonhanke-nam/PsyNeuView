/**
 * Run-record YAML export/import round-trip (#525).
 *
 * Loads a model, runs it (which pins a run record), exports that record as
 * YAML, and re-imports the exported file — asserting the export is genuine
 * YAML carrying the psyneuview-run/v1 payload and that importing it restores
 * the recorded inputs into the form.
 */
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import { readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

test.describe("run record YAML round-trip", { tag: "@ci" }, () => {
  test("exports YAML and re-imports it", async ({ page }) => {
    await page.goto("/");

    // Load the smallest fixture (one input node) via Open ▾ → Open from path.
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(fixturePath("single_transfer"));
    await prompt.press("Enter");
    await expect(page.getByText("single_transfer.py").first()).toBeVisible({ timeout: 30000 });

    // Open the Run tab and give the first input cell a distinctive value.
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: /Run Model/ })).toBeVisible();
    const firstCell = page.locator('input[inputmode="decimal"]').first();
    await firstCell.fill("5");

    // Run — this pins a record into "Recent runs".
    await page.getByRole("button", { name: /Run Model/ }).click();
    await expect(page.getByText(/single_transfer\b.*trial/).first()).toBeVisible({ timeout: 30000 });

    // Export the pinned record as YAML and capture the download.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "YAML", exact: true }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.run\..*\.yaml$/);
    const yamlText = readFileSync(await download.path(), "utf8");

    // It must be real YAML (block mapping, not JSON braces) carrying the payload.
    expect(yamlText).toMatch(/^format: psyneuview-run\/v1/m);
    expect(yamlText).toContain("single_transfer");
    expect(yamlText.trimStart().startsWith("{")).toBe(false);

    // Change the form so a successful import is observable, then re-import the
    // exported YAML and confirm the recorded value (5) is restored.
    await firstCell.fill("9");
    const tmpFile = path.join(tmpdir(), `pnv-525-${download.suggestedFilename()}`);
    writeFileSync(tmpFile, yamlText);
    // The Run panel's import input is the one that also accepts the YAML mime
    // type (the toolbar's Open input does not), which disambiguates it.
    await page.locator('input[accept*="application/yaml"]').setInputFiles(tmpFile);
    await expect(page.locator('input[inputmode="decimal"]').first()).toHaveValue("5");
  });
});
