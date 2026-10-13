/**
 * The per-model lock, as a user meets it (#1116, #1309).
 *
 * The promise:
 *
 *  - An unlocked model — the normal case — shows **no** tag for the lock.
 *  - **Layout ▸ Lock this model (view only)** locks it: a "view only" tag
 *    appears in the toolbar, the graph and the inspector refuse edits (the
 *    backend refuses, not just the UI), the code editor is read only with a
 *    banner saying why and a save from it is refused too (#1320), and the
 *    lock is written to the model's layout file so it travels with the model.
 *    Layout-only changes (moving nodes) stay allowed.
 *  - Clicking the "view only" tag unlocks it, and edits work again.
 *  - For a file protected by where it lives (a managed PsyNeuLink, #1305) the
 *    lock items are hidden: the location rule already answers the question.
 *
 * The first test uses a Reference Model (Stroop — Basic), which opens as a
 * working copy in the session's working dir, so the lock lands in that copy's
 * layout file and the bundled original stays untouched. The second uses the
 * test-only `/api/test/pnl-install` override from #1305 to make a stand-in
 * file count as part of a managed PsyNeuLink.
 *
 * Screenshots: full pages land in `$SHOTS_DIR` (a PR's evidence) and clipped
 * toolbar/editor views in `$DOCS_SHOTS_DIR` (the images
 * docs/what-you-can-edit.md embeds). Both are skipped when unset.
 */
import type { Page } from "@playwright/test";
import { mutatingTest, readOnlyTest, expect, canvasNode, closePalette, fitGraph } from "./test-base";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { checkoutTree, declareInstall, openModelFromPath } from "./pnl-install";

const LABEL = "Stroop — Basic";

const lockTag = (page: Page) => page.getByTestId("edit-mode-badge");
const lockMenuItem = (page: Page) => page.getByTestId("layout-menu-lock-model");
const layoutButton = (page: Page) => page.getByTestId("layout-menu-button");
const editor = (page: Page) => page.locator(".cm-content");
const viewOnlyBanner = (page: Page) => page.getByTestId("view-only-banner");

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The toolbar and the top of the editor, for the docs. */
async function docsShot(page: Page, name: string, height = 150) {
  const dir = process.env.DOCS_SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), clip: { x: 0, y: 0, width: 1600, height } });
}

/** The "Loaded …" toast sits over the toolbar badges the pictures are about. */
async function loadedToastGone(page: Page) {
  await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });
}

/** Where the lock is written: the working copy's layout file, beside it or in `.psyneuview/`. */
function layoutFileFor(workingCopy: string): string | null {
  const stem = path.basename(workingCopy, ".py");
  const dir = path.dirname(workingCopy);
  for (const candidate of [path.join(dir, `${stem}.pnlview.json`), path.join(dir, ".psyneuview", `${stem}.pnlview.json`)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function openReference(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Open/ }).first().click();
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/reference-models/load") && r.request().method() === "POST",
      { timeout: 60_000 },
    ),
    page.getByText(LABEL, { exact: true }).first().click(),
  ]);
  expect(resp.ok(), `reference load failed: ${resp.status()}`).toBe(true);
  const body = await resp.json();
  await expect(canvasNode(page, "color_input")).toBeVisible({ timeout: 60_000 });
  return body.file_path as string;
}

