/**
 * Dialogs hold the keyboard focus while open and give it back on close (#415).
 *
 * DialogHeader runs the shared focus logic (dialog/dialogFocus.ts) for every
 * dialog; docs/dialog-inventory.md marks each one trap, no trap, takes focus
 * or leaves focus. This goes through the modal ("trap") dialogs a keyboard
 * user meets most, opening each from the keyboard, and checks:
 *
 *  - the focus is inside the dialog once it is open;
 *  - Tab, again and again, and Shift+Tab, never take it out;
 *  - Escape closes it;
 *  - the focus is back on the control that opened it — or, where that was a
 *    menu item that went with its menu, on the menu's button.
 */
import { mutatingTest as test, expect, ORIENTATION_OFFER_KEY } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
}

/** Is the focus inside `dialog` (or on the dialog itself)? */
async function focusInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate((el) => {
    // The test id may be on the dialog or on the scrim around it.
    const box = el.getAttribute("role") === "dialog" ? el : el.querySelector('[role="dialog"]') ?? el;
    return box.contains(document.activeElement);
  });
}

/** How many controls Tab can reach in `dialog`. */
async function tabStops(dialog: Locator): Promise<number> {
  return dialog.evaluate(
    (el) =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((c) => c.getClientRects().length > 0 && c.tabIndex >= 0).length,
  );
}

/**
 * The checks every modal dialog passes: the focus is in, Tab and Shift+Tab
 * keep it in (more presses than there are controls, so it wraps at least
 * once), and Escape closes it.
 */
async function holdsFocus(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect.poll(() => focusInside(dialog), "focus moved into the dialog").toBe(true);
  const stops = await tabStops(dialog);
  expect(stops, "the dialog has controls to Tab through").toBeGreaterThan(0);
  for (let i = 0; i < stops + 2; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInside(dialog), `Tab ${i + 1} of ${stops + 2} stayed inside`).toBe(true);
  }
  for (let i = 0; i < stops + 2; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInside(dialog), `Shift+Tab ${i + 1} of ${stops + 2} stayed inside`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

/** Focus `opener` and press Enter on it, as a keyboard user would. */
async function openWithEnter(page: Page, opener: Locator) {
  await opener.focus();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
}

test.describe("dialog focus (#415)", { tag: "@ci" }, () => {
  test("Settings, Keyboard Shortcuts, New model and Open a model", async ({ page }) => {
    await openApp(page);

    // Settings, from the gear.
    const gear = page.getByTestId("settings-button");
    await openWithEnter(page, gear);
    await holdsFocus(page, page.getByTestId("settings-panel"));
    await expect(gear).toBeFocused();

    // Keyboard Shortcuts, from its key while the Help button has the focus.
    const help = page.getByTestId("help-menu-button");
    await help.focus();
    await page.keyboard.press("ControlOrMeta+/");
    const reference = page.getByTestId("shortcuts-reference");
    if (!(await reference.isVisible())) {
      // The page decides ⌘ or Ctrl from what the browser reports, which need
      // not match the machine running the test (help-keyboard-shortcuts.spec).
      await page.keyboard.press("Control+/");
      if (!(await reference.isVisible())) await page.keyboard.press("Meta+/");
    }
    await holdsFocus(page, reference);
    await expect(help).toBeFocused();

    // New model and Open a model, from items of the Open menu. The item goes
    // with the menu, so the focus comes back to the Open button.
    const openMenu = page.getByTestId("open-menu");
    for (const [item, dialog] of [
      ["open-menu-new-model", "prompt-modal"],
      ["open-menu-open-from-path", "file-browser-modal"],
    ]) {
      await openWithEnter(page, openMenu);
      await expect(page.getByTestId("open-menu-list")).toBeVisible();
      await openWithEnter(page, page.getByTestId(item));
      await holdsFocus(page, page.getByTestId(dialog));
      await expect(openMenu, `back from ${dialog}`).toBeFocused();
    }
  });

  test("a dialog over Settings hands the focus back to Settings, then Settings to the gear", async ({ page }) => {
    // Move… is offered only for a project folder the environment does not
    // fix, as in dialog-sweep.spec.ts.
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), "focus415-move-"));
    const src = path.join(root, "models");
    mkdirSync(src, { recursive: true });
    const cleared = await (await page.request.post("/api/test/models-dir", { data: { path: null } })).json();
    try {
      expect((await page.request.post("/api/catalogs/project-folder", { data: { path: src } })).ok()).toBe(true);
      await openApp(page);
      const gear = page.getByTestId("settings-button");
      await openWithEnter(page, gear);
      const settings = page.getByTestId("settings-panel");
      await expect(settings).toBeVisible();
      await openWithEnter(page, page.getByTestId("settings-section-folders"));
      const move = page.getByTestId("project-folder-move");
      await openWithEnter(page, move);
      await holdsFocus(page, page.getByTestId("project-folder-move-dialog"));
      await expect(move, "back on Move… inside Settings").toBeFocused();
      await holdsFocus(page, settings);
      await expect(gear).toBeFocused();
    } finally {
      await page.request.post("/api/test/models-dir", { data: { path: cleared.previous } });
    }
  });

  test("Save a copy as…, over a model", async ({ page }) => {
    test.setTimeout(120_000);
    const dir = mkdtempSync(path.join(tmpdir(), "focus415-"));
    const model = path.join(dir, "two_mech_projection.py");
    writeFileSync(model, readFileSync(fixturePath("two_mech_projection"), "utf8"));
    await openApp(page);
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(model);
    await prompt.press("Enter");
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

    const saveCopy = page.getByTestId("toolbar-save-copy");
    await openWithEnter(page, saveCopy);
    await holdsFocus(page, page.getByTestId("save-copy-dialog"));
    await expect(saveCopy).toBeFocused();
  });

  test("the questions asked at launch take the focus and hold it", async ({ page }) => {
    // The first-launch orientation offer, in a browser.
    await page.addInitScript((key) => localStorage.removeItem(key), ORIENTATION_OFFER_KEY);
    await page.goto("/");
    await holdsFocus(page, page.getByTestId("orientation-offer"));
  });

  test("the Mac app's automatic-updates question takes the focus and holds it", async ({ page }) => {
    // The Mac app's settings bridge, stubbed as in mac-auto-install-updates.spec.ts.
    await page.addInitScript(() => {
      const w = window as any;
      const state: any = {
        install: { running: "PsyNeuView 0.6.15, included with this app", choice: "bundled",
          checkoutPath: null, includedVersion: "0.6.15", recentCheckouts: [] },
        app: { name: "PsyNeuView", version: "0.6.15", build: "0.6.15", builtAt: null },
        autoRestart: false, launchAtLogin: false, developerMode: false,
        reportSendWith: "ask", reportSendTo: "", reportSendToDefault: "contact@example.org",
        autoInstallUpdates: false, autoInstallOffer: true, lastUpdateCheck: null, justUpdated: null,
        appUpdate: { available: false },
      };
      w.webkit = { messageHandlers: { pnvSettings: { postMessage: async (body: any) => {
        if (body.op === "answerAutoInstallOffer") state.autoInstallOffer = false;
        return JSON.parse(JSON.stringify(state));
      } } } };
    });
    await page.goto("/");
    await holdsFocus(page, page.getByTestId("auto-install-offer"));
  });
});
