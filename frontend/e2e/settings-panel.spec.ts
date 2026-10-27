/**
 * Settings: how it opens and closes (#1288), and its sections (#1290).
 *
 * Closing: the gear opens it. Escape closes it; a × in the fixed header is
 * visible however far down the content is scrolled, and closes it too; the
 * bottom Close button and a click outside still work. While a keyboard
 * shortcut is being recorded, Escape means "leave this shortcut alone" and
 * does not close Settings.
 *
 * Sections: a sidebar — About first, Developer (advanced) last, Folders for
 * every folder (#1295), Problem reports only inside the Mac app — each opening
 * from the sidebar and showing its settings; the developer-mode switch is the
 * first item of Developer; Settings reopens on the section shown last, and
 * can be opened at a named section.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function openSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
}

test.describe("Settings: closing", { tag: "@ci" }, () => {
  test("Escape closes it; the × stays visible after scrolling and closes it", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);

    await openSettings(page);
    // The longest section, scrolled as far as it goes; the header is outside it.
    await page.getByTestId("settings-section-shortcuts").click();
    await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="settings-panel"]');
      panel?.querySelectorAll("div").forEach((el) => {
        if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      });
    });
    const close = page.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeInViewport();
    await close.click();
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  });

  test("Escape while recording a shortcut leaves the shortcut alone and keeps Settings open", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-shortcuts").click();
    const shortcuts = page.getByTestId("setting-keyboard-shortcuts");
    await expect(shortcuts).toBeVisible();

    // Start recording the first shortcut, then change your mind.
    const binding = shortcuts.getByTitle("Click, then press the keys you want").first();
    const before = await binding.textContent();
    await binding.click();
    await expect(binding).toHaveText("press keys…");
    await page.keyboard.press("Escape");

    await expect(binding).toHaveText(before ?? "");
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // And now that nothing is recording, Escape closes Settings as usual.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  });
});

test.describe("Settings: sections", { tag: "@ci" }, () => {
  test("the sections in order, each opening from the sidebar with its settings", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    // In a browser: no Problem reports, which is the Mac app's.
    const sidebar = page.getByTestId("settings-sidebar");
    await expect(sidebar.getByRole("button")).toHaveText([
      "About",
      "General",
      "Appearance",
      "Tutorials and Voice",
      "Open menu",
      "Folders",
      "Keyboard shortcuts",
      "Developer (advanced)",
    ]);
    // A new browser lands on About: versions, one line each, and no paths.
    await expect(page.getByTestId("settings-content-about")).toBeVisible();
    await expect(page.getByText("PsyNeuView version")).toBeVisible();
    await expect(page.getByText(/^PsyNeuLink \d/)).toBeVisible();
    await expect(page.getByText("Full path")).toHaveCount(0);

    await page.getByTestId("settings-section-general").click();
    // The simple PsyNeuLink choice, or the custom line, from the same setting as Developer (#1295).
    await expect(page.getByTestId("settings-group-pnl-version")).toBeVisible();
    await expect(page.getByTestId("setting-pnl-version").or(page.getByTestId("pnl-version-custom"))).toBeVisible();
    await expect(page.getByTestId("setting-sidecar-placement")).toBeVisible();
    await expect(page.getByText("My Project Folder")).toHaveCount(0);

    // Open menu: only the sections' order and visibility (#1295 review).
    await page.getByTestId("settings-section-open-menu").click();
    await expect(page.getByTestId("setting-open-menu-sections")).toBeVisible();
    await expect(page.getByTestId("setting-catalogs")).toHaveCount(0);

    // Folders: everything you can open, My Project Folder first, with the
    // catalogs' Add control (#1295). The project folder is a full path on its
    // own line, the home folder as ~ and the full path as the tooltip. The
    // suite fixes it through the environment variable, which Settings says
    // is developer territory.
    await page.getByTestId("settings-section-folders").click();
    await expect(page.getByText("My Project Folder")).toBeVisible();
    await expect(page.getByTestId("setting-catalogs")).toBeVisible();
    await expect(page.getByTestId("location-library")).toContainText("From the PsyNeuLink you've selected");
    const folder = page.getByTestId("project-folder-current");
    await expect(folder).toContainText("Full path");
    await expect(folder).toHaveAttribute("title", /^\//);
    await expect(page.getByTestId("project-folder-fixed")).toContainText("PSYNEWVIEW_MODELS_DIR");
    await expect(page.getByTestId("project-folder-fixed").getByTestId("developer-badge")).toBeVisible();

    await page.getByTestId("settings-section-shortcuts").click();
    await expect(page.getByTestId("setting-keyboard-shortcuts")).toBeVisible();

    // Developer: most useful first, and the switch for what's still under
    // development last (#95); the PsyNeuLink details About no longer carries.
    await page.getByTestId("settings-section-developer").click();
    const developer = page.getByTestId("settings-content-developer");
    const groups = developer.locator('[data-testid^="settings-group-"]:not([data-testid$="-summary"])');
    await expect(groups.last()).toHaveAttribute("data-testid", "settings-group-developer-mode");
    await expect(developer.getByText("Show what's still under development")).toBeVisible();
    await expect(developer.getByTestId("setting-developer-mode")).toBeVisible();
    await expect(developer.getByText("Change install")).toBeVisible();
    await expect(developer.getByTestId("pnl-details").getByText("Currently installed")).toBeVisible();
  });

  test("reopens on the section shown last, and opens at a named section", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-open-menu").click();
    await page.keyboard.press("Escape");

    await openSettings(page);
    await expect(page.getByTestId("settings-content-open-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    // Survives a reload: it is remembered per browser.
    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId("settings-content-open-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    // Anything in the app can open Settings at a section.
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("psyneuview:open-settings", { detail: { section: "developer" } })),
    );
    await expect(page.getByTestId("settings-content-developer")).toBeVisible();
    await page.keyboard.press("Escape");

    // A section this build doesn't list — the Mac app's Problem reports, in a
    // browser — falls back to About rather than showing nothing (#1295).
    await page.evaluate(() => localStorage.setItem("psyneuview.settings.lastSection", "reports"));
    await openSettings(page);
    await expect(page.getByTestId("settings-content-about")).toBeVisible();
  });
});
