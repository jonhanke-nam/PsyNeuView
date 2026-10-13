/**
 * Locking one model inside your own PsyNeuLink checkout (#1346, part 1).
 *
 * The promise:
 *
 *  - **Layout ▸ Lock this model (view only)** is offered for a file in your
 *    own checkout, editable or protected (it stays hidden for a PsyNeuLink
 *    that PsyNeuView manages: model-lock.spec.ts).
 *  - In an **editable** checkout, locking one model makes that model read
 *    only — the "view only" tag, the editor's banner, a refused save — while
 *    the checkout's other models stay editable. Unlocking restores it.
 *  - The lock is written to the model's layout file inside the checkout,
 *    beside the model, so it travels with the repo if committed.
 *  - In a **protected** checkout the toolbar shows the stricter rule: the
 *    checkout tag reads "protected" and the "view only" tag steps aside; the
 *    tooltip and the editor's banner say the model is locked too. Allowing
 *    edits again leaves the lock in force.
 *
 * The checkout is a temporary tree declared through the test-only
 * `/api/test/pnl-install` override (#1305), with two copies of the small
 * stand-in library model.
 *
 * Screenshots land in `$SHOTS_DIR` when it is set, and are skipped otherwise.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import { copyFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import { checkoutTree, declareInstall, openModelFromPath } from "./pnl-install";

const checkoutTag = (page: Page) => page.getByTestId("pnl-source-badge");
const lockTag = (page: Page) => page.getByTestId("edit-mode-badge");
const lockMenuItem = (page: Page) => page.getByTestId("layout-menu-lock-model");
const layoutButton = (page: Page) => page.getByTestId("layout-menu-button");
const editor = (page: Page) => page.locator(".cm-content");
const viewOnlyBanner = (page: Page) => page.getByTestId("view-only-banner");
const protectedBanner = (page: Page) => page.getByTestId("pnl-protected-banner");

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function open(page: Page, model: string) {
  await openModelFromPath(page, model);
  // The "Loaded …" toast sits over the toolbar tags the assertions are about.
  await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });
  await expect(checkoutTag(page)).toBeVisible();
}

async function save(page: Page, model: string, marker: string) {
  const source = readFileSync(model, "utf8");
  return page.request.post("/api/model/save-source", {
    data: { file_path: model, source: `${source}\n${marker}\n`, base_source: source },
  });
}

/** The lock's layout file, beside the model or in its hidden `.psyneuview/` folder. */
function layoutFileFor(model: string): string | null {
  const stem = path.basename(model, ".py");
  const dir = path.dirname(model);
  for (const candidate of [path.join(dir, `${stem}.pnlview.json`), path.join(dir, ".psyneuview", `${stem}.pnlview.json`)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

test("lock one model in your own checkout; the rest stays editable; protecting shows the stricter rule (#1346)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(240_000);
  const { root, model } = checkoutTree("local-1346");
  const other = path.join(path.dirname(model), "Other_Library_Model.py");
  try {
    await declareInstall(page, "local", root);
    await open(page, model);
    copyFileSync(model, other);

    // Editable checkout, unlocked: the lock is offered in the Layout menu.
    await expect(checkoutTag(page)).toHaveText("your PsyNeuLink checkout · editing");
    await expect(lockTag(page)).toHaveCount(0);
    await layoutButton(page).click();
    await expect(lockMenuItem(page)).toHaveText("Lock this model (view only)");
    await shot(page, "01-after-layout-menu-checkout-editable");
    await lockMenuItem(page).click();

    // Locked: this model is read only, and says so.
    await expect(lockTag(page)).toHaveText("view only");
    await expect(lockTag(page)).toHaveAttribute("title", /inside your PsyNeuLink checkout.*Click to unlock/);
    await expect(checkoutTag(page)).toHaveText("your PsyNeuLink checkout · editing");
    await expect(checkoutTag(page)).toHaveAttribute("title", /This model is locked \(view only\)/);
    await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
    await expect(viewOnlyBanner(page)).toContainText("This model is view only");
    await expect(viewOnlyBanner(page)).toContainText("other files in your PsyNeuLink checkout stay editable");
    await expect(protectedBanner(page)).toHaveCount(0);
    await shot(page, "02-locked-checkout-model-tag-and-banner");

    // The lock is in the model's layout file, inside the checkout.
    const layoutFile = layoutFileFor(model);
    expect(layoutFile, `no layout file beside ${model}`).not.toBeNull();
    expect(layoutFile!.startsWith(root)).toBe(true);
    expect(JSON.parse(readFileSync(layoutFile!, "utf8")).editLock).toBe("viewOnly");

    // The backend refuses a save, with the lock's reason.
    const before = readFileSync(model, "utf8");
    const refused = await save(page, model, "# typed while locked");
    expect(refused.status()).toBe(409);
    expect((await refused.json()).reason).toBe("model_view_only");
    expect(readFileSync(model, "utf8")).toBe(before);

    // Another model in the same checkout stays editable.
    await open(page, other);
    await expect(checkoutTag(page)).toHaveText("your PsyNeuLink checkout · editing");
    await expect(lockTag(page)).toHaveCount(0);
    await expect(viewOnlyBanner(page)).toHaveCount(0);
    await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
    await shot(page, "03-other-checkout-model-still-editable");
    const allowed = await save(page, other, "# edited in PsyNeuView (#1346)");
    expect(allowed.status(), await allowed.text()).toBe(200);
    expect(readFileSync(other, "utf8")).toContain("# edited in PsyNeuView (#1346)");

    // Back to the locked model: still locked. Protect the checkout.
    await open(page, model);
    await expect(lockTag(page)).toHaveText("view only");
    await checkoutTag(page).click();

    // The stricter rule shows: the checkout tag says protected, the lock tag
    // steps aside, and the tooltip and the banner say the lock is there too.
    await expect(checkoutTag(page)).toHaveText("your PsyNeuLink checkout · protected");
    await expect(checkoutTag(page)).toHaveAttribute("title", /Click to allow edits\. This model is also locked/);
    await expect(lockTag(page)).toHaveCount(0);
    await expect(protectedBanner(page)).toContainText("protected from edits");
    await expect(protectedBanner(page)).toContainText("This model is also locked (view only)");
    await expect(viewOnlyBanner(page)).toHaveCount(0);
    await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
    await shot(page, "04-protected-checkout-locked-model");
    const protectedSave = await save(page, model, "# typed while protected");
    expect(protectedSave.status()).toBe(409);
    expect((await protectedSave.json()).reason).toBe("psyneulink_source_protected");

    // The lock is still offered in a protected checkout.
    await layoutButton(page).click();
    await expect(lockMenuItem(page)).toHaveText("Unlock this model");
    await shot(page, "05-after-layout-menu-checkout-protected");
    await page.keyboard.press("Escape");

    // Allow edits again: the lock is still in force, and the view-only tag is back.
    await checkoutTag(page).click();
    await expect(checkoutTag(page)).toHaveText("your PsyNeuLink checkout · editing");
    await expect(lockTag(page)).toHaveText("view only");
    await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
    const stillLocked = await save(page, model, "# typed after allowing edits");
    expect(stillLocked.status()).toBe(409);
    expect((await stillLocked.json()).reason).toBe("model_view_only");

    // Unlock from the tag: editable again, and the save goes through.
    await lockTag(page).click();
    await expect(lockTag(page)).toHaveCount(0);
    await expect(viewOnlyBanner(page)).toHaveCount(0);
    await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
    expect(JSON.parse(readFileSync(layoutFile!, "utf8")).editLock).toBeUndefined();
    const unlocked = await save(page, model, "# edited after unlocking (#1346)");
    expect(unlocked.status(), await unlocked.text()).toBe(200);

    // Protecting an unlocked checkout model: protected, no lock mentioned.
    await checkoutTag(page).click();
    await expect(checkoutTag(page)).toHaveText("your PsyNeuLink checkout · protected");
    await expect(protectedBanner(page)).not.toContainText("also locked");
    await shot(page, "06-protected-checkout-unlocked-model");
    await checkoutTag(page).click();
    await expect(checkoutTag(page)).toHaveText("your PsyNeuLink checkout · editing");
  } finally {
    await declareInstall(page, null);
  }
});
