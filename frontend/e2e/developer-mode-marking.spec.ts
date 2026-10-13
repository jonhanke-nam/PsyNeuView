/**
 * Everything developer mode adds says so (#1291).
 *
 * With developer mode on: a Developer indicator in the toolbar; the Open
 * menu's catalogs under development and its Developer / Tests entry carry the
 * Developer badge; so do Settings' developer-only groups. A catalog the user
 * switched on in Settings is shown for a different reason and is not marked.
 * With developer mode off, none of that is visible. The indicator's menu
 * turns the mode off, and opens Settings at its Developer section.
 */
import { readOnlyTest as test, expect, SHOWN_DEV_SECTIONS_KEY } from "./test-base";

type Page = import("@playwright/test").Page;

const DEV_MODE_KEY = "psynewview_ui_prefs_developerMode";

async function openMenu(page: Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
}

test.describe("developer mode is marked", { tag: "@ci" }, () => {
  test.beforeEach(async ({ page }) => {
    // The shared fixture switches the catalogs under development on; start
    // from a regular user's state instead.
    await page.addInitScript((key) => localStorage.removeItem(key), SHOWN_DEV_SECTIONS_KEY);
  });

  test("off: no indicator, no badges, no developer-only items", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(page.getByTestId("developer-mode-indicator")).toHaveCount(0);
    await openMenu(page);
    await expect(page.getByRole("button", { name: /Developer \/ Tests/ })).toHaveCount(0);
    await expect(page.getByTestId("developer-badge")).toHaveCount(0);
  });

  test("on: the indicator shows, dev-only sections and the Tests entry carry the badge", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "true"), DEV_MODE_KEY);
    await page.goto("/");
    const indicator = page.getByTestId("developer-mode-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveText("Developer");

    await openMenu(page);
    const tests = page.getByRole("button", { name: /Developer \/ Tests/ });
    await expect(tests.getByTestId("developer-badge")).toBeVisible();
    for (const name of [/Demo Models/, /Reference Models/]) {
      const header = page.getByRole("button", { name });
      await expect(header.getByTestId("developer-badge")).toBeVisible();
      await expect(header.getByTestId("developer-badge")).toHaveAttribute(
        "title",
        "Shown because developer mode is on; regular users don't see this",
      );
    }
    // The everyday sections are not marked.
    await expect(page.getByRole("button", { name: /My Project Folder/ }).getByTestId("developer-badge")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /PsyNeuLink Library/ }).getByTestId("developer-badge")).toHaveCount(0);
  });

  test("a catalog the user switched on in Settings is not marked, even with developer mode on", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "true"), DEV_MODE_KEY);
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify(["demos"])), SHOWN_DEV_SECTIONS_KEY);
    await page.goto("/");
    await openMenu(page);
    await expect(page.getByRole("button", { name: /Demo Models/ }).getByTestId("developer-badge")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Reference Models/ }).getByTestId("developer-badge")).toBeVisible();
  });

  test("Settings: the developer-only settings carry the badge; the sidebar says (advanced) instead", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    const developerTab = page.getByTestId("settings-section-developer");
    await expect(developerTab).toHaveText("Developer (advanced)");
    await expect(page.getByTestId("settings-sidebar").getByTestId("developer-badge")).toHaveCount(0);
    await developerTab.click();
    const badge = page.getByTestId("settings-group-pnl-install").getByTestId("developer-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-audience", "developers");
  });

  test("the indicator's menu turns developer mode off, and opens Settings at Developer", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "true"), DEV_MODE_KEY);
    await page.goto("/");
    const indicator = page.getByTestId("developer-mode-indicator");

    await indicator.click();
    await page.getByTestId("developer-mode-settings").click();
    await expect(page.getByTestId("settings-content-developer")).toBeVisible();
    await expect(page.getByTestId("setting-developer-mode")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);

    await indicator.click();
    await page.getByTestId("developer-mode-turn-off").click();
    await expect(indicator).toHaveCount(0);
    await openMenu(page);
    await expect(page.getByRole("button", { name: /Developer \/ Tests/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Demo Models/ })).toBeHidden();
    // And the one control agrees.
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-developer").click();
    await expect(page.getByTestId("setting-developer-mode")).not.toBeChecked();
  });
});
