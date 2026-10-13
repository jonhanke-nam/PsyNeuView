import { readOnlyTest as test, expect } from "./test-base";

// #874: model load time is surfaced in the UI. After a load, the Model
// Diagnostics bar shows "loaded in X.Xs"; expanding it reveals the breakdown.
test("surfaces model load time in the Model Diagnostics bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });

  await page.getByRole("button", { name: /Open/ }).first().click();
  await page
    .getByText("Conflict Monitoring — Stroop (Botvinick et al. 2001)", { exact: true })
    .first()
    .click();

  // Graph paints.
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });

  // Collapsed diagnostics bar shows the persistent "loaded in X.Xs" record.
  const loadedIn = page.getByText(/loaded in \d/i);
  await expect(loadedIn).toBeVisible({ timeout: 10000 });

  // Expanding the bar reveals the "Load time" row + a breakdown toggle.
  // ("Load time:" appears in both the Diagnostics bar and the Inspector — both
  // are intended, so scope to the first.)
  await loadedIn.click();
  await expect(page.getByText(/Load time:/i).first()).toBeVisible();
  await page.getByRole("button", { name: /breakdown/i }).click();
  await expect(page.getByText(/network \d+ms/i)).toBeVisible();
});
