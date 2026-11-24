/**
 * Run-panel input-grouping toggle (#570).
 *
 * The Inputs can be arranged by trial (each trial's nodes together, the
 * default since #331) or by node (each node's trials together). This spec
 * loads a two-input-node model, opens the Run tab, and asserts both layouts
 * render distinctly, that an edit survives a toggle, and that a by-node
 * choice is kept.
 */
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";

test.describe("run panel input grouping", { tag: "@ci" }, () => {
  test("toggles between by-trial and by-node layouts", async ({ page }) => {
    await page.goto("/");

    // Load the two-input fixture via Open ▾ → Open from path…
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path…" }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(fixturePath("two_input_nodes"));
    await prompt.press("Enter");
    await expect(page.getByText("two_input_nodes.py").first()).toBeVisible({ timeout: 30000 });

    // Open the Run tab.
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: /Run Model/ })).toBeVisible();

    const panel = page.getByTestId("run-panel");

    // Default (#331): by trial — trial group headers, node names as row
    // labels, no per-node "[N elements]" headers.
    await expect(panel.getByText("Arrange inputs:", { exact: true })).toBeVisible();
    await expect(panel.getByText(/^Trial 1$/).first()).toBeVisible();
    await expect(panel.getByText(/^input_a$/).first()).toBeVisible();
    await expect(panel.getByText(/^input_b$/).first()).toBeVisible();
    await expect(panel.getByText(/input_a\s*\[2 element/)).toHaveCount(0);

    // An edit made by trial persists when switching to by node (both
    // layouts read/write the same trial texts).
    await panel.getByTestId("run-trial-input-input_a-1").fill("[7.5, 0]");

    // By node — each node is a header, no bare node-name row labels.
    await page.getByRole("button", { name: "By node", exact: true }).click();
    await expect(panel.getByText(/input_a\s*\[2 element/)).toBeVisible();
    await expect(panel.getByText(/input_b\s*\[3 element/)).toBeVisible();
    await expect(panel.getByText(/^input_a$/)).toHaveCount(0);
    await expect(panel.getByTestId("run-trial-input-input_a-1")).toHaveValue("[7.5, 0]");

    // The choice is stored, so the next session opens by node (the default
    // and the kept choice are unit-tested in uiStoreInputs.test.ts).
    await expect(page.getByRole("button", { name: "By node", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("psyneuview_ui_prefs_inputGrouping"))).toBe("byNode");
  });
});
