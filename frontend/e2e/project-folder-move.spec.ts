/**
 * Move… moves My Project Folder, and the Open menu follows (#1295).
 *
 * The harness fixes the project folder through PSYNEWVIEW_MODELS_DIR, and
 * while that is set the folder can't be moved — by design, the variable
 * wins. So this spec clears the variable in the running backend through the
 * test-only endpoint, points the folder at a temp folder through the
 * preferences file (which the harness already redirects), moves it with the
 * real Settings dialog and the real backend, and puts the variable back in
 * its finally. The backend is on this machine, so the files can be checked.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { readOnlyTest as test, expect } from "./test-base";

const MODEL = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\ncomp = pnl.Composition(pathways=[A])\n";

test("Move… carries the models and sidecars, and lists them from the new place", { tag: "@ci" }, async ({ page }) => {
  // realpath: the backend resolves paths, and macOS puts /var behind /private.
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "pnv-move-"));
  const src = path.join(root, "models");
  mkdirSync(path.join(src, ".psyneuview"), { recursive: true });
  writeFileSync(path.join(src, "moved_model.py"), MODEL);
  writeFileSync(path.join(src, "moved_model.pnlview.json"), "{}");
  writeFileSync(path.join(src, ".psyneuview", "moved_model.labels.yaml"), "labels: {}\n");
  const dst = path.join(root, "Documents", "PsyNeuView-My-Models");
  const clash = path.join(root, "clash");
  mkdirSync(clash);
  writeFileSync(path.join(clash, "moved_model.py"), "something else\n");

  const cleared = await (await page.request.post("/api/test/models-dir", { data: { path: null } })).json();
  try {
    expect((await page.request.post("/api/catalogs/project-folder", { data: { path: src } })).ok()).toBe(true);

    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-folders").click();
    await expect(page.getByTestId("project-folder-current")).toHaveAttribute("title", src);
    await expect(page.getByTestId("project-folder-fixed")).toHaveCount(0);

    // A destination with a clashing name is refused, by name, and nothing moves.
    await page.getByTestId("project-folder-move").click();
    const dialog = page.getByTestId("project-folder-move-dialog");
    await dialog.getByTestId("project-folder-move-to").fill(clash);
    await dialog.getByTestId("project-folder-move-confirm").click();
    await expect(dialog.getByTestId("project-folder-move-error")).toContainText("moved_model.py");
    await expect(dialog.getByTestId("project-folder-move-error")).toContainText("Nothing was moved");
    expect(readFileSync(path.join(clash, "moved_model.py"), "utf8")).toBe("something else\n");
    expect(existsSync(path.join(src, "moved_model.py"))).toBe(true);

    // The real move.
    await dialog.getByTestId("project-folder-move-to").fill(dst);
    await dialog.getByTestId("project-folder-move-confirm").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("project-folder-current")).toHaveAttribute("title", dst);
    expect(existsSync(path.join(dst, "moved_model.py"))).toBe(true);
    expect(existsSync(path.join(dst, "moved_model.pnlview.json"))).toBe(true);
    expect(existsSync(path.join(dst, ".psyneuview", "moved_model.labels.yaml"))).toBe(true);
    expect(existsSync(src)).toBe(false);
    const prefs = await (await page.request.get("/api/catalogs")).json();
    expect(prefs.projectFolder.path).toBe(dst);
    expect(prefs.projectFolder.lastMove.ok).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();

    // The Open menu lists the model from the new place, and says where that is.
    await page.getByTestId("open-menu").click();
    await expect(page.getByRole("button", { name: /My Project Folder/ }).getByTestId("open-menu-section-source")).toHaveText(dst);
    await expect(page.getByTitle(path.join(dst, "moved_model.py"))).toBeVisible();
  } finally {
    await page.request.post("/api/test/models-dir", { data: { path: cleared.previous } });
  }
});
