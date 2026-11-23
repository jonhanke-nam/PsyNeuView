/**
 * Docs pictures for saving and changes since save (#662).
 *
 * Three images in the docs were captured by hand. This recreates each view so
 * they can be taken again after the app's look changes:
 *
 *   - docs/assets/saving-autosave-and-undo/history-save-markers.png
 *     History open after two saves (docs/saving-autosave-and-undo.md);
 *   - docs/assets/saving-autosave-and-undo/revert-confirm.png
 *     the "Revert the file to the save of …" confirm (same page);
 *   - docs/assets/what-you-can-edit/changes-since-save.png
 *     Changes since save, after PyCharm saved underneath an unsaved edit
 *     (docs/what-you-can-edit.md).
 *
 * The behaviour itself is tested by saves-in-history.spec.ts and
 * changes-since-save.spec.ts; this only takes pictures, so it is skipped
 * unless DOCS_SHOTS=1, and it is not in ci-specs.txt. Run:
 *
 *   DOCS_SHOTS=1 npx playwright test e2e/docs-shots-saving.spec.ts
 *
 * The window is Playwright's default 1280 × 720, as the originals were.
 *
 * Not in CI: pictures only: it retakes the docs' pictures; the behaviour is tested by saves-in-history and changes-since-save.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/assets");
const SAVING = path.join(DOCS, "saving-autosave-and-undo");
const EDITING = path.join(DOCS, "what-you-can-edit");

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const V1 = `${BASE}# first saved version\n`;
const V2 = `${BASE}# second saved version\n`;
const EDITED = BASE.replace("function=pnl.Logistic()", "function=pnl.Logistic(gain=2.5)") + "# a note added in PsyNeuView\n";

test.skip(!process.env.DOCS_SHOTS, "pictures only; set DOCS_SHOTS=1 to retake them");

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "docs-shots-"));
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
  // The "Loaded …" toast would sit over the toolbar.
  await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });
}

async function replaceBuffer(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

async function saveNow(page: Page, model: string, expected: string) {
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toBeDisabled({ timeout: 30_000 });
  await expect.poll(() => readFileSync(model, "utf8")).toBe(expected);
}

test.describe("Docs pictures: saving", () => {
  test("History with two saves, and the revert confirm", async ({ page }) => {
    test.setTimeout(240_000);
    const model = scratchModel();
    await openFromPath(page, model);
    await replaceBuffer(page, V1);
    await saveNow(page, model, V1);
    await replaceBuffer(page, V2);
    await saveNow(page, model, V2);

    await page.getByTestId("history-button").click();
    const panel = page.getByTestId("history-panel");
    await expect(panel.getByTestId("history-save-marker")).toHaveCount(2);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SAVING, "history-save-markers.png") });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await page.getByTestId("undo-button").click();
    await expect(page.locator(".cm-content")).toContainText("# first saved version");
    await page.getByTestId("history-button").click();
    await panel.getByTestId("history-at-save-revert").click();
    const dialog = page.getByTestId("revert-to-save");
    await expect(dialog.getByTestId("revert-to-save-summary")).toContainText("1 line added, 1 removed", { timeout: 15_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SAVING, "revert-confirm.png") });
    await dialog.getByTestId("revert-to-save-cancel").click();
  });

  test("Changes since save, after a change outside PsyNeuView", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    await replaceBuffer(page, EDITED);
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();

    writeFileSync(model, `${BASE}# saved in PyCharm\n`);
    await expect(page.getByTestId("external-change-modal")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("external-change-keep-mine").click();

    await page.getByTestId("unsaved-dot").click();
    const dialog = page.getByTestId("changes-since-save");
    await expect(dialog.getByTestId("changes-since-save-summary")).toContainText("2 lines added, 2 removed", {
      timeout: 15_000,
    });
    await page.waitForTimeout(300);
    await dialog.screenshot({ path: path.join(EDITING, "changes-since-save.png") });
  });
});