mutatingTest("no tag when unlocked; lock from the Layout menu, unlock from the tag (#1309)", { tag: "@ci" }, async ({ page }) => {
  mutatingTest.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const workingCopy = await openReference(page);
  await loadedToastGone(page);

  // Unlocked: nothing to say, so nothing is shown.
  await expect(lockTag(page)).toHaveCount(0);
  await shot(page, "01-unlocked-no-tag");
  await docsShot(page, "unlocked-no-tag");

  // The lock lives in the Layout menu, under "This model".
  await layoutButton(page).click();
  await expect(lockMenuItem(page)).toHaveText("Lock this model (view only)");
  await shot(page, "02-lock-menu-item");
  await docsShot(page, "lock-menu-item", 420);
  await lockMenuItem(page).click();

  // Locked: the tag appears, and the lock is in the model's layout file.
  await expect(lockTag(page)).toHaveText("view only");
  await expect(lockTag(page)).toHaveAttribute("title", /Click to unlock/);
  await shot(page, "03-locked-view-only-tag");
  await docsShot(page, "locked-view-only-tag");
  const layoutFile = layoutFileFor(workingCopy);
  expect(layoutFile, `no layout file beside ${workingCopy}`).not.toBeNull();
  expect(JSON.parse(readFileSync(layoutFile!, "utf8")).editLock).toBe("viewOnly");

  // The graph refuses an edit: select a node, press Backspace, confirm — and
  // the backend says no, with the way out. The node stays.
  const before = readFileSync(workingCopy, "utf8");
  await closePalette(page);
  await fitGraph(page);
  await canvasNode(page, "color_input").first().click();
  page.once("dialog", (d) => void d.accept());
  await page.keyboard.press("Backspace");
  await expect(page.getByText(/Failed to delete node: This model is locked \(view only\)/)).toBeVisible({ timeout: 15_000 });
  await expect(canvasNode(page, "color_input")).toBeVisible();
  expect(readFileSync(workingCopy, "utf8")).toBe(before);

  // The inspector's writes are refused the same way, from the API.
  const refused = await page.request.post("/api/model/update-param", {
    data: { file_path: workingCopy, var_name: "color_input", param_name: "gain", new_value: "2.0" },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).reason).toBe("model_view_only");
  expect(readFileSync(workingCopy, "utf8")).toBe(before);

  // The code editor is read only too (#1320), says why at the top of the
  // file, and a save from it is refused by the backend with the same answer.
  await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
  await expect(viewOnlyBanner(page)).toBeVisible();
  await expect(viewOnlyBanner(page)).toContainText("This model is view only");
  await expect(viewOnlyBanner(page)).toContainText("Layout ▸ Unlock this model");
  await shot(page, "01-locked-editor-readonly-banner");
  const saveRefused = await page.request.post("/api/model/save-source", {
    data: { file_path: workingCopy, source: `${before}\n# typed while locked\n`, base_source: before },
  });
  expect(saveRefused.status()).toBe(409);
  expect((await saveRefused.json()).reason).toBe("model_view_only");
  expect(readFileSync(workingCopy, "utf8")).toBe(before);

  // Layout-only changes stay allowed — a node drag is recorded — and a
  // layout save keeps the lock.
  const layoutSaved = await page.request.post("/api/model/save-layout", {
    data: { file_path: workingCopy, positions: { color_input: { x: 42, y: 24 } } },
  });
  expect(layoutSaved.ok(), await layoutSaved.text()).toBe(true);
  expect(JSON.parse(readFileSync(layoutFile!, "utf8")).editLock).toBe("viewOnly");

  // The menu now offers to unlock, but the tag is the shorter way.
  await layoutButton(page).click();
  await expect(lockMenuItem(page)).toHaveText("Unlock this model");
  await page.keyboard.press("Escape");
  await lockTag(page).click();
  await expect(lockTag(page)).toHaveCount(0);
  expect(JSON.parse(readFileSync(layoutFile!, "utf8")).editLock).toBeUndefined();

  // Unlocked: the editor is editable again and the banner is gone (#1320).
  await expect(viewOnlyBanner(page)).toHaveCount(0);
  await expect(editor(page)).not.toHaveAttribute("aria-readonly", "true");
  await shot(page, "02-unlocked-editable");

  // Unlocked again: a structural edit goes through.
  const allowed = await page.request.post("/api/model/structural-change", {
    data: {
      file_path: workingCopy,
      changes: { action: "add_node", var_name: "probe_1309", type: "TransferMechanism", params: {} },
    },
  });
  expect(allowed.status(), await allowed.text()).toBe(200);
  expect(readFileSync(workingCopy, "utf8")).toContain("probe_1309 = pnl.TransferMechanism");

  // Reopening a reference with edits keeps them and says so (#1010): the one
  // reference-model behaviour the docs page describes that is not the lock.
  await openReference(page);
  await expect(page.getByText(/Loaded your edited copy of .* your changes were kept/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600); // let the notice finish fading in before the picture
  await docsShot(page, "reference-kept-edits", 150);
});

readOnlyTest("the lock items are hidden for a protected PsyNeuLink file (#1309)", { tag: "@ci" }, async ({ page }) => {
  readOnlyTest.setTimeout(180_000);
  const { root, model } = checkoutTree("github-1309");
  try {
    await declareInstall(page, "github", root);
    await openModelFromPath(page, model);
    await loadedToastGone(page);

    // The location rule speaks; the lock stays out of it.
    await expect(page.getByTestId("pnl-source-badge")).toHaveText("PsyNeuLink from GitHub · read only");
    await expect(page.getByTestId("pnl-protected-banner")).toBeVisible();
    await expect(lockTag(page)).toHaveCount(0);
    await docsShot(page, "managed-read-only", 190);
    await layoutButton(page).click();
    await expect(page.getByTestId("layout-menu-settings")).toBeVisible();
    await expect(lockMenuItem(page)).toHaveCount(0);
    await expect(page.getByText("This model", { exact: true })).toHaveCount(0);
    await shot(page, "04-protected-file-no-lock-items");
    await page.keyboard.press("Escape");

    // Even a lock written by hand into the layout file shows no tag here:
    // "read only" already covers it.
    const lock = await page.request.post("/api/model/edit-mode", { data: { file_path: model, mode: "viewOnly" } });
    expect(lock.ok()).toBe(true);
    await openModelFromPath(page, model);
    await expect(page.getByTestId("pnl-source-badge")).toHaveText("PsyNeuLink from GitHub · read only");
    await expect(lockTag(page)).toHaveCount(0);
    // ...and the editor's reason is the protected-file one, not the lock's.
    await expect(page.getByTestId("pnl-protected-banner")).toBeVisible();
    await expect(viewOnlyBanner(page)).toHaveCount(0);
  } finally {
    // The lock written above lives in the layout file for this source and
    // path, which is kept outside the install and shared by every copy of
    // the same source (#1321) — so take it off before the install goes.
    await page.request.post("/api/model/edit-mode", { data: { file_path: model, mode: "editable" } });
    await declareInstall(page, null);
  }
});

readOnlyTest("your own checkout: the editing badge, and protecting it (#1305, for the docs)", { tag: "@ci" }, async ({ page }) => {
  readOnlyTest.setTimeout(180_000);
  readOnlyTest.skip(!process.env.DOCS_SHOTS_DIR, "pictures only; the behaviour is own-checkout-editable.spec.ts");
  const { root, model } = checkoutTree("local-1309");
  try {
    await declareInstall(page, "local", root);
    await openModelFromPath(page, model);
    await loadedToastGone(page);
    const badge = page.getByTestId("pnl-source-badge");
    await expect(badge).toHaveText("your PsyNeuLink checkout · editing");
    await docsShot(page, "own-checkout-editing");
    await badge.click();
    await expect(badge).toHaveText("your PsyNeuLink checkout · protected");
    await expect(page.getByTestId("pnl-protected-banner")).toBeVisible();
    await docsShot(page, "own-checkout-protected", 190);
    await badge.click();
    await expect(badge).toHaveText("your PsyNeuLink checkout · editing");
  } finally {
    await declareInstall(page, null);
  }
});
