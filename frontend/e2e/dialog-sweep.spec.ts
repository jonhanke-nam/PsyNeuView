/**
 * Every dialog and pop-up closes the same ways (#1289): the sweep.
 *
 * docs/dialog-inventory.md lists them; dialogInventory.test.ts checks the
 * source. This opens each one in the browser and checks what the source
 * check cannot: a dialog has the shared header with its × in view without
 * scrolling, Escape closes it, and Escape closes only the innermost open thing
 * — a dialog over Settings leaves Settings open, a list inside a dialog
 * leaves the dialog open, and the file-changed dialog's Escape keeps the
 * unsaved edits it was asked about.
 */
import { mutatingTest as test, expect, closePalette, fitGraph } from "./test-base";
import { ORIENTATION_OFFER_KEY } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

/**
 * A copy we can freely write to — never the checked-in fixture. The fixture
 * carries the standard-format header; `plainHeader` swaps it for a comment,
 * which is what makes the diagnostics panel offer Convert to Standard Format.
 */
function scratchModel(plainHeader = false): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dialogs1289-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, plainHeader ? BASE.replace("# PsyNeuLink Model File", "# a scratch copy") : BASE);
  return file;
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

/** A dialog: the shared header, the × in view, then Escape closes it. */
async function escapeClosesDialog(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("dialog-header")).toBeVisible();
  const close = dialog.getByTestId("dialog-close");
  await expect(close).toBeInViewport();
  await expect(close).toHaveAttribute("aria-label", /./);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

