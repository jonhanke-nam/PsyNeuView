/**
 * A walkthrough's ring doesn't show through a dialog (#1394).
 *
 * The ring layer sits above every dialog so the orientation walkthroughs can
 * ring things inside Settings. A step anchored behind a dialog (here, a canvas
 * node) drew its ring on top of Settings, framing nothing.
 *
 * The walkthrough bar is drawn above dialogs too, so dialogs stop above it:
 * it used to cover the last rows of Settings. And menus are above the ring,
 * the node menu included, so its pulse never covers an item being chosen.
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
    // The ring hugs the anchor: a little outside where there's room, just
    // inside where the neighbouring items are (#102). Never far off.
    await expect
      .poll(async () => {
        const r = (await ring.boundingBox())!;
        const g = (await general.boundingBox())!;
        return Math.max(
          Math.abs(r.x - g.x),
          Math.abs(r.y - g.y),
          Math.abs(r.x + r.width - (g.x + g.width)),
          Math.abs(r.y + r.height - (g.y + g.height)),
        );
      })
      .toBeLessThan(13);
  });

  test("Settings stops above the walkthrough bar, and fills the window again once it ends", async ({ page }) => {
    await page.goto("/?tour=demo");
    const bar = page.getByTestId("tour-bar");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("settings-button").click();
    const panel = page.getByTestId("settings-panel");
    await expect(panel).toBeVisible();
    const p = (await panel.boundingBox())!;
    const b = (await bar.boundingBox())!;
    expect(p.y + p.height, "Settings ends above the bar").toBeLessThanOrEqual(b.y + 1);
    await page.keyboard.press("Escape");

    await page.getByTestId("tour-dismiss").click();
    await expect(bar).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--pnv-tour-bar-height"))).toBe("");
  });

  test("the node menu is above the ring", async ({ page }) => {
    await page.goto("/?tour=demo");
    await expect(page.getByTestId("tour-highlight")).toBeVisible({ timeout: 30_000 });
    await page.locator(".react-flow__node").first().click({ button: "right" });
    const menu = page.getByTestId("node-context-menu");
    await expect(menu).toBeVisible();
    const z = (sel: string) => page.evaluate((s) => Number(getComputedStyle(document.querySelector(s)!.closest("[style*='z-index']") ?? document.querySelector(s)!).zIndex), sel);
    expect(await z('[data-testid="node-context-menu"]')).toBeGreaterThan(await z('[data-testid="tour-highlight"]'));
  });
});
