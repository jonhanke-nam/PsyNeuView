import { readOnlyTest as test, expect } from "./test-base";

// #879: load-time messages (version mismatch, module-level-driver notices) are
// surfaced persistently in the Model Diagnostics bar for EVERY load path —
// including reference models, which previously dropped them silently — instead
// of flashing as 2s toasts that can't be reviewed.
//
// The Stroop reference model declares `# PsyNeuLink: 0.18.0.0`, so against the
// current build it produces a version-mismatch warning.
test("surfaces a reference model's version-mismatch warning in the Diagnostics bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });

  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText("Stroop — Basic", { exact: true }).first().click();

  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });

  // The warning lives in the (persistent) Diagnostics bar — expand it and read.
  // #109: no "click to expand" line; the bar's tooltip says it, and a click
  // on the bar (away from the file-watch status at its right end) expands it.
  const bar = page.locator(".diagnostics-collapsed-bar");
  await expect(bar).toHaveAttribute("title", /click to expand/i);
  await expect(bar).toHaveAttribute("data-tone", "attention");
  await bar.click({ position: { x: 20, y: 6 } });
  await expect(page.getByText(/written for PsyNeuLink 0\.18/i)).toBeVisible({ timeout: 5000 });
});
