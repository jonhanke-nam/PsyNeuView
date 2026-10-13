/**
 * Changes since save (#1348): what the unsaved changes are, against the file
 * on disk now.
 *
 * Three promises, each against a real file in a temp folder:
 *   - edit, click the orange dot: the change is shown, with its line counts;
 *   - save, open it from History: "No changes";
 *   - change the file outside PsyNeuView: the dialog says so at the top.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

/** One line changed and one added: "2 lines added, 1 removed". */
const EDITED = BASE.replace("function=pnl.Logistic()", "function=pnl.Logistic(gain=2.5)") + "# a note added in PsyNeuView\n";

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "changes1348-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

async function replaceBuffer(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

test.describe("Changes since save (#1348)", () => {
  test("edit, then the orange dot shows the change and its counts", async ({ page }) => {
    test.setTimeout(180_000);
    expect(BASE).toContain("function=pnl.Logistic()");
    const model = scratchModel();
    await openFromPath(page, model);
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);

    await replaceBuffer(page, EDITED);

    const dot = page.getByTestId("unsaved-dot");
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute("title", "Unsaved changes: click to see them");
    await dot.click();

    const dialog = page.getByTestId("changes-since-save");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("changes-since-save-summary")).toContainText("2 lines added, 1 removed", {
      timeout: 15_000,
    });
    await expect(dialog).toContainText("gain=2.5");
    await expect(dialog).toContainText("# a note added in PsyNeuView");
    // Nothing changed outside PsyNeuView, so no such notice.
    await expect(dialog.getByTestId("changes-since-save-outside")).toHaveCount(0);
    // Looking is all it does: the file is untouched.
    expect(readFileSync(model, "utf8")).toBe(BASE);

    await dialog.getByTestId("changes-since-save-close").click();
    await expect(dialog).toHaveCount(0);
  });

  test("save, then History's Changes since save says No changes", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);

    await replaceBuffer(page, EDITED);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled({ timeout: 30_000 });
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);

    await page.getByTestId("history-button").click();
    await page.getByTestId("history-changes-since-save").click();
    await expect(page.getByTestId("history-panel")).toHaveCount(0);

    const dialog = page.getByTestId("changes-since-save");
    await expect(dialog.getByTestId("changes-since-save-summary")).toContainText("No changes", { timeout: 15_000 });
    await expect(dialog.getByTestId("line-diff")).toHaveCount(0);
    await expect(dialog.getByTestId("changes-since-save-outside")).toHaveCount(0);
  });

  test("a change made outside PsyNeuView is called out at the top", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);

    await replaceBuffer(page, EDITED);
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();

    // PyCharm saves underneath the unsaved edit; keep ours when asked (#926).
    const outside = `${BASE}# saved in PyCharm\n`;
    writeFileSync(model, outside);
    await expect(page.getByTestId("external-change-modal")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("external-change-keep-mine").click();

    await page.getByTestId("unsaved-dot").click();
    const dialog = page.getByTestId("changes-since-save");
    await expect(dialog.getByTestId("changes-since-save-outside")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId("changes-since-save-outside")).toContainText(
      "changed outside PsyNeuView",
    );
    // Compared against the file as it is now: PyCharm's line is on the disk side.
    await expect(dialog).toContainText("# saved in PyCharm");
    await expect(dialog.getByTestId("changes-since-save-summary")).toContainText("2 lines added, 2 removed");
    // Still only looking.
    expect(readFileSync(model, "utf8")).toBe(outside);
  });
});
