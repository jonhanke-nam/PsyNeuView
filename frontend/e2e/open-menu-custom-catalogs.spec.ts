/**
 * Your own catalogs in the Open menu, and My Project Folder (#1229).
 *
 * A folder added in Settings ▸ Folders becomes its own Open-menu section
 * listing its models, and removing it takes the section away without touching
 * the files.
 * The harness runs the backend on this machine with its own preferences file,
 * so the folder here is a real one it can read.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { readOnlyTest as test, expect } from "./test-base";

const MODEL = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\ncomp = pnl.Composition(pathways=[A])\n";

test.describe("Open menu: your own catalogs", { tag: "@ci" }, () => {
  test("a folder added in Settings is a section, and removing it leaves the files", async ({ page }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "pnv-catalog-"));
    mkdirSync(path.join(folder, "sub"));
    writeFileSync(path.join(folder, "lab_model.py"), MODEL);
    writeFileSync(path.join(folder, "sub", "nested_model.py"), MODEL);

    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await expect(page.getByRole("button", { name: /My Project Folder/ })).toBeVisible();
    await page.getByRole("button", { name: /Open/ }).first().click(); // closes it

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByTestId("settings-section-folders").click();
    const settings = page.getByTestId("catalog-settings");
    await settings.getByTestId("add-catalog-path").fill(folder);
    await settings.getByTestId("add-catalog-name").fill("Lab models");
    await settings.getByRole("button", { name: "Add", exact: true }).click();
    await expect(settings.getByText("Lab models")).toBeVisible();

    const res = await page.request.get("/api/catalogs");
    const [catalog] = (await res.json()).catalogs;
    try {
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: /Open/ }).first().click();
      await expect(page.getByRole("button", { name: /Lab models/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Lab Model/ })).toBeVisible();
      await expect(page.getByText("sub/nested_model.py")).toBeVisible();
    } finally {
      await page.request.delete(`/api/catalogs/${catalog.id}`);
    }
    expect(existsSync(path.join(folder, "lab_model.py"))).toBe(true);

    await page.reload();
    await page.getByRole("button", { name: /Open/ }).first().click();
    await expect(page.getByRole("button", { name: /Lab models/ })).toBeHidden();
  });
});
