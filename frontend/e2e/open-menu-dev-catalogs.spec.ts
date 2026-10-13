/**
 * Catalogs under development stay out of the Open menu unless asked for (#1228).
 *
 * Only My Project Folder and the PsyNeuLink Library are for everyday use. Examples,
 * Reference Models and Demo Models show in developer mode, or once switched on
 * in Settings, and say "(under development)" when they do.
 *
 * The shared fixture switches them all on (most specs open a reference model),
 * so each test here clears that first: init scripts run in the order added.
 */
import { readOnlyTest as test, expect, SHOWN_DEV_SECTIONS_KEY } from "./test-base";

const DEV_HEADERS = [/PsyNeuLink Examples/, /Reference Models/, /Demo Models/];

async function openMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
}

test.describe("Open menu: catalogs under development", { tag: "@ci" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => localStorage.removeItem(key), SHOWN_DEV_SECTIONS_KEY);
  });

  test("hidden by default, leaving My Project Folder and the PsyNeuLink Library", async ({ page }) => {
    await page.goto("/");
    await openMenu(page);
    await expect(page.getByRole("button", { name: /My Project Folder/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /PsyNeuLink Library/ })).toBeVisible();
    for (const header of DEV_HEADERS) {
      await expect(page.getByRole("button", { name: header })).toBeHidden();
    }
  });

  test("shown in developer mode, marked under development", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("psynewview_ui_prefs_developerMode", "true"));
    await page.goto("/");
    await openMenu(page);
    await expect(page.getByRole("button", { name: /Reference Models \(under development\)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Demo Models \(under development\)/ })).toBeVisible();
  });

  test("shown while a walkthrough runs, since some open their model from one", async ({ page }) => {
    // The Dynamics walkthrough opens the Bistable Attractor from Demo Models.
    await page.goto("/?tour=dynamics");
    await openMenu(page);
    await expect(page.getByRole("button", { name: "Bistable Attractor", exact: true })).toBeVisible();
  });

  test("one can be switched on without developer mode", async ({ page }) => {
    await page.addInitScript(
      (key) => localStorage.setItem(key, JSON.stringify(["demos"])),
      SHOWN_DEV_SECTIONS_KEY,
    );
    await page.goto("/");
    await openMenu(page);
    await expect(page.getByRole("button", { name: /Demo Models \(under development\)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reference Models/ })).toBeHidden();
  });
});
