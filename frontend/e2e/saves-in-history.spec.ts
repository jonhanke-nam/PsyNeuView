/**
 * Saves in History, and reverting to one (#1349).
 *
 * Asserted against the bytes on disk, like preview-not-save.spec.ts, because
 * that is the promise: undo never writes the file, and a revert writes the
 * saved version, through Save, only when asked.
 *
 *   - save twice with an edit between: two markers in History, and History
 *     says it keeps every step;
 *   - undo past the latest save: the model is unsaved, the file unchanged,
 *     and History says where you are and offers the revert;
 *   - revert to that save: the confirm shows the change, the file then holds
 *     that version, and History shows the revert as a new marker;
 *   - pick an earlier marker without undoing: the same revert;
 *   - with autosave on, the marker says automatic.
 *
 * Screenshots land in `$SHOTS_DIR` when it is set.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const V1 = `${BASE}# first saved version\n`;
const V2 = `${BASE}# second saved version\n`;

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "saves1349-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
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
  await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
}

async function openHistory(page: Page) {
  await page.getByTestId("history-button").click();
  await expect(page.getByTestId("history-panel")).toBeVisible();
  return page.getByTestId("history-panel");
}

/** Check, every quarter second for `ms`, that something stays true. */
async function holdsFor(page: Page, ms: number, check: () => void) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    check();
    await page.waitForTimeout(250);
  }
  check();
}

async function setAutosave(page: Page, setting: { enabled?: boolean; seconds?: number }) {
  const r = await page.request.post("/api/settings/autosave", { data: setting });
  expect(r.ok()).toBe(true);
}

test.describe("Saves in History (#1349)", () => {
  test("two saves, undo past the latest, revert to the earlier one", async ({ page }) => {
    test.setTimeout(240_000);
    const model = scratchModel();
    await openFromPath(page, model);

    await replaceBuffer(page, V1);
    await saveNow(page, model, V1);
    await replaceBuffer(page, V2);
    await saveNow(page, model, V2);

    // Two markers, each under the step it wrote; the newest is on disk.
    let panel = await openHistory(page);
    const markers = panel.getByTestId("history-save-marker");
    await expect(markers).toHaveCount(2);
    await expect(markers.nth(0)).toHaveText(/^⤓Saved \d/);
    await expect(markers.nth(0)).toHaveAttribute("data-kind", "manual");
    await expect(markers.nth(0)).toHaveAttribute("data-on-disk", "false");
    await expect(markers.nth(1)).toHaveAttribute("data-on-disk", "true");
    await expect(panel.getByTestId("history-depth")).toHaveText("· keeps every step");
    await expect(panel.getByTestId("history-at-save")).toHaveCount(0);
    await shot(page, "02-history-two-save-markers");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Undo past the latest save: back at the first save. Unsaved, and the
    // file still holds the second version.
    await page.getByTestId("undo-button").click();
    await expect(page.locator(".cm-content")).toContainText("# first saved version");
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    await holdsFor(page, 4_000, () => expect(readFileSync(model, "utf8")).toBe(V2));

    panel = await openHistory(page);
    const atSave = panel.getByTestId("history-at-save");
    await expect(atSave).toContainText("You've undone to the save of");
    await shot(page, "03-history-undone-to-earlier-save");
    await atSave.getByTestId("history-at-save-revert").click();
    await expect(panel).toHaveCount(0);

    // The confirm shows what the file will lose and gain; nothing written yet.
    const dialog = page.getByTestId("revert-to-save");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("revert-to-save-summary")).toContainText("1 line added, 1 removed", { timeout: 15_000 });
    await expect(dialog.getByTestId("line-diff")).toContainText("# second saved version");
    await expect(dialog.getByTestId("line-diff")).toContainText("# first saved version");
    expect(readFileSync(model, "utf8")).toBe(V2);
    await shot(page, "04-revert-confirm-with-diff");

    // Cancel writes nothing.
    await dialog.getByTestId("revert-to-save-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect(readFileSync(model, "utf8")).toBe(V2);

    // Revert, for real: the file holds the first version, the model is saved.
    panel = await openHistory(page);
    await panel.getByTestId("history-at-save-revert").click();
    await dialog.getByTestId("revert-to-save-confirm").click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).toBe(V1);
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);

    // A new marker says so, on the step it wrote; the second save is still
    // there to redo.
    panel = await openHistory(page);
    await expect(panel.getByTestId("history-save-marker")).toHaveCount(3);
    const revertMarker = panel.locator('[data-testid="history-save-marker"][data-kind="revert"]');
    await expect(revertMarker).toHaveCount(1);
    await expect(revertMarker).toHaveText(/reverted to/);
    await expect(revertMarker).toHaveAttribute("data-on-disk", "true");
    await expect(panel.getByTestId("history-at-save")).toHaveCount(0);
    await shot(page, "05-history-after-revert");
  });

  test("pick an earlier save in History and revert to it", async ({ page }) => {
    test.setTimeout(240_000);
    const model = scratchModel();
    await openFromPath(page, model);
    await replaceBuffer(page, V1);
    await saveNow(page, model, V1);
    await replaceBuffer(page, V2);
    await saveNow(page, model, V2);

    const panel = await openHistory(page);
    const markers = panel.getByTestId("history-save-marker");
    // The latest is what's on disk: selecting it says so, and offers nothing.
    await markers.nth(1).click();
    await expect(panel.getByTestId("history-save-detail")).toHaveText("The file on disk holds this version.");
    await expect(panel.getByTestId("history-revert-save")).toHaveCount(0);
    // The earlier one offers the revert.
    await markers.nth(0).click();
    await expect(markers.nth(0)).toHaveAttribute("aria-pressed", "true");
    await shot(page, "06-history-earlier-save-selected");
    await panel.getByTestId("history-revert-save").click();

    const dialog = page.getByTestId("revert-to-save");
    await expect(dialog.getByTestId("revert-to-save-summary")).toContainText("1 line added, 1 removed", { timeout: 15_000 });
    await dialog.getByTestId("revert-to-save-confirm").click();
    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).toBe(V1);
    await expect(page.locator(".cm-content")).toContainText("# first saved version");
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
  });

  test("with autosave on, its saves are marked automatic", async ({ page }) => {
    test.setTimeout(240_000);
    await setAutosave(page, { enabled: true, seconds: 2 });
    try {
      const model = scratchModel();
      await openFromPath(page, model);
      await replaceBuffer(page, V1);
      await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).toBe(V1);
      await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);

      const panel = await openHistory(page);
      const marker = panel.getByTestId("history-save-marker");
      await expect(marker).toHaveCount(1);
      await expect(marker).toHaveAttribute("data-kind", "auto");
      await expect(marker).toContainText("Autosaved");
      await expect(marker.getByTestId("history-save-automatic")).toHaveText("automatic");
      await expect(marker).toHaveAttribute("title", /Saved automatically/);
      await shot(page, "07-history-autosave-marker");
    } finally {
      await setAutosave(page, { enabled: false, seconds: 10 });
    }
  });
});
