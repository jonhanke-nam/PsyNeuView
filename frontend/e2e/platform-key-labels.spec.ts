/**
 * Tooltips name the keys of the platform the app runs on (#409).
 *
 * The Undo and Redo buttons said "⌘Z" and "⌘⇧Z" everywhere, and Save said
 * "Ctrl+S" everywhere, so one platform or the other always read the wrong
 * key. They now read the shortcut registry, so the test browser (which
 * reports the real platform, #402) sees ⌘Z on a Mac and Ctrl+Z on Linux CI.
 *
 * The edit is recorded through the automation hook (`window.__pnvUndoTest`),
 * as undo-notices.spec.ts does.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";
import { modLabel, modShiftLabel } from "./hostPlatform";

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

test.describe("Key names in tooltips follow the platform (#409)", { tag: "@ci" }, () => {
  test("Undo, Redo and Save name this machine's keys", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "keys409-"));
    const model = path.join(dir, "two_mech_projection.py");
    writeFileSync(model, BASE);

    await page.goto("/");
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(model);
    await prompt.press("Enter");
    await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("undo-button")).toBeDisabled({ timeout: 10_000 });

    await page.evaluate((base) => {
      (window as any).__pnvUndoTest.recordCodeEdit(`${base}# edit 1\n`, "Edit 1");
    }, BASE);

    // ⌘Z on a Mac, Ctrl+Z on Linux CI.
    const undo = page.getByTestId("undo-button");
    await expect(undo).toHaveAttribute("title", `Undo: Edit 1 (${modLabel("z")})`);
    await expect(page.getByTestId("toolbar-save")).toHaveAttribute(
      "title",
      `Save changes to the current file (${modLabel("s")})`
    );

    await undo.click();
    await expect(page.getByTestId("redo-button")).toHaveAttribute("title", `Redo: Edit 1 (${modShiftLabel("z")})`);
  });
});
