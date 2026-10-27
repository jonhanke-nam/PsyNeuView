/**
 * Clicking the "PsyNeuLink from … · read only" tag explains it (#50).
 *
 * A PsyNeuLink Library model from a PsyNeuLink that PsyNeuView manages opens
 * read only. The code editor's banner says why, but only while the editor is
 * open; the toolbar tag is always there, so clicking it opens a short note
 * with the reason and a Save a copy as… button that opens the usual dialog.
 * Escape closes the note, as it does every overlay (#1289).
 *
 * As in own-checkout-editable.spec.ts, the Library model is the small
 * stand-in under a temporary `psyneulink/library/models/`, declared as a
 * GitHub install through `/api/test/pnl-install` and put back in `finally`.
 *
 * Screenshots land in `$SHOTS_DIR` when it is set, and are skipped otherwise.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import path from "path";
import { checkoutTree, declareInstall, openModelFromPath } from "./pnl-install";

const badge = (page: Page) => page.getByTestId("pnl-source-badge");
const note = (page: Page) => page.getByTestId("pnl-read-only-note");

test("the read-only tag explains itself and offers Save a copy as… (#50)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const { root, model } = checkoutTree("github-50");
  try {
    await declareInstall(page, "github", root);
    await openModelFromPath(page, model);
    await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });

    // A real button, so it gets the hover affordance and keyboard focus.
    await expect(badge(page)).toHaveText("PsyNeuLink from GitHub · read only");
    await expect(badge(page)).toHaveJSProperty("tagName", "BUTTON");
    await expect(note(page)).toHaveCount(0);

    // Click: the note says why, with the shared header and its ×.
    await badge(page).click();
    await expect(note(page)).toBeVisible();
    await expect(note(page).getByTestId("dialog-header")).toContainText("Why this file is read only");
    await expect(note(page)).toContainText("installed from GitHub");
    await expect(note(page)).toContainText("an update can replace it");
    await expect(note(page)).toContainText("save your own copy");
    const dir = process.env.SHOTS_DIR;
    if (dir) await page.screenshot({ path: path.join(dir, "read-only-note.png") });

    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(note(page)).toHaveCount(0);

    // Save a copy as… closes the note and opens the usual dialog.
    await badge(page).click();
    await note(page).getByRole("button", { name: "Save a copy as…" }).click();
    await expect(note(page)).toHaveCount(0);
    await expect(page.getByTestId("save-copy-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-copy-dialog")).toHaveCount(0);
  } finally {
    await declareInstall(page, null);
  }
});
