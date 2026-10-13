/**
 * A saved custom layout is restored on open (#614).
 *
 * stroop_with_lc ships a curated layout sidecar (stroop_reference_with_lc.pnlview.json
 * with hand-arranged positions). Before the fix, opening a model always
 * defaulted to Auto layout, so the saved sidecar was ignored until the user
 * manually toggled to Custom. The fix activates Custom on a fresh open when the
 * model carries saved positions. Asserting the toolbar opens in "Layout: Custom"
 * is a precise regression guard.
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "reference_models",
  "stroop_reference_with_lc.py",
);

/** Open MODEL via the Open-from-path flow and wait for the graph to draw. */
async function openFromPath(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await page
    .getByRole("button", { name: /^Skip$/ })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({
    timeout: 30000,
  });
}

test.describe("restore saved layout on open (#614)", { tag: "@ci" }, () => {
  test("a model with a saved sidecar opens in Custom layout", async ({ page }) => {
    await page.goto("/");
    await openFromPath(page);

    // The toolbar layout toggle reads "Layout: Custom" because the model's
    // saved sidecar was restored on open (vs the old default of "Layout: Auto").
    await expect(page.getByText(/^Layout: Custom$/)).toBeVisible({
      timeout: 15000,
    });
  });

  test("re-opening the same model re-picks Custom after a manual switch to Auto (#906)", async ({
    page,
  }) => {
    await page.goto("/");
    await openFromPath(page);
    await expect(page.getByText(/^Layout: Custom$/)).toBeVisible({ timeout: 15000 });

    // Switch to Auto by hand. The toggle is a single button that flips modes.
    await page.getByRole("button", { name: /^Layout: Custom$/ }).click();
    await expect(page.getByText(/^Layout: Auto$/)).toBeVisible({ timeout: 15000 });

    // Re-open the *same* path. Before #906 the layout mode was sticky — the
    // model stayed in Auto and its curated sidecar was ignored, because the
    // fresh-open flag was only set when the file path actually changed.
    await openFromPath(page);
    await expect(
      page.getByText(/^Layout: Custom$/),
      "re-opening the model kept the stale Auto mode instead of re-reading its sidecar (#906)",
    ).toBeVisible({ timeout: 15000 });
  });
});
