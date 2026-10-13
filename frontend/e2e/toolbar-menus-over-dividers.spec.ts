/**
 * Toolbar menus draw above the panel dividers, and the Tutorials menu fits the window (#1391).
 *
 * The dividers between panels are Allotment sashes at z-index 35. A menu below
 * that had the divider drawn through it, hiding part of every row wherever
 * the two crossed.
 */
import { readOnlyTest as test, expect } from "./test-base";
import type { Page } from "@playwright/test";

const SASH = '[class*="sash-module_sash"]';

/** Opens a menu at each width until a vertical divider crosses it; returns whether the menu is on top there. */
async function menuOnTopWhereDividerCrosses(page: Page, open: () => Promise<void>, listTestId: string) {
  for (const width of [1000, 800, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await open();
    const menu = page.getByTestId(listTestId);
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const sashes = await page.locator(SASH).evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).filter((r) => r.height > r.width).map((r) => ({ x: r.x + r.width / 2, top: r.y, bottom: r.y + r.height })),
    );
    const crossing = sashes.find((s) => s.x > box.x + 2 && s.x < box.x + box.width - 2 && s.top < box.y + box.height && s.bottom > box.y);
    if (!crossing) continue;
    const y = Math.max(box.y, crossing.top) + 20;
    return page.evaluate(
      ({ x, y, id }) => !!document.elementFromPoint(x, y)?.closest(`[data-testid="${id}"]`),
      { x: crossing.x, y, id: listTestId },
    );
  }
  throw new Error(`no window width put a divider across ${listTestId}`);
}

test.describe("Toolbar menus and panel dividers", { tag: "@ci" }, () => {
  test("the Tutorials menu is drawn above the divider it crosses", async ({ page }) => {
    const onTop = await menuOnTopWhereDividerCrosses(page, () => page.getByTestId("walkthrough-menu").click(), "walkthrough-menu-list");
    expect(onTop).toBe(true);
  });

  test("the Layout menu is drawn above the divider it crosses", async ({ page }) => {
    const onTop = await menuOnTopWhereDividerCrosses(page, () => page.getByRole("button", { name: /^Layout/ }).click(), "layout-menu-list");
    expect(onTop).toBe(true);
  });

  test("the Tutorials menu fits a short window and scrolls to its last item", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const menu = page.getByTestId("walkthrough-menu-list");
    const box = (await menu.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    const last = menu.locator('button[data-testid^="walkthrough-"]').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
});
