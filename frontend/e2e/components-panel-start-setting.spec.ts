/**
 * How the Components panel opens is a setting: Settings ▸ Appearance (#113).
 *
 * "Starts as the icon strip" is the default (#345); "Starts open, as the word
 * list" opens the search box and sections. The panel's own ◀/› button
 * switches it for the session only, so a reload comes back as the setting
 * says. The harness seeds the word list for the rest of the suite.
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
  test("a fresh app opens the panel as the icon strip (#345)", async ({ page }) => {
    // The harness seeds the word list; a fresh app has no stored choice.
    await page.addInitScript(() => localStorage.removeItem("psyneuview.components.start"));
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette).toBeVisible();
    await expect(palette.getByTitle("Show the full Components panel")).toBeVisible();
    await expect(palette.getByPlaceholder("Search components…")).toHaveCount(0);
  });

  test("Starts as the icon strip opens the strip after a reload", async ({ page }) => {
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByPlaceholder("Search components…")).toBeVisible();

    await chooseComponentsStart(page, "strip");
    // The choice shows straight away…
    await expect(palette.getByTitle("Show the full Components panel")).toBeVisible();

    // ...and is how the panel opens next time.
    await page.reload();
    await expect(palette).toBeVisible();
    await expect(palette.getByTitle("Show the full Components panel")).toBeVisible();
    await expect(palette.getByPlaceholder("Search components…")).toHaveCount(0);
  });

  test("◀ collapses it for the session only; a reload comes back open", async ({ page }) => {
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByPlaceholder("Search components…")).toBeVisible();

    // The setting names the fold button's two faces as the panel shows them.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-appearance").click();
    await expect(page.locator('label[for="setting-components-start"]')).toContainText("◀ when open, › in the strip");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toBeHidden();

    await expect(palette.getByTitle("Compact mode")).toHaveText("◀");
    await palette.getByTitle("Compact mode").click();
    await expect(palette.getByPlaceholder("Search components…")).toHaveCount(0);
    await expect(palette.getByTestId("palette-strip-expand")).toHaveText("›");

    await page.reload();
    await expect(palette).toBeVisible();
    await expect(palette.getByPlaceholder("Search components…")).toBeVisible();
    await expect(palette.getByTitle("Compact mode")).toBeVisible();
  });
});
