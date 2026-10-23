/**
 * Auto/Custom is picked per view (#47, #33).
 *
 * The nested view and the flat view keep separate saved positions (#719). A
 * model with positions saved only for the nested view opens in Custom; before
 * #47, switching to Flatten (all compositions) stayed in Custom although the
 * flat view had nothing saved, so the automatic layout (e.g. Like show_graph)
 * was never applied there. Switching views now re-picks the mode from that
 * view's saved positions, as a fresh open does.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import { mkdtempSync, copyFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function viewSelect(page: any) {
  return page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
    .first();
}

test("switching to a view with nothing saved goes back to Auto (#47)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120000);
  const dir = mkdtempSync(path.join(tmpdir(), "mode47-"));
  const model = path.join(dir, "nested_minimal.py");
  copyFileSync(fixturePath("nested_minimal"), model);
  // Nested-view positions only; no flatPositions.
  writeFileSync(
    path.join(dir, "nested_minimal.pnlview.json"),
    JSON.stringify({ version: 1, positions: { outer_in: { x: 0, y: 0 }, outer_out: { x: 400, y: 0 } } }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.getByText(/^Layout: Custom$/)).toBeVisible({ timeout: 30000 });

  await viewSelect(page).selectOption("__flat__");
  await expect(page.getByTestId("graph-canvas").getByText("inner_a", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText(/^Layout: Auto$/),
    "the flat view has no saved positions, so it should use the automatic layout",
  ).toBeVisible({ timeout: 15000 });
});
