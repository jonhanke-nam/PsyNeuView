/**
 * Settings ▸ About says when the Mac app was built and when its included
 * PsyNeuView was released (PsyNeuView-MacApp#15). The app's pnvSettings
 * bridge is stubbed, as in mac-app-settings-section.spec.ts; in a browser
 * About stays as it was.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function stubMacApp(page: Page, extra: { app?: unknown; includedVersion: string; includedReleasedAt?: string | null }) {
  await page.addInitScript((x) => {
    const w = window as any;
    const state: any = {
      install: { running: `PsyNeuView ${x.includedVersion}, included with this app`, choice: "bundled",
        checkoutPath: null, includedVersion: x.includedVersion, recentCheckouts: [],
        includedReleasedAt: x.includedReleasedAt ?? null },
      autoRestart: false, launchAtLogin: false, developerMode: false,
      reportSendWith: "ask", reportSendTo: "", reportSendToDefault: "contact@example.org",
    };
    if (x.app !== undefined) state.app = x.app;
    w.webkit = { messageHandlers: { pnvSettings: { postMessage: async (body: any) => {
      if (body.op === "get") return JSON.parse(JSON.stringify(state));
      throw new Error(`pnvSettings: unknown op '${body.op}'`);
    } } } };
  }, extra);
}

async function openAbout(page: Page) {
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-about").click();
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

test.describe("Settings ▸ About release dates (PsyNeuView-MacApp#15)", { tag: "@ci" }, () => {
  test("inside the Mac app: the app's build date and the included PsyNeuView's release date", async ({ page }) => {
    const version = (await (await page.request.get("/api/settings/info")).json()).psyneuview.version;
    await stubMacApp(page, {
      includedVersion: version,
      includedReleasedAt: hoursAgo(5),
      app: { name: "PsyNeuView", version: "0.6.3", build: "0.6.3", builtAt: hoursAgo(2) },
    });
    await openAbout(page);
    await expect(page.getByTestId("about-mac-app")).toContainText(/0\.6\.3, built \w{3} \d{1,2}, .+ \(2 hours ago\)/);
    await expect(page.getByTestId("about-psyneuview-version")).toContainText(
      new RegExp(`${version.replace(/\./g, "\\.")}, released \\w{3} \\d{1,2}, .+ \\(5 hours ago\\)`),
    );
  });

  test("an app from before #15 sends no dates: About shows the versions alone", async ({ page }) => {
    const version = (await (await page.request.get("/api/settings/info")).json()).psyneuview.version;
    await stubMacApp(page, { includedVersion: version });
    await openAbout(page);
    await expect(page.getByTestId("about-psyneuview-version")).toBeVisible();
    await expect(page.getByTestId("about-psyneuview-version")).not.toContainText("released");
    await expect(page.getByTestId("about-mac-app")).toHaveCount(0);
  });

  test("in a browser, no Mac app row", async ({ page }) => {
    await openAbout(page);
    await expect(page.getByTestId("about-psyneuview-version")).toBeVisible();
    await expect(page.getByTestId("about-mac-app")).toHaveCount(0);
  });
});
