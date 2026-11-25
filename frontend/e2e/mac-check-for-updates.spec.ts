/**
 * Check for updates automatically (PsyNeuView-MacApp#83).
 *
 * Inside the Mac app, Settings ▸ General ▸ Updates leads with "Check for
 * updates automatically" (on by default), above "Install updates
 * automatically (when you quit)". Turning checking off sends the app the
 * change (it stops its hourly checks at once) and disables the install
 * switch with a short note. In a browser, or from an app that sends no
 * value, the switch does not show.
 *
 * The app's pnvSettings bridge is stubbed, as in mac-auto-install-updates.spec.ts.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function stubMacApp(page: Page, extra: Record<string, unknown> & { __omit?: string[] }) {
  await page.addInitScript((x) => {
    const w = window as any;
    const state: any = {
      install: { running: "PsyNeuView 0.6.15, included with this app", choice: "bundled",
        checkoutPath: null, includedVersion: "0.6.15", recentCheckouts: [] },
      app: { name: "PsyNeuView", version: "0.6.15", build: "0.6.15", builtAt: null },
      autoRestart: false, launchAtLogin: false, developerMode: false,
      reportSendWith: "ask", reportSendTo: "", reportSendToDefault: "contact@example.org",
      autoInstallUpdates: false, checkForUpdates: true, autoInstallOffer: false,
      lastUpdateCheck: null, justUpdated: null, appUpdate: { available: false },
      ...x,
    };
    // Keys an older app (or one that can't update itself) doesn't send.
    for (const k of x.__omit ?? []) delete state[k];
    delete state.__omit;
    w.__pnvMessages = [];
    w.webkit = { messageHandlers: { pnvSettings: { postMessage: async (body: any) => {
      w.__pnvMessages.push(body);
      switch (body.op) {
        case "get": break;
        case "set": state[body.key] = body.value; break;
        default: throw new Error(`pnvSettings: unknown op '${body.op}'`);
      }
      return JSON.parse(JSON.stringify(state));
    } } } };
  }, extra as any);
}

const ops = (page: Page) => page.evaluate(() => (window as any).__pnvMessages as any[]);

async function openUpdates(page: Page) {
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-general").click();
}

test.describe("Check for updates automatically (PsyNeuView-MacApp#83)", { tag: "@ci" }, () => {
  test("is the first switch in Updates, on by default", async ({ page }) => {
    await stubMacApp(page, {});
    await openUpdates(page);
    const group = page.getByTestId("settings-group-updates");
    const check = page.getByTestId("setting-mac-check-for-updates");
    await expect(check).toBeChecked();
    await expect(group).toContainText("Check for updates automatically");
    // First: above "Install updates automatically (when you quit)".
    const boxes = group.locator('input[type="checkbox"]');
    await expect(boxes.nth(0)).toHaveAttribute("data-testid", "setting-mac-check-for-updates");
    await expect(boxes.nth(1)).toHaveAttribute("data-testid", "setting-mac-auto-install-updates");
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toBeEnabled();
  });

  test("off: tells the app, and disables Install updates automatically with a note", async ({ page }) => {
    await stubMacApp(page, {});
    await openUpdates(page);
    const check = page.getByTestId("setting-mac-check-for-updates");
    await check.uncheck();
    await expect(check).not.toBeChecked();
    expect((await ops(page)).filter((m) => m.op === "set").at(-1)).toEqual({ op: "set", key: "checkForUpdates", value: false });
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toBeDisabled();
    await expect(page.getByTestId("mac-auto-install-updates-note")).toHaveText("Needs Check for updates automatically.");
    await expect(page.getByTestId("settings-group-updates")).toContainText("Check for App Updates…");

    // On again: the install switch comes back as it was.
    await check.check();
    expect((await ops(page)).filter((m) => m.op === "set").at(-1)).toEqual({ op: "set", key: "checkForUpdates", value: true });
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toBeEnabled();
    await expect(page.getByTestId("setting-mac-auto-install-updates")).not.toBeChecked();
  });

  test("opens off when the app says checking is off", async ({ page }) => {
    await stubMacApp(page, { checkForUpdates: false, autoInstallUpdates: true });
    await openUpdates(page);
    await expect(page.getByTestId("setting-mac-check-for-updates")).not.toBeChecked();
    // Disabled, but still showing the person's choice.
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toBeDisabled();
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toBeChecked();
  });

  test("an app that sends no value shows no switch", async ({ page }) => {
    await stubMacApp(page, { __omit: ["checkForUpdates"] });
    await openUpdates(page);
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toBeEnabled();
    await expect(page.getByTestId("setting-mac-check-for-updates")).toHaveCount(0);
  });

  test("in a browser, it doesn't show", async ({ page }) => {
    await openUpdates(page);
    await expect(page.getByTestId("setting-mac-check-for-updates")).toHaveCount(0);
  });
});
