/**
 * A walkthrough step inside the Open menu opens the menu again (#170).
 *
 * "Opening a model" opens the Open menu in step 1 and walks down its items.
 * Once the menu closed (Escape, a click elsewhere), step 2 narrated New Model
 * with nothing on screen to point at. Its steps now name the menu
 * (`within: open-menu`), and the walkthrough reopens it.
 */
import { readOnlyTest as test, expect } from "./test-base";

test.describe("Walkthrough steps inside a menu", { tag: "@ci" }, () => {
  test("the Open menu reopens under New Model, after Escape and after a click elsewhere", async ({ page }) => {
    await page.goto("/?tour=orientation-open");
    const bar = page.getByTestId("tour-bar");
    await expect(bar).toContainText("step 1 of", { timeout: 30_000 });
    await page.getByTestId("open-menu").click();
    await expect(bar).toContainText("step 2 of", { timeout: 10_000 });

    const list = page.getByTestId("open-menu-list");
    const item = page.getByTestId("open-menu-new-model");
    const ring = page.getByTestId("tour-highlight");
    /** The ring sits on New Model: within a few pixels of it on every side. */
    const ringOnItem = async () => {
      await expect(item).toBeVisible({ timeout: 5_000 });
      await expect
        .poll(async () => {
          const r = await ring.boundingBox();
          const g = await item.boundingBox();
          if (!r || !g) return Infinity;
          return Math.max(
            Math.abs(r.x - g.x),
            Math.abs(r.y - g.y),
            Math.abs(r.x + r.width - (g.x + g.width)),
            Math.abs(r.y + r.height - (g.y + g.height)),
          );
        })
        .toBeLessThan(16);
    };
    await ringOnItem();

    await page.keyboard.press("Escape");
    await expect(list).toBeVisible({ timeout: 5_000 });
    await ringOnItem();

    // A click well away from the menu and the walkthrough bar.
    const toolbar = (await page.getByTestId("open-menu").boundingBox())!;
    await page.mouse.click(20, toolbar.y + toolbar.height + 120);
    await expect(list).toBeVisible({ timeout: 5_000 });
    await ringOnItem();
    await expect(bar).toContainText("step 2 of");
  });
});
