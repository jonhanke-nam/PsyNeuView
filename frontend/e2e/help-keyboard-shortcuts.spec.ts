/**
 * Help ▸ Keyboard Shortcuts (#292).
 *
 * The toolbar's Help menu opens a read-only reference that lists every
 * shortcut in the registry; a shortcut rebound in Settings is marked
 * "changed" with its default beside it, and Reset all clears the mark; ⌘/
 * (Ctrl+/) and "?" open it; and it links to Settings ▸ Keyboard shortcuts,
 * which links back.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { SHORTCUTS } from "../src/shortcuts/registry";

type Page = import("@playwright/test").Page;

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
}

test.describe("Help ▸ Keyboard Shortcuts", { tag: "@ci" }, () => {
  test("the Help menu has its four items, and the reference lists every shortcut", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("help-menu-button").click();
    const menu = page.getByTestId("help-menu-list");
    await expect(menu.getByRole("menuitem")).toHaveText([
      /^Keyboard Shortcuts/,
      "Tutorials and walkthroughs",
      "Report a Problem…",
      "About PsyNeuView",
    ]);
    await menu.getByTestId("help-menu-shortcuts").click();
    await expect(menu).toHaveCount(0);

    const reference = page.getByTestId("shortcuts-reference");
    await expect(reference).toBeVisible();
    for (const shortcut of SHORTCUTS) {
      const row = reference.getByTestId(`shortcuts-reference-row-${shortcut.id}`);
      await expect(row, shortcut.id).toContainText(shortcut.label);
      await expect(reference.getByTestId(`shortcuts-reference-keys-${shortcut.id}`), shortcut.id).not.toBeEmpty();
    }
    await expect(reference.locator('[data-testid^="shortcuts-reference-row-"]')).toHaveCount(SHORTCUTS.length);
    await expect(reference.getByTestId("shortcuts-reference-summary")).toHaveText("Every shortcut is on its default.");
    // Not inside the Mac app: no native menu keys.
    await expect(reference.getByTestId("shortcuts-reference-native")).toHaveCount(0);

    // The search narrows it.
    await reference.getByTestId("shortcuts-reference-search").fill("redo");
    await expect(reference.locator('[data-testid^="shortcuts-reference-row-"]')).toHaveCount(1);

    // Escape closes it (the search box has focus; it never fires "?").
    await page.keyboard.press("Escape");
    await expect(reference).toHaveCount(0);
  });

  test("⌘/ (Ctrl+/) and ? open it; ? does nothing while typing", async ({ page }) => {
    await openApp(page);
    const reference = page.getByTestId("shortcuts-reference");

    await page.keyboard.press("ControlOrMeta+/");
    await expect(reference).toBeVisible();
    await page.getByTestId("shortcuts-reference-close").click();
    await expect(reference).toHaveCount(0);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("?");
    await expect(reference).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reference).toHaveCount(0);

    // In Settings' search field, "?" is just a character.
    await page.getByTestId("settings-button").click();
    const search = page.getByTestId("settings-search");
    await search.focus();
    await page.keyboard.press("?");
    await expect(search).toHaveValue("?");
    await expect(reference).toHaveCount(0);
  });

  test("a rebound shortcut is marked changed with its default; Reset all clears it; each page links to the other", async ({ page }) => {
    await openApp(page);

    // Rebind Show Inspector in Settings.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-shortcuts").click();
    const chip = page.getByTestId("shortcut-binding-inspector.focus");
    await chip.click();
    await expect(chip).toHaveText("press keys…");
    await page.keyboard.press("ControlOrMeta+Shift+KeyK");
    await expect(chip).toHaveText(/^(⇧⌘K|Ctrl\+Shift\+K)$/);

    // Settings links to the reference, which opens on top.
    await page.getByTestId("shortcuts-open-reference").click();
    const reference = page.getByTestId("shortcuts-reference");
    await expect(reference).toBeVisible();
    await expect(reference.getByTestId("shortcuts-reference-summary")).toHaveText("1 shortcut changed from the defaults");
    await expect(reference.getByTestId("shortcuts-reference-row-inspector.focus")).toHaveAttribute("data-changed", "true");
    await expect(reference.getByTestId("shortcuts-reference-changed-inspector.focus")).toHaveText(
      /^changed \(default (⌘I|Ctrl\+I)\)$/
    );
    await expect(reference.getByTestId("shortcuts-reference-keys-inspector.focus")).toHaveText(/^(⇧⌘K|Ctrl\+Shift\+K)$/);
    // Nothing else is marked.
    await expect(reference.locator('[data-changed="true"]')).toHaveCount(1);

    // Change shortcuts… goes back to Settings ▸ Keyboard shortcuts.
    await reference.getByTestId("shortcuts-reference-open-settings").click();
    await expect(reference).toHaveCount(0);
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await expect(page.getByTestId("setting-keyboard-shortcuts")).toBeVisible();

    // Reset all, and the mark is gone.
    const resetAll = page.getByTestId("shortcuts-reset-all");
    await resetAll.click();
    await expect(resetAll).toBeDisabled();
    await expect(chip).toHaveText(/^(⌘I|Ctrl\+I)$/);
    await page.keyboard.press(`${mod}+/`);
    await expect(reference).toBeVisible();
    await expect(reference.getByTestId("shortcuts-reference-summary")).toHaveText("Every shortcut is on its default.");
    await expect(reference.locator('[data-changed="true"]')).toHaveCount(0);
  });

  test("Help's other items open the Tutorials menu and Settings ▸ About", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("help-menu-button").click();
    await page.getByTestId("help-menu-tutorials").click();
    await expect(page.getByTestId("walkthrough-menu-list")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("walkthrough-menu-list")).toHaveCount(0);

    await page.getByTestId("help-menu-button").click();
    await page.getByTestId("help-menu-about").click();
    await expect(page.getByTestId("settings-content-about")).toBeVisible();
    await page.keyboard.press("Escape");

    // In a browser, Report a Problem leads to Download diagnostics.
    await page.getByTestId("help-menu-button").click();
    await page.getByTestId("help-menu-report").click();
    await expect(page.getByTestId("download-diagnostics")).toBeVisible();
  });
});
