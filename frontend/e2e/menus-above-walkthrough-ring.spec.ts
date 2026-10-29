/**
 * A menu someone opens is never covered by the walkthrough's ring.
 *
 * In 0.6.6 the Tutorials menu opened under the pulsing ring round the code
 * editor (step 2 of First Steps part 1). The ring layer is click-through, so
 * the test makes it hit-testable for a moment and asks what is on top at
 * each menu item: it must be the menu, not the ring.
 */
import { mutatingTest as test, expect } from "./test-base";

test("the Tutorials, Open and Layout menus open above the walkthrough ring", { tag: "@ci" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?tour=orientation-window");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tour-next").click(); // step 2 rings the code editor, under the menus
  await expect(page.getByTestId("tour-bar")).toContainText("step 2 of");
  await expect(page.getByTestId("tour-highlight")).toBeVisible();

  for (const [button, list] of [
    ["walkthrough-menu", "walkthrough-menu-list"],
    ["layout-menu", "layout-menu-list"],
  ] as const) {
    const btn = page.getByTestId(button);
    if (!(await btn.count())) continue;
    await btn.click();
    await expect(page.getByTestId(list)).toBeVisible();
    const covered = await page.evaluate((listId) => {
      const overlay = document.querySelector('[data-testid="tour-overlay"]') as HTMLElement;
      const ring = document.querySelector('[data-testid="tour-highlight"]') as HTMLElement;
      overlay.style.pointerEvents = "auto";
      ring.style.pointerEvents = "auto";
      const list = document.querySelector(`[data-testid="${listId}"]`) as HTMLElement;
      const box = list.getBoundingClientRect();
      const items = Array.from(list.querySelectorAll('[role="menuitem"], button'));
      const bad: string[] = [];
      for (const it of items) {
        const r = it.getBoundingClientRect();
        if (!r.width) continue;
        // Only items shown: one scrolled past the menu's own edge isn't drawn.
        // The edge itself is outside: an item cut in half there has its
        // middle on the menu's last row of pixels, where the page hit-tests
        // whatever lies below the menu.
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (y < box.top || y >= box.bottom || y >= window.innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top && overlay.contains(top)) bad.push((it.textContent ?? "").trim().slice(0, 40));
      }
      overlay.style.pointerEvents = "";
      ring.style.pointerEvents = "";
      return bad;
    }, list);
    expect(covered, `${button}: items under the walkthrough ring`).toEqual([]);
    await page.keyboard.press("Escape");
  }
});
