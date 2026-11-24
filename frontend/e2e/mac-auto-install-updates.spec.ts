/**
 * Install updates automatically, by consent (PsyNeuView-MacApp#79).
 *
 * Inside the Mac app: the page asks once "Install PsyNeuView updates
 * automatically when you quit?" (off until the user says yes); Settings ▸
 * General ▸ Updates holds the one switch; the toolbar notice says an update
 * is ready (Restart now), available (Install and restart), or what the app
 * updated to after a restart; About says when the app last checked. In a
 * browser none of it shows.
 *
 * The app's pnvSettings bridge is stubbed, as in app-update-notice.spec.ts.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function stubMacApp(page: Page, extra: Record<string, unknown>) {
  await page.addInitScript((x) => {
    const w = window as any;
    const state: any = {
      install: { running: "PsyNeuView 0.6.15, included with this app", choice: "bundled",
        checkoutPath: null, includedVersion: "0.6.15", recentCheckouts: [] },
      app: { name: "PsyNeuView", version: "0.6.15", build: "0.6.15", builtAt: null },
      autoRestart: false, launchAtLogin: false, developerMode: false,
      reportSendWith: "ask", reportSendTo: "", reportSendToDefault: "contact@example.org",
      autoInstallUpdates: false, autoInstallOffer: false, lastUpdateCheck: null, justUpdated: null,
      appUpdate: { available: false },
      ...x,
    };
    w.__pnvMessages = [];
    w.webkit = { messageHandlers: { pnvSettings: { postMessage: async (body: any) => {
      w.__pnvMessages.push(body);
      switch (body.op) {
        case "get": case "installUpdate": case "installAndRelaunch": break;
        case "set": state[body.key] = body.value; state.autoInstallOffer = false; break;
        case "answerAutoInstallOffer":
          if (body.value) state.autoInstallUpdates = true;
          state.autoInstallOffer = false;
          break;
        case "dismissJustUpdated": state.justUpdated = null; break;
        default: throw new Error(`pnvSettings: unknown op '${body.op}'`);
      }
      return JSON.parse(JSON.stringify(state));
    } } } };
  }, extra);
}

const ops = (page: Page) => page.evaluate(() => (window as any).__pnvMessages as any[]);
const notice = (page: Page) => page.getByTestId("app-update-notice");

test.describe("Install updates automatically (PsyNeuView-MacApp#79)", { tag: "@ci" }, () => {
  test("asks once, and Yes turns it on", async ({ page }) => {
    await stubMacApp(page, { autoInstallOffer: true });
    await page.goto("/");
    const offer = page.getByTestId("auto-install-offer");
    await expect(offer).toContainText("Install PsyNeuView updates automatically when you quit?");
    await expect(page.getByTestId("auto-install-offer-yes")).toHaveText("Yes, install automatically");
    await expect(page.getByTestId("auto-install-offer-no")).toHaveText("No, ask me each time");
    await expect(offer).toContainText("Settings ▸ General ▸ Updates");
    await page.getByTestId("auto-install-offer-yes").click();
    await expect(offer).toHaveCount(0);
    expect(await ops(page)).toContainEqual({ op: "answerAutoInstallOffer", value: true });
    // Asked once: the app keeps the answer (its own tests cover that) and
    // no longer offers it, and the switch in Settings now reads on.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-general").click();
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toBeChecked();
  });

  test("No, ask me each time leaves it off", async ({ page }) => {
    await stubMacApp(page, { autoInstallOffer: true });
    await page.goto("/");
    await page.getByTestId("auto-install-offer-no").click();
    await expect(page.getByTestId("auto-install-offer")).toHaveCount(0);
    expect(await ops(page)).toContainEqual({ op: "answerAutoInstallOffer", value: false });
  });

  test("Escape closes the question without answering it", async ({ page }) => {
    await stubMacApp(page, { autoInstallOffer: true });
    await page.goto("/");
    await expect(page.getByTestId("auto-install-offer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("auto-install-offer")).toHaveCount(0);
    expect((await ops(page)).map((m) => m.op)).not.toContain("answerAutoInstallOffer");
  });

  test("Settings ▸ General ▸ Updates has the one switch, and About says when it last checked", async ({ page }) => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    await stubMacApp(page, { lastUpdateCheck: twoHoursAgo });
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-general").click();
    const toggle = page.getByTestId("setting-mac-auto-install-updates");
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("settings-group-updates")).toContainText("Install updates automatically (when you quit)");
    await toggle.check();
    await expect(toggle).toBeChecked();
    expect((await ops(page)).filter((m) => m.op === "set").at(-1)).toEqual({ op: "set", key: "autoInstallUpdates", value: true });

    await page.getByTestId("settings-section-about").click();
    await expect(page.getByTestId("about-mac-last-check")).toContainText("(2 hours ago)");
  });

  test("off: an available update offers What's new and Install and restart", async ({ page }) => {
    await stubMacApp(page, { appUpdate: { available: true, version: "0.6.16", releaseNotesURL: "https://example.org/notes" } });
    await page.goto("/");
    await expect(page.getByTestId("app-update-text")).toHaveText("PsyNeuView 0.6.16 is available");
    await expect(page.getByTestId("app-update-notes")).toHaveAttribute("href", "https://example.org/notes");
    await page.getByTestId("app-update-install").click();
    expect((await ops(page)).map((m) => m.op)).toContain("installUpdate");
  });

  test("on: a downloaded update says it installs when you quit, with Restart now", async ({ page }) => {
    await stubMacApp(page, { autoInstallUpdates: true });
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    // The app's event when the download finishes.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("pnv:app-update-ready", { detail: { version: "0.6.16" } })));
    await expect(page.getByTestId("app-update-text")).toHaveText("PsyNeuView 0.6.16 is ready. It installs when you quit.");
    await page.getByTestId("app-update-restart").click();
    expect((await ops(page)).map((m) => m.op)).toContain("installAndRelaunch");
  });

  test("after an update, says what it updated to until OK", async ({ page }) => {
    await stubMacApp(page, { justUpdated: { version: "0.6.15", releaseNotesURL: "https://example.org/notes" } });
    await page.goto("/");
    await expect(page.getByTestId("app-update-text")).toHaveText("Updated to 0.6.15.");
    await expect(page.getByTestId("app-update-notes")).toHaveText("What's new");
    await page.getByTestId("app-update-dismiss").click();
    await expect(notice(page)).toHaveCount(0);
    expect((await ops(page)).map((m) => m.op)).toContain("dismissJustUpdated");
  });

  test("in a browser, none of it shows", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(page.getByTestId("auto-install-offer")).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-general").click();
    await expect(page.getByTestId("setting-mac-auto-install-updates")).toHaveCount(0);
    await page.getByTestId("settings-section-about").click();
    await expect(page.getByTestId("about-mac-last-check")).toHaveCount(0);
  });
});
