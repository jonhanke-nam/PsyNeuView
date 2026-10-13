import { readOnlyTest as test, expect } from "./test-base";

// #879: info/success toasts dwell long enough to read. The old flat 2s was too
// fast; the floor is now 4s (scaling with message length). This asserts a load
// success toast is still visible at 2.5s — it would have been gone under 2s.
test("success toast dwells past the old 2s window", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });

  await page.getByRole("button", { name: /Open/ }).first().click();
  await page
    .getByText("Conflict Monitoring — Stroop (Botvinick et al. 2001)", { exact: true })
    .first()
    .click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });

  // The success toast appears once the load completes.
  const toast = page.getByText(/Loaded reference model/i);
  await expect(toast).toBeVisible({ timeout: 10000 });

  // Still visible 2.5s later — comfortably inside the new 4s floor, but past the
  // old flat 2s dismiss.
  await page.waitForTimeout(2500);
  await expect(toast).toBeVisible();
});
