/**
 * A walkthrough shows every panel while it runs and puts the learner's own
 * layout back when it ends (#189).
 *
 * The window opens with the graph alone, and walkthroughs point at the code
 * editor, the bottom panel's tabs and the Components panel. Started from the
 * graph-only layout, a walkthrough must still have those on screen, and must
 * not leave them behind as if the learner had chosen them.
 *
 * Uses "Settings in two minutes", which needs no model, so this is about the
 * layout alone.
 */
import { readOnlyTest as test, expect, LAYOUT_BOTTOM_VISIBLE_KEY, LAYOUT_CODE_VISIBLE_KEY } from "./test-base";
import { BEFORE_WALKTHROUGH_KEY, EVERYTHING, GRAPH_ONLY, PALETTE_OPEN_KEY, expectPanels } from "./panels";

type Page = import("@playwright/test").Page;

const TOUR = "orientation-settings";

/** Start from the graph alone, with the Components panel closed too. */
async function startGraphOnly(page: Page) {
  await page.addInitScript(
    ([code, bottom, palette]) => {
      // Set outright: the shared setup only fills these in when they are unset.
      localStorage.setItem(code, "false");
      localStorage.setItem(bottom, "false");
      localStorage.setItem(palette, "false");
    },
    [LAYOUT_CODE_VISIBLE_KEY, LAYOUT_BOTTOM_VISIBLE_KEY, PALETTE_OPEN_KEY] as const,
  );
}

async function openApp(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
}

async function startFromMenu(page: Page) {
  await page.getByTestId("walkthrough-menu").click();
  await page.getByTestId(`walkthrough-${TOUR}`).click();
  await expect(page.getByTestId("tour-bar")).toBeVisible();
}

test.describe("a walkthrough's layout (#189)", { tag: "@ci" }, () => {
  test("shows everything while it runs, and puts the graph-only layout back when stopped", async ({ page }) => {
    await startGraphOnly(page);
    await openApp(page);
    await expectPanels(page, GRAPH_ONLY);

    await startFromMenu(page);
    await expectPanels(page, EVERYTHING);

    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toBeHidden();
    await expectPanels(page, GRAPH_ONLY);
    // Nothing of the tutorial's layout is left in storage as a choice.
    expect(await page.evaluate((k) => localStorage.getItem(k), LAYOUT_CODE_VISIBLE_KEY)).toBe("false");
    expect(await page.evaluate((k) => localStorage.getItem(k), BEFORE_WALKTHROUGH_KEY)).toBeNull();
  });

  test("puts the layout back when it finishes on its own", async ({ page }) => {
    await startGraphOnly(page);
    await openApp(page);
    await startFromMenu(page);
    await expectPanels(page, EVERYTHING);

    // Skip to the end. A finished walkthrough closes its bar by itself.
    const skip = page.getByTestId("tour-skip");
    for (let i = 0; i < 40; i++) {
      if (!(await skip.isVisible().catch(() => false))) break;
      await skip.click();
    }
    await expect(page.getByTestId("tour-bar")).toBeHidden({ timeout: 15_000 });
    await expectPanels(page, GRAPH_ONLY);
  });

  test("a reload mid-walkthrough does not leave the tutorial layout behind", async ({ page }) => {
    await startGraphOnly(page);
    await openApp(page);
    await startFromMenu(page);
    await expectPanels(page, EVERYTHING);

    // The page comes back with no walkthrough running (it was started from
    // the menu, not a ?tour= link), so the layout from before comes back.
    await page.reload();
    await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tour-bar")).toBeHidden();
    await expectPanels(page, GRAPH_ONLY);
    expect(await page.evaluate((k) => localStorage.getItem(k), BEFORE_WALKTHROUGH_KEY)).toBeNull();
  });

  test("started from a link, a reload keeps the walkthrough and the learner's layout", async ({ page }) => {
    await startGraphOnly(page);
    await openApp(page, `/?tour=${TOUR}`);
    await expect(page.getByTestId("tour-bar")).toBeVisible({ timeout: 30_000 });
    await expectPanels(page, EVERYTHING);

    // The link starts it again; the layout remembered is still the graph alone.
    await page.reload();
    await expect(page.getByTestId("tour-bar")).toBeVisible({ timeout: 30_000 });
    await expectPanels(page, EVERYTHING);
    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toBeHidden();
    await expectPanels(page, GRAPH_ONLY);
  });
});
