/**
 * The Tutorials menu's sections fold (#8).
 *
 * First run opens First Steps and folds the rest, so the menu opens short. A
 * heading folds or unfolds its walkthroughs, the choice survives a reload, and
 * the running walkthrough's section opens when the menu does.
 *
 * The shared fixture opens every section for other specs; these set the state
 * they need in their own init scripts, which run after the fixture's.
 */
import { readOnlyTest, mutatingTest, expect, TUTORIALS_FOLDED_KEY } from "./test-base";
import type { Page } from "@playwright/test";

async function openMenu(page: Page) {
  await page.getByTestId("walkthrough-menu").click();
  await expect(page.getByTestId("walkthrough-menu-list")).toBeVisible();
}

readOnlyTest.describe("Tutorials menu sections fold", { tag: "@ci" }, () => {
  readOnlyTest("first run: First Steps open, the others folded", async ({ page }) => {
    // Clear the fixture's seed once, so the app sees a real first run.
    await page.addInitScript((key) => {
      if (!sessionStorage.getItem("fold-spec-cleared")) {
        localStorage.removeItem(key);
        sessionStorage.setItem("fold-spec-cleared", "1");
      }
    }, TUTORIALS_FOLDED_KEY);
    await page.goto("/");
    await openMenu(page);

    await expect(page.getByTestId("tutorials-section-orientation")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("walkthrough-orientation-window")).toBeVisible();
    for (const id of ["general", "psyneulink", "course"]) {
      await expect(page.getByTestId(`tutorials-section-${id}`)).toHaveAttribute("aria-expanded", "false");
    }
    await expect(page.getByTestId("walkthrough-demo")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-pnl-mechanism")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-ego")).toHaveCount(0);
    // A folded heading says how many walkthroughs it holds.
    await expect(page.getByTestId("tutorials-section-course")).toContainText("14");
  });

  readOnlyTest("folding and unfolding survives a reload", async ({ page }) => {
    await page.goto("/");
    await openMenu(page);
    // The fixture opens everything; fold First Steps, keep the course open.
    await page.getByTestId("tutorials-section-orientation").click();
    await expect(page.getByTestId("walkthrough-orientation-window")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-ego")).toBeVisible();

    await page.reload();
    await openMenu(page);
    await expect(page.getByTestId("tutorials-section-orientation")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("walkthrough-orientation-window")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-ego")).toBeVisible();

    // And back.
    await page.getByTestId("tutorials-section-orientation").click();
    await expect(page.getByTestId("walkthrough-orientation-window")).toBeVisible();
  });

  readOnlyTest("folding keeps the heading's height", async ({ page }) => {
    await page.goto("/");
    await openMenu(page);
    const heading = page.getByTestId("tutorials-section-course");
    const open = await heading.boundingBox();
    await heading.click();
    const shut = await heading.boundingBox();
    expect(Math.round(shut!.height)).toBe(Math.round(open!.height));
  });
});

mutatingTest.describe("Tutorials menu sections fold, while a walkthrough runs", { tag: "@ci" }, () => {
  mutatingTest("the running walkthrough's section opens with the menu", async ({ page }) => {
    // Everything folded, then start the general "demo" walkthrough by URL.
    await page.addInitScript(([key]) => {
      if (!sessionStorage.getItem("fold-spec-seeded")) {
        localStorage.setItem(key, JSON.stringify(["orientation", "general", "psyneulink", "course"]));
        sessionStorage.setItem("fold-spec-seeded", "1");
      }
    }, [TUTORIALS_FOLDED_KEY]);
    await page.goto("/?tour=demo");
    await expect(page.getByTestId("tour-instruction")).toBeVisible({ timeout: 30000 });

    await openMenu(page);
    await expect(page.getByTestId("tutorials-section-general")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("walkthrough-demo")).toBeVisible();
    // The others stay as they were.
    await expect(page.getByTestId("tutorials-section-course")).toHaveAttribute("aria-expanded", "false");
  });
});
