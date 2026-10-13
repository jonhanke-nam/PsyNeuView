/**
 * Your own PsyNeuLink checkout is editable; a PsyNeuLink that PsyNeuView
 * manages is not (#1305).
 *
 * A library model opens in place, so the file on screen is a file of the
 * installed PsyNeuLink. The promise:
 *
 *  - From **your own local checkout** (chosen in Settings ▸ Developer) the
 *    file is editable by default — type, Save, and the change is in your
 *    repo. You can protect a checkout from edits with the toolbar badge, and
 *    allow them again.
 *  - From a **managed** PsyNeuLink (a GitHub copy such as "Latest
 *    development", a PyPI release) the editor is read only, says why at the
 *    top of the file, and the backend refuses the write.
 *
 * Which PsyNeuLink is active is read from the installed distribution's
 * metadata, so the spec declares a temporary checkout tree through the
 * test-only `/api/test/pnl-install` override and puts the real one back in
 * its `finally`. The library model is a small stand-in (the
 * `two_mech_projection` fixture under `psyneulink/library/models/`) rather
 * than EGO: the assertions are about ownership and the write, and a model
 * that loads in a second keeps the spec fast and steady on a CI runner.
 *
 * Screenshots land in `$SHOTS_DIR` when it is set (for a PR's evidence), and
 * are skipped otherwise.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync } from "fs";
import path from "path";
import { checkoutTree, declareInstall, openModelFromPath as openModel } from "./pnl-install";

const EDIT_MARKER = "# edited in PsyNeuView (#1305)";

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  // The "Loaded …" toast sits over the toolbar badge the picture is about.
  await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const badge = (page: Page) => page.getByTestId("pnl-source-badge");
const editModeBadge = (page: Page) => page.getByTestId("edit-mode-badge");
const banner = (page: Page) => page.getByTestId("pnl-protected-banner");
const editor = (page: Page) => page.locator(".cm-content");

async function saveViaApi(page: Page, model: string) {
  const source = readFileSync(model, "utf8");
  return page.request.post("/api/model/save-source", {
    data: { file_path: model, source: `${source}\n${EDIT_MARKER}\n`, base_source: source },
  });
}

test("your own checkout is editable by default; protecting it is a choice (#1305)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const { root, model } = checkoutTree("local-1305");
  const original = readFileSync(model, "utf8");
  try {
    await declareInstall(page, "local", root);
    await openModel(page, model);

    // Editable, and the toolbar says so. No banner: nothing to explain.
    await expect(badge(page)).toHaveText("your PsyNeuLink checkout · editing");
    await expect(banner(page)).toHaveCount(0);
    await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
    // The per-model lock (#1116) applies as usual, and an unlocked model
    // shows no tag for it (#1309): nothing to say.
    await expect(editModeBadge(page)).toHaveCount(0);
    await expect(page.getByTestId("pnl-source-badge")).toBeVisible();

    // Type an edit and Save: the change is in the checkout's file.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(`${original}\n${EDIT_MARKER}\n`);
    await shot(page, "01-own-checkout-editing");
    await page.getByRole("button", { name: /^Save$/ }).first().click();
    await expect
      .poll(() => readFileSync(model, "utf8").includes(EDIT_MARKER), { timeout: 30_000 })
      .toBe(true);

    // Protect it: the badge flips, the editor explains at the top and goes
    // read only, and the backend refuses a write.
    await badge(page).click();
    await expect(badge(page)).toHaveText("your PsyNeuLink checkout · protected");
    await expect(editModeBadge(page)).toHaveCount(0);
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText("protected from edits");
    await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
    await shot(page, "03-own-checkout-protected");
    const beforeRefusedSave = readFileSync(model, "utf8");
    const refused = await saveViaApi(page, model);
    expect(refused.status()).toBe(409);
    expect((await refused.json()).reason).toBe("psyneulink_source_protected");
    expect(readFileSync(model, "utf8")).toBe(beforeRefusedSave);

    // Allow edits again.
    await badge(page).click();
    await expect(badge(page)).toHaveText("your PsyNeuLink checkout · editing");
    await expect(banner(page)).toHaveCount(0);
    await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
  } finally {
    await declareInstall(page, null);
  }
});

test("a managed PsyNeuLink (GitHub) is read only, with the reason and the way out (#1305)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  // A `pip install git+…` lives in site-packages: `<root>/psyneulink/…`.
  const { root, model } = checkoutTree("github-1305");
  const original = readFileSync(model, "utf8");
  try {
    await declareInstall(page, "github", root);
    await openModel(page, model);

    // The badge is a label, not a switch: nothing to click.
    await expect(badge(page)).toHaveText("PsyNeuLink from GitHub · read only");
    await expect(badge(page)).toHaveJSProperty("tagName", "SPAN");
    // No "editable" beside "read only": the per-model badge stays out of it.
    await expect(editModeBadge(page)).toHaveCount(0);

    // The editor says why at the top of the file, and is read only.
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText("PsyNeuLink from GitHub");
    await expect(banner(page)).toContainText("Settings ▸ Developer");
    await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
    await shot(page, "02-managed-readonly-banner");

    // Typing changes nothing, saving is refused, the file is unchanged.
    await editor(page).click();
    await page.keyboard.insertText("# nope");
    await expect(editor(page)).not.toContainText("# nope");
    const refused = await saveViaApi(page, model);
    expect(refused.status()).toBe(409);
    const body = await refused.json();
    expect(body.reason).toBe("psyneulink_source_protected");
    expect(body.kind).toBe("github");
    expect(body.detail).toContain("Settings ▸ Developer");
    expect(readFileSync(model, "utf8")).toBe(original);

    // And a managed install can't be allowed edits at all.
    const protect = await page.request.post("/api/model/pnl-source/protect", {
      data: { file_path: model, protect: false },
    });
    expect(protect.status()).toBe(400);

    // The way out is one click away: Settings, at Developer.
    await banner(page).getByRole("button", { name: "Open Settings ▸ Developer" }).click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await expect(page.getByTestId("settings-content-developer")).toBeVisible();
  } finally {
    await declareInstall(page, null);
  }
});