/** A menu: anchored to its button, no ×; Escape closes it. */
async function escapeClosesMenu(page: Page, menu: Locator) {
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("dialog-close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}

test.describe("dialog sweep (#1289)", { tag: "@ci" }, () => {
  test("the toolbar's menus, and the menus over a model", async ({ page }) => {
    test.setTimeout(180_000);
    await openFromPath(page, scratchModel());

    await page.getByTestId("open-menu").click();
    await escapeClosesMenu(page, page.getByTestId("open-menu-list"));

    await page.getByTestId("layout-menu-button").click();
    await escapeClosesMenu(page, page.getByTestId("layout-menu-list"));

    await page.getByTestId("walkthrough-menu").click();
    await escapeClosesMenu(page, page.getByTestId("walkthrough-menu-list"));

    // History is a panel with the fixed header, anchored to its button.
    await page.getByTestId("history-button").click();
    await escapeClosesDialog(page, page.getByTestId("history-panel"));

    // Advanced Graph View Options (#123): a panel with the fixed header,
    // anchored to its button, like History.
    await page.getByTestId("graph-view-options-button").click();
    await escapeClosesDialog(page, page.getByTestId("graph-view-options-menu"));

    await page.getByTestId("snippet-menu-button").click();
    await escapeClosesMenu(page, page.getByTestId("snippet-menu"));

    await page.getByTestId("sidecar-placement-button").click();
    await escapeClosesMenu(page, page.getByTestId("sidecar-placement-menu"));

    await page.getByTestId("sidecar-variant-button").first().click();
    await escapeClosesMenu(page, page.getByTestId("sidecar-variant-menu"));

    // The node context menu, from a right-click on the canvas.
    await closePalette(page);
    await fitGraph(page);
    await page.locator(".react-flow__node").first().click({ button: "right" });
    await escapeClosesMenu(page, page.getByTestId("node-context-menu"));
  });

  test("the dialogs the Open menu opens, and a list inside one", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("psynewview_ui_prefs_developerMode", "true");
    });
    // The GitHub loader lists a repo's files; a stub keeps the test off the network.
    await page.route("**/api/model/github/tree*", (route) =>
      route.fulfill({ json: { paths: ["a.py", "b.py"], recent: [], truncated: false } }),
    );
    await page.route("**/api/settings/install/branches*", (route) =>
      route.fulfill({ json: { branches: ["devel", "master"], default: "devel", recent_refs: [] } }),
    );
    await page.goto("/");

    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-new-model").click();
    await escapeClosesDialog(page, page.getByTestId("prompt-modal"));

    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    await escapeClosesDialog(page, page.getByTestId("file-browser-modal"));

    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-dev-tests").click();
    await escapeClosesDialog(page, page.getByTestId("developer-tests-modal"));

    // The developer badge's own menu.
    await page.getByTestId("developer-mode-indicator").click();
    await escapeClosesMenu(page, page.getByTestId("developer-mode-menu"));

    // From GitHub: a combobox's list inside it closes first, the dialog after.
    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: "From GitHub repo..." }).click();
    const github = page.getByTestId("github-file-loader-modal");
    await expect(github).toBeVisible();
    // The Branch combobox lists the stubbed branches; the Repo one lists only
    // repos remembered from installs, none here.
    await github.getByRole("button", { name: "Toggle dropdown" }).nth(1).click();
    const list = github.getByTestId("combobox-list");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(github).toBeVisible();
    await escapeClosesDialog(page, github);
  });

  test("a dialog over Settings closes alone, then Settings", async ({ page }) => {
    // Move… is offered only for a project folder that is not fixed by the
    // environment, which the harness's is; point the backend at a scratch
    // folder for this test, as project-folder-move.spec.ts does.
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), "dialogs1289-move-"));
    const src = path.join(root, "models");
    mkdirSync(src, { recursive: true });
    const cleared = await (await page.request.post("/api/test/models-dir", { data: { path: null } })).json();
    try {
      expect((await page.request.post("/api/catalogs/project-folder", { data: { path: src } })).ok()).toBe(true);
      await page.goto("/");
      await page.getByTestId("settings-button").click();
      const settings = page.getByTestId("settings-panel");
      await expect(settings).toBeVisible();
      await page.getByTestId("settings-section-folders").click();
      await page.getByTestId("project-folder-move").click();
      await escapeClosesDialog(page, page.getByTestId("project-folder-move-dialog"));
      await expect(settings).toBeVisible();
      await escapeClosesDialog(page, settings);
    } finally {
      await page.request.post("/api/test/models-dir", { data: { path: cleared.previous } });
    }
  });

  test("the dialogs over a model: Save a copy, Convert, the last-good diff", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel(true);
    await openFromPath(page, model);

    await page.getByTestId("toolbar-save-copy").click();
    await escapeClosesDialog(page, page.getByTestId("save-copy-dialog"));

    // Convert to Standard Format?, from the expanded diagnostics panel.
    await page.locator(".diagnostics-collapsed-bar").click();
    await page.getByRole("button", { name: "Convert to Standard Format" }).click();
    await escapeClosesDialog(page, page.getByTestId("convert-confirm-dialog"));

    // Break the file on disk, as an external editor would: the graph holds the
    // last version that built (#1030), and its banner offers the comparison.
    writeFileSync(model, readFileSync(model, "utf8") + "\nthis is not python (\n");
    await page.getByRole("button", { name: "Compare with that version" }).click({ timeout: 60_000 });
    await escapeClosesDialog(page, page.getByTestId("last-good-diff"));
  });

  test("the file-changed dialog: Escape keeps my changes; then Changes since save", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);

    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n# edited in PsyNeuView, not saved\n");

    // Another editor saves underneath.
    writeFileSync(model, BASE.replace("name='sender_mech'", "name='sender_mech_renamed'"));
    const modal = page.getByTestId("external-change-modal");
    await expect(modal).toBeVisible({ timeout: 60_000 });
    await expect(modal.getByTestId("dialog-close")).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(editor).toContainText("edited in PsyNeuView, not saved");

    // Changes since save (#1348), from the unsaved dot those edits put up.
    await page.getByTestId("unsaved-dot").click();
    await escapeClosesDialog(page, page.getByTestId("changes-since-save"));
    await expect(editor).toContainText("edited in PsyNeuView, not saved");
  });

  test("Revert the file to this save (#1349): Escape writes nothing", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    const save = page.getByRole("button", { name: "Save", exact: true });
    const editor = page.locator(".cm-content");
    for (const note of ["# first save", "# second save"]) {
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(`\n${note}\n`);
      await save.click();
      await expect(save).toBeDisabled({ timeout: 30_000 });
    }
    const onDisk = readFileSync(model, "utf8");

    await page.getByTestId("history-button").click();
    await page.getByTestId("history-save-marker").first().click();
    await page.getByTestId("history-revert-save").click();
    await escapeClosesDialog(page, page.getByTestId("revert-to-save"));
    expect(readFileSync(model, "utf8")).toBe(onDisk);
  });

  test("the palette's compact flyout", async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      localStorage.setItem("psyneuview.components.start", "strip");
      localStorage.setItem("psynewview_palette_open", "true");
    });
    await openFromPath(page, scratchModel());
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette).toBeVisible();
    await palette.locator("div[title]").first().click();
    await escapeClosesMenu(page, page.getByTestId("palette-compact-flyout"));
  });

  test("the first-launch offer", async ({ page }) => {
    await page.addInitScript((key) => localStorage.removeItem(key), ORIENTATION_OFFER_KEY);
    await page.goto("/");
    await escapeClosesDialog(page, page.getByTestId("orientation-offer"));
  });
});
