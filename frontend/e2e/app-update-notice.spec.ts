/**
 * An app update is waiting (PsyNeuView-MacApp#6).
 *
 * Inside the Mac app the toolbar says when a newer version is ready; Install…
 * asks the app to open its update window; Later hides it for that version.
 * The app's pnvSettings bridge is stubbed here, as in
 * mac-app-settings-section.spec.ts. In a browser, or with an app from before
 * #6, nothing shows.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function stubMacApp(page: Page, appUpdate: unknown) {
  await page.addInitScript((u) => {
    const w = window as any;
    const state: any = {
      install: { running: "PsyNeuView 0.5.16, included with this app", choice: "bundled",
        checkoutPath: null, includedVersion: "0.5.16", recentCheckouts: [] },
      autoRestart: false, launchAtLogin: false, developerMode: false,
      reportSendWith: "ask", reportSendTo: "", reportSendToDefault: "contact@example.org",
    };
    if (u !== undefined) state.appUpdate = u;
    w.__pnvMessages = [];
    w.webkit = { messageHandlers: { pnvSettings: { postMessage: async (body: any) => {
      w.__pnvMessages.push(body);
      if (body.op === "get" || body.op === "installUpdate") return JSON.parse(JSON.stringify(state));
      throw new Error(`pnvSettings: unknown op '${body.op}'`);
    } } } };
  }, appUpdate);
}

const notice = (page: Page) => page.getByTestId("app-update-notice");

test.describe("App update notice (PsyNeuView-MacApp#6)", { tag: "@ci" }, () => {
  test("says a waiting update is there, and Install… asks the app", async ({ page }) => {
    await stubMacApp(page, { available: true, version: "0.6.0", releaseNotesURL: null });
    await page.goto("/");
    await expect(notice(page)).toContainText("PsyNeuView 0.6.0 is available");
    await page.getByTestId("app-update-install").click();
    const ops = await page.evaluate(() => (window as any).__pnvMessages.map((m: any) => m.op));
    expect(ops).toContain("installUpdate");
  });

  test("says when the update was released, and nothing extra without a date (#15)", async ({ page }) => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    await stubMacApp(page, { available: true, version: "0.6.0", releaseNotesURL: null, releasedAt: twoHoursAgo });
    await page.goto("/");
    await expect(page.getByTestId("app-update-text")).toHaveText(
      /^PsyNeuView 0\.6\.0 is available, released \w{3} \d{1,2}, \d{1,2}:\d{2}\s[AP]M \(2 hours ago\)$/,
    );
    await expect(page.getByTestId("app-update-text")).toHaveAttribute("title", /^Released /);
    // An app from before #15 sends no date: just the version, as before.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("pnv:mac-settings-changed", {
      detail: { appUpdate: { available: true, version: "0.6.1", releaseNotesURL: null } } })));
    await expect(page.getByTestId("app-update-text")).toHaveText("PsyNeuView 0.6.1 is available");
  });

  test("Later hides it, and a newer version shows again", async ({ page }) => {
    await stubMacApp(page, { available: true, version: "0.6.0", releaseNotesURL: null });
    await page.goto("/");
    await page.getByTestId("app-update-later").click();
    await expect(notice(page)).toHaveCount(0);
    // Still hidden after a reload: Later lasts a day for that version.
    await page.reload();
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    // The app reports a newer one: it shows at once.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("pnv:mac-settings-changed", {
      detail: { appUpdate: { available: true, version: "0.6.1", releaseNotesURL: null } } })));
    await expect(notice(page)).toContainText("PsyNeuView 0.6.1 is available");
  });

  test("nothing shows with no update, with an older app, or in a browser", async ({ page }) => {
    await stubMacApp(page, { available: false });
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });

  test("an app from before #6 (no appUpdate key) shows nothing", async ({ page }) => {
    await stubMacApp(page, undefined);
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });
});
