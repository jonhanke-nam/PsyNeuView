/**
 * Autosave as a setting (#1347).
 *
 * Off by default: typing previews, and only Save writes (#1029). Turned on,
 * the page presses that same Save N seconds after the last edit — unless the
 * code has an error, the model is locked, or the file changed on disk.
 *
 * These assert on the bytes on disk, like preview-not-save.spec.ts, because
 * that is the actual promise. The setting lives in the session's preferences
 * file, shared by every spec in a run, so each test here puts it back to off.
 *
 * Screenshots land in `$SHOTS_DIR` when it is set.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const EDITED = `${BASE}\n# edited in PsyNeuView\n`;
const BROKEN = `${BASE}\nthis is not python (\n`;
const EXTERNAL = `${BASE}\n# saved from PyCharm\n`;

function scratchModel() {
  const dir = mkdtempSync(path.join(tmpdir(), "autosave1347-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), ...(clip ? { clip } : {}) });
}

async function toolbarShot(page: Page, name: string) {
  await shot(page, name, { x: 0, y: 0, width: 1280, height: 110 });
}

async function setAutosave(page: Page, setting: { enabled?: boolean; seconds?: number }) {
  const r = await page.request.post("/api/settings/autosave", { data: setting });
  expect(r.ok()).toBe(true);
}

async function openModel(page: Page, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

async function typeIntoEditor(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

async function openModelFilesSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-general").click();
  await expect(page.getByTestId("settings-group-model-files")).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
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

const status = (page: Page) => page.getByTestId("autosave-status");

test.describe("autosave (#1347)", () => {
  test.afterEach(async ({ page }) => {
    await setAutosave(page, { enabled: false, seconds: 10 });
  });

  test("off by default: an edit is not written, however long you wait", async ({ page }) => {
    test.setTimeout(180_000);
    // Nothing in the suite turns it on but this file, which turns it off again.
    const current = await (await page.request.get("/api/settings/autosave")).json();
    expect(current).toEqual({ enabled: false, seconds: 10 });

    const model = scratchModel();
    await openModel(page, model);
    await openModelFilesSettings(page);
    await expect(page.getByTestId("setting-autosave")).not.toBeChecked();
    await expect(page.getByTestId("setting-autosave-delay")).toHaveCount(0);
    await shot(page, "02-settings-model-files-autosave-off");
    await closeSettings(page);

    await typeIntoEditor(page, EDITED);
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    // Past the default 10 s, and nothing beside the model name.
    await holdsFor(page, 12_000, () => expect(readFileSync(model, "utf8")).toBe(BASE));
    await expect(status(page)).toHaveCount(0);
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
  });

  test("on, after N idle seconds the file is saved, and the status says so", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openModel(page, model);

    // Turned on in Settings, with the seconds that appear once it is on.
    await openModelFilesSettings(page);
    await page.getByTestId("setting-autosave").check();
    const delay = page.getByTestId("setting-autosave-delay");
    await expect(delay).toHaveValue("10");
    await delay.fill("3");
    await delay.press("Enter");
    await expect
      .poll(async () => (await (await page.request.get("/api/settings/autosave")).json()).seconds)
      .toBe(3);
    await shot(page, "03-settings-model-files-autosave-on");
    await closeSettings(page);
    await expect(status(page)).toHaveText("Autosave on");
    await expect(status(page)).toHaveAttribute("title", /saved 3 s after your last edit[\s\S]*Settings ▸ General ▸ Model files/);

    await typeIntoEditor(page, EDITED);
    // Not before the wait is over...
    expect(readFileSync(model, "utf8")).toBe(BASE);
    // ...then written, through the same Save: the unsaved dot goes too.
    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).toBe(EDITED);
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
    await expect(status(page)).toHaveText(/^Autosaved (just now|\d+ s ago)$/);
    await expect(status(page)).toHaveText(/^Autosaved \d+ s ago$/, { timeout: 10_000 });
    await toolbarShot(page, "04-toolbar-autosaved-ago");

    // Clicking it opens Settings where the setting is.
    await status(page).click();
    await expect(page.getByTestId("setting-autosave")).toBeChecked();
    await closeSettings(page);
  });

  test("on, code with an error waits instead of being written", async ({ page }) => {
    test.setTimeout(180_000);
    await setAutosave(page, { enabled: true, seconds: 2 });
    const model = scratchModel();
    await openModel(page, model);

    await typeIntoEditor(page, BROKEN);
    await expect(status(page)).toHaveText("Autosave waiting: code has an error", { timeout: 30_000 });
    await toolbarShot(page, "05-toolbar-waiting-code-error");
    await holdsFor(page, 5_000, () => expect(readFileSync(model, "utf8")).toBe(BASE));

    // Fixed: that edit starts the wait over and is saved.
    await typeIntoEditor(page, EDITED);
    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).toBe(EDITED);
  });

  test("a locked model is not autosaved", async ({ page }) => {
    test.setTimeout(180_000);
    await setAutosave(page, { enabled: false, seconds: 2 });
    const model = scratchModel();
    await openModel(page, model);

    // An unsaved edit, then the model is locked (view only)...
    await typeIntoEditor(page, EDITED);
    await page.getByTestId("layout-menu-button").click();
    await page.getByTestId("layout-menu-lock-model").click();
    await expect(page.getByTestId("edit-mode-badge")).toBeVisible();

    // ...and only then is autosave turned on, so it can't have saved first.
    await openModelFilesSettings(page);
    await page.getByTestId("setting-autosave").check();
    await closeSettings(page);

    await expect(status(page)).toHaveText("Autosave paused: model is locked");
    await holdsFor(page, 5_000, () => expect(readFileSync(model, "utf8")).toBe(BASE));
    await toolbarShot(page, "06-toolbar-paused-locked");

    // Unlocked, the edit that waited is saved.
    await page.getByTestId("edit-mode-badge").click();
    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).toBe(EDITED);
  });

  test("a change on disk is never overwritten: paused while asked, and after Keep my changes", async ({ page }) => {
    test.setTimeout(180_000);
    await setAutosave(page, { enabled: true, seconds: 3 });
    const model = scratchModel();
    await openModel(page, model);

    await typeIntoEditor(page, EDITED);
    // PyCharm saves underneath us.
    writeFileSync(model, EXTERNAL);
    const modal = page.getByTestId("external-change-modal");
    await expect(modal).toBeVisible({ timeout: 60_000 });
    // While the question is open, well past N: the other editor's file stays.
    await holdsFor(page, 6_000, () => expect(readFileSync(model, "utf8")).toBe(EXTERNAL));

    await page.getByTestId("external-change-keep-mine").click();
    await expect(modal).toHaveCount(0);
    await expect(status(page)).toHaveText("Autosave paused: file changed on disk");
    await toolbarShot(page, "07-toolbar-paused-disk-changed");
    // Keeping our edits doesn't make it safe to write over theirs unasked.
    await holdsFor(page, 6_000, () => expect(readFileSync(model, "utf8")).toBe(EXTERNAL));
  });
});
