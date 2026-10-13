/**
 * Save a copy as… MDF warns about the known round-trip gaps (#83, #85).
 *
 * The model shares a mechanism between two Compositions (#83) and gives it a
 * WhenFinishedAny condition (#85), both of which an MDF round-trip loses.
 * Choosing an MDF format shows a warning for each, naming what's affected
 * and linking the upstream issue; .py shows none, and a plain model none.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";
import { openModelFromPath } from "./pnl-install";

const MODEL = `import psyneulink as pnl

shared = pnl.TransferMechanism(name="shared")
x = pnl.TransferMechanism(name="x")
y = pnl.TransferMechanism(name="y")

c1 = pnl.Composition(name="c1")
c1.add_linear_processing_pathway([x, shared])
c1.scheduler.add_condition(shared, pnl.WhenFinishedAny(x))

c2 = pnl.Composition(name="c2")
c2.add_linear_processing_pathway([shared, y])
`;

async function openSaveCopy(page: Page, model: string) {
  await openModelFromPath(page, model);
  await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });
  await page.getByTestId("toolbar-save-copy").click();
  return page.getByTestId("save-copy-dialog");
}

const formatSelect = (page: Page) => page.getByTestId("save-copy-dialog").locator("select").nth(1);

test.describe("MDF export warns about known round-trip gaps", { tag: "@ci" }, () => {
  test("a shared mechanism and a WhenFinishedAny condition are named, with their upstream issues", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "mdf-gaps-"));
    const model = path.join(dir, "shared_model.py");
    writeFileSync(model, MODEL);
    const dialog = await openSaveCopy(page, model);

    await formatSelect(page).selectOption("mdf-yaml");
    const shared = dialog.getByTestId("mdf-gap-83");
    const conditions = dialog.getByTestId("mdf-gap-85");
    await expect(shared).toBeVisible({ timeout: 30_000 });
    await expect(shared).toContainText("shared (also in c2)");
    await expect(shared.getByRole("link", { name: "jonhanke-nam/PsyNeuLink#4" })).toBeVisible();
    await expect(conditions).toContainText("shared — WhenFinishedAny: the import fails");
    await expect(conditions.getByRole("link", { name: "jonhanke-nam/PsyNeuLink#6" })).toBeVisible();

    await formatSelect(page).selectOption("py");
    await expect(dialog.getByTestId("mdf-gap-83")).toHaveCount(0);
  });

  test("a plain model gets no gap warnings", async ({ page }) => {
    const dialog = await openSaveCopy(page, fixturePath("two_mech_projection"));
    await formatSelect(page).selectOption("mdf-json");
    // Give the check time to answer, then confirm it found nothing.
    await page.waitForResponse((r) => r.url().endsWith("/api/model/mdf-gaps"));
    await expect(dialog.locator('[data-testid^="mdf-gap-"]')).toHaveCount(0);
  });
});
