/**
 * A walkthrough's ring doesn't show through a dialog (#1394).
 *
 * The ring layer sits above every dialog so the orientation walkthroughs can
 * ring things inside Settings. A step anchored behind a dialog (here, a canvas
 * node) drew its ring on top of Settings, framing nothing.
 */
import { mutatingTest as test, expect } from "./test-base";

test.describe("Walkthrough ring and dialogs", { tag: "@ci" }, () => {
  test("a canvas node's ring hides while Settings is open, and comes back after", async ({ page }) => {
    await page.goto("/?tour=demo");
    const ring = page.getByTestId("tour-highlight");
    await expect(ring).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await expect(ring).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
    await expect(ring).toBeVisible();
  });

  test("a step inside Settings still rings its item", async ({ page }) => {
    await page.goto("/?tour=orientation-settings");
    await page.getByTestId("settings-button").click();
    const general = page.getByTestId("settings-section-general");
    await expect(general).toBeVisible();
    // Opening Settings does step 1; the walkthrough then moves to General.
    await expect(page.getByTestId("tour-bar")).toContainText("step 2 of", { timeout: 10_000 });
    const ring = page.getByTestId("tour-highlight");
    await expect(ring).toBeVisible();
    // The ring sits 8px outside the anchor on every side.
    await expect
      .poll(async () => {
        const r = (await ring.boundingBox())!;
        const g = (await general.boundingBox())!;
        return Math.max(Math.abs(r.x + 8 - g.x), Math.abs(r.y + 8 - g.y));
      })
      .toBeLessThan(3);
  });
});
