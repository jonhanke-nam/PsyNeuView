/**
 * Run-panel input-grouping toggle (#570).
 *
 * The Inputs list can group cells by-node (each node's trials together,
 * the default) or by-trial (each trial's nodes together). This spec loads
 * a two-input-node model, opens the Run tab, and asserts both layouts
 * render distinctly and that editing a cell survives a toggle.
 */
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";

test.describe("run panel input grouping", { tag: "@ci" }, () => {
  test("toggles between by-node and by-trial layouts", async ({ page }) => {
    await page.goto("/");

    // Load the two-input fixture via Open ▾ → Open from path...
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(fixturePath("two_input_nodes"));
    await prompt.press("Enter");
    await expect(page.getByText("two_input_nodes.py").first()).toBeVisible({ timeout: 30000 });

    // Open the Run tab.
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: /Run Model/ })).toBeVisible();

    const panel = page.getByTestId("run-panel");

    // Default: by-node — each node is a header, no bare node-name row labels.
    await expect(panel.getByText("Group by", { exact: true })).toBeVisible();
    await expect(panel.getByText(/input_a\s*\[2 element/)).toBeVisible();
    await expect(panel.getByText(/input_b\s*\[3 element/)).toBeVisible();
    await expect(panel.getByText(/^input_a$/)).toHaveCount(0);

    // Toggle to by-trial — trial group headers appear, node names become
    // row labels, and the per-node "[N elements]" headers disappear.
    await page.getByRole("button", { name: "Trial", exact: true }).click();
    await expect(panel.getByText(/^Trial 1$/).first()).toBeVisible();
    await expect(panel.getByText(/^input_a$/).first()).toBeVisible();
    await expect(panel.getByText(/^input_b$/).first()).toBeVisible();
    await expect(panel.getByText(/input_a\s*\[2 element/)).toHaveCount(0);

    // An edit made in by-trial persists when switching back to by-node
    // (both layouts read/write the same cell grid).
    await panel.locator('input[inputmode="decimal"]').first().fill("7.5");
    await page.getByRole("button", { name: "Node", exact: true }).click();
    await expect(panel.getByText(/input_a\s*\[2 element/)).toBeVisible();
    await expect(panel.locator('input[inputmode="decimal"]').first()).toHaveValue("7.5");
  });
});
