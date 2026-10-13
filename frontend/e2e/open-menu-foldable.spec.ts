/**
 * Foldable catalog sections in the Open menu (#845).
 *
 * Each top-level section header (Reference Models, Demo Models, …) collapses to
 * cut the scroll; the collapsed set persists across reloads (localStorage).
 */
import { mutatingTest as test, expect, COLLAPSED_SECTIONS_KEY } from "./test-base";

const DEMO_ITEM = "Simple Stroop";

test.describe("Open menu: foldable sections", { tag: "@ci" }, () => {
  test("collapse hides a section's items, expand restores, and it persists", async ({ page }) => {
    await page.goto("/");
    const openBtn = page.getByRole("button", { name: /Open/ }).first();
    const item = () => page.getByRole("button", { name: DEMO_ITEM, exact: true });
    const demoHeader = () => page.getByRole("button", { name: /Demo Models/ });

    await openBtn.click();
    await expect(item()).toBeVisible();

    // Collapse → items gone.
    await demoHeader().click();
    await expect(item()).toBeHidden();

    // Persist across a full reload (state comes from localStorage).
    await page.reload();
    await openBtn.click();
    await expect(item()).toBeHidden();

    // Expand → items back.
    await demoHeader().click();
    await expect(item()).toBeVisible();
  });

  /**
   * The menu opens with every section folded (#1135), so it opens short.
   *
   * This is the one spec that must see the real first-run state, so it clears
   * the key the shared fixture seeds. Init scripts run in order, and this one
   * is registered later, so it wins.
   */
  test("sections start folded on a first visit, and expand on click", async ({ page }) => {
    await page.addInitScript((key) => localStorage.removeItem(key), COLLAPSED_SECTIONS_KEY);
    await page.goto("/");

    const openBtn = page.getByRole("button", { name: /Open/ }).first();
    const item = () => page.getByRole("button", { name: DEMO_ITEM, exact: true });

    await openBtn.click();
    await expect(item()).toBeHidden();

    await page.getByRole("button", { name: /Demo Models/ }).click();
    await expect(item()).toBeVisible();
  });
});
