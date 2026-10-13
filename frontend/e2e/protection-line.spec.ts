/**
 * A protection line in the model's own .py (#1346, part 2).
 *
 * The promise:
 *
 *  - `# PsyNeuView: protected` near the top: the model opens read only, like
 *    a locked model — a "view only · protected" tag, the editor's banner, a
 *    refused save. Clicking the tag unlocks it; the unlock is remembered for
 *    that file on this computer, so reopening it finds it editable, and the
 *    line stays in the file.
 *  - `# PsyNeuView: protected permanently`: read only with no unlock anywhere
 *    — a plain "protected permanently" label, no Unlock in the banner, a
 *    Layout menu row that says why instead of offering one. A save is
 *    refused. The banner's way out is Save a copy as…, and the copy starts
 *    unprotected (the line stays with the original).
 *  - Removing the line outside PsyNeuView makes the model editable as soon
 *    as the change on disk arrives.
 *
 * Real temporary model files, opened through Open ▸ Open from path….
 *
 * Screenshots land in `$SHOTS_DIR` when it is set, and are skipped otherwise.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";
import { openModelFromPath } from "./pnl-install";

const tag = (page: Page) => page.getByTestId("edit-mode-badge");
const banner = (page: Page) => page.getByTestId("view-only-banner");
const editor = (page: Page) => page.locator(".cm-content");
const layoutButton = (page: Page) => page.getByTestId("layout-menu-button");
const lockMenuItem = (page: Page) => page.getByTestId("layout-menu-lock-model");
const permanentMenuRow = (page: Page) => page.getByTestId("layout-menu-protected-permanently");

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** A copy of a small fixture with `line` added to its header. */
function protectedModel(label: string, line: string): { model: string; plain: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `protect-${label}-`));
  const model = path.join(dir, `${label}_model.py`);
  const plain = readFileSync(fixturePath("two_mech_projection"), "utf8");
  // After "# PsyNeuLink Model File" / "# Format Version: 1.0".
  const lines = plain.split("\n");
  lines.splice(2, 0, line);
  writeFileSync(model, lines.join("\n"));
  return { model, plain };
}

async function open(page: Page, model: string) {
  await openModelFromPath(page, model);
  // The "Loaded …" toast sits over the toolbar tags the assertions are about.
  await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });
}

async function save(page: Page, model: string) {
  const source = readFileSync(model, "utf8");
  return page.request.post("/api/model/save-source", {
    data: { file_path: model, source: `${source}\n# typed\n`, base_source: source },
  });
}

test("a protected file opens read only, unlocks from the tag, and stays unlocked after reopening (#1346)", async ({ page }) => {
  test.setTimeout(180_000);
  const { model } = protectedModel("protected", "# PsyNeuView: protected");
  const original = readFileSync(model, "utf8");
  await open(page, model);

  // Read only, and the tag says which rule.
  await expect(tag(page)).toHaveText("view only · protected");
  await expect(tag(page)).toHaveAttribute("title", /# PsyNeuView: protected.*Click to unlock/);
  await expect(banner(page)).toHaveAttribute("data-rule", "protected");
  await expect(banner(page)).toContainText("# PsyNeuView: protected");
  await expect(page.getByTestId("view-only-banner-unlock")).toBeVisible();
  await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
  await shot(page, "01-protected-tag-and-banner");
  const refused = await save(page, model);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).reason).toBe("model_protected");
  expect(readFileSync(model, "utf8")).toBe(original);

  // The usual unlock: click the tag.
  await tag(page).click();
  await expect(tag(page)).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
  await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
  await shot(page, "02-protected-after-unlocking");
  expect(readFileSync(model, "utf8")).toBe(original); // the line stays

  // The Layout menu offers to put the protection back.
  await layoutButton(page).click();
  await expect(lockMenuItem(page)).toHaveText("Lock this model (view only)");
  await expect(lockMenuItem(page)).toHaveAttribute("title", /unlocked it on this computer/);
  await page.keyboard.press("Escape");

  // Reopen: still unlocked here, and a save goes through.
  await open(page, model);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
  await expect(tag(page)).toHaveCount(0);
  const saved = await save(page, model);
  expect(saved.status(), await saved.text()).toBe(200);
});

test("a permanently protected file offers no unlock, refuses a save, and becomes editable when the line is removed on disk (#1346)", async ({ page }) => {
  test.setTimeout(180_000);
  const { model } = protectedModel("permanent", "# PsyNeuView: protected permanently");
  const original = readFileSync(model, "utf8");
  await open(page, model);

  // A label, not a button; no unlock in the banner.
  await expect(tag(page)).toHaveText("protected permanently");
  expect(await tag(page).evaluate((el) => el.tagName)).toBe("SPAN");
  await expect(tag(page)).toHaveAttribute("title", /no unlock here.*Save a copy as/);
  await expect(banner(page)).toHaveAttribute("data-rule", "protectedPermanently");
  await expect(banner(page)).toContainText("offers no unlock");
  await expect(page.getByTestId("view-only-banner-unlock")).toHaveCount(0);
  await expect(page.getByTestId("view-only-banner-save-copy")).toBeVisible();
  await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
  await shot(page, "03-permanent-tag-and-banner");

  // The Layout menu says why instead of offering an unlock.
  await layoutButton(page).click();
  await expect(permanentMenuRow(page)).toBeVisible();
  await expect(lockMenuItem(page)).toHaveCount(0);
  await shot(page, "04-permanent-layout-menu");
  await page.keyboard.press("Escape");

  // Refused in the backend: a save, and an unlock asked for directly.
  const refused = await save(page, model);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).reason).toBe("model_protected_permanently");
  const unlock = await page.request.post("/api/model/edit-mode", { data: { file_path: model, mode: "editable" } });
  expect(unlock.status()).toBe(409);
  expect(readFileSync(model, "utf8")).toBe(original);

  // Removing the line outside PsyNeuView is the way to change it.
  writeFileSync(model, original.replace("# PsyNeuView: protected permanently\n", ""));
  await expect(tag(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(banner(page)).toHaveCount(0);
  await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
  const saved = await save(page, model);
  expect(saved.status(), await saved.text()).toBe(200);
});

test("Save a copy as… from a permanently protected file: the copy starts unprotected (#1346)", async ({ page }) => {
  test.setTimeout(180_000);
  const { model } = protectedModel("copyfrom", "# PsyNeuView: protected permanently");
  const original = readFileSync(model, "utf8");
  await open(page, model);
  await expect(tag(page)).toHaveText("protected permanently");

  // The banner's button opens the dialog, which says what the copy gets.
  await page.getByTestId("view-only-banner-save-copy").click();
  const dialog = page.getByTestId("save-copy-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("save-copy-unprotected-note")).toContainText("The copy starts unprotected");
  await shot(page, "05-save-copy-dialog-note");
  const name = `copy_${Date.now()}.py`;
  await dialog.locator('input[placeholder="my_model.py"]').fill(name);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/models/save-as") && r.request().method() === "POST"),
    dialog.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  expect(resp.ok(), await resp.text()).toBe(true);
  const copy = (await resp.json()).file_path as string;

  // The copy is the open file, without the line, and editable.
  expect(readFileSync(copy, "utf8")).not.toMatch(/PsyNeuView:\s*protected/i);
  await expect(tag(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(banner(page)).toHaveCount(0);
  await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
  // The original keeps its line.
  expect(readFileSync(model, "utf8")).toBe(original);
});
