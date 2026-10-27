/**
 * How the Components panel opens is a setting: Settings ▸ Appearance (#113).
 *
 * "Starts open, as the word list" is the default; "Starts as the icon strip"
 * opens it as the narrow strip. The panel's own ◀/▶ button switches it for
 * the session only, so a reload comes back as the setting says.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function chooseComponentsStart(page: Page, value: "open" | "strip") {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-components-start").selectOption(value);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();
}

test.describe("Components panel opening setting (#113)", { tag: "@ci" }, () => {
  test("Starts as the icon strip opens the strip after a reload", async ({ page }) => {
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByPlaceholder("Search components...")).toBeVisible();

    await chooseComponentsStart(page, "strip");
    // The choice shows straight away...
    await expect(palette.getByTitle("Expand palette")).toBeVisible();

    // ...and is how the panel opens next time.
    await page.reload();
    await expect(palette).toBeVisible();
    await expect(palette.getByTitle("Expand palette")).toBeVisible();
    await expect(palette.getByPlaceholder("Search components...")).toHaveCount(0);
  });

  test("◀ collapses it for the session only; a reload comes back open", async ({ page }) => {
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByPlaceholder("Search components...")).toBeVisible();

    await palette.getByTitle("Compact mode").click();
    await expect(palette.getByPlaceholder("Search components...")).toHaveCount(0);

    await page.reload();
    await expect(palette).toBeVisible();
    await expect(palette.getByPlaceholder("Search components...")).toBeVisible();
    await expect(palette.getByTitle("Compact mode")).toBeVisible();
  });
});
