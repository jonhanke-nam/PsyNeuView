/**
 * In the Mac app, Settings ▸ Developer says when the app's saved PsyNeuLink
 * choice disagrees with what is installed, and one button makes what's
 * installed the saved choice (PsyNeuView-MacApp#9, #16).
 *
 * The case from the field: the user had switched to their own checkout from
 * Settings, but the app still had GitHub devel saved, and an app update would
 * have put that back. The install and the app's bridge are both stubbed: the
 * checkout is what /api/settings/info reports, and the fake pnvSettings
 * bridge answers with "github:devel" until it is asked to re-read.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { CHECKOUT, openDeveloper, stubSwitchBackend } from "./pnl-switch-stub";

type Page = import("@playwright/test").Page;

const CHECKOUT_IN_USE = {
  version: "0.20.2.0", source: "editable", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink",
  commit: "1234abc", path: CHECKOUT,
};

/** A fake Mac app whose saved PsyNeuLink choice is `record`. */
async function stubMacApp(page: Page, record: string, liveRecord: string) {
  await page.addInitScript(
    ({ record, liveRecord }) => {
      const w = window as any;
      const state: Record<string, unknown> = {
        install: { running: "PsyNeuView 0.6.0, included with this app", choice: "bundled", checkoutPath: null, includedVersion: "0.6.0", recentCheckouts: [] },
        autoRestart: false, launchAtLogin: false, developerMode: true,
        reportSendWith: "ask", reportSendTo: "", reportSendToDefault: "contact@example.org",
        pnlRecord: record,
      };
      w.__pnvMessages = [];
      w.webkit = {
        messageHandlers: {
          pnvSettings: {
            postMessage: async (body: any) => {
              w.__pnvMessages.push(body);
              // Like the app: re-read the install and adopt it.
              if (body.op === "syncPnlSource") state.pnlRecord = liveRecord;
              if (body.op === "checkInstall" || body.op === "switchInstall") {
                return { decision: "nothingToDo", message: "This is the PsyNeuView running now." };
              }
              return JSON.parse(JSON.stringify(state));
            },
          },
        },
      };
    },
    { record, liveRecord },
  );
}

test("a stale saved choice is named, and one click keeps the installed checkout", { tag: "@ci" }, async ({ page }) => {
  await stubSwitchBackend(page, () => CHECKOUT_IN_USE);
  await stubMacApp(page, "github:devel", `local:${CHECKOUT}`);
  await openDeveloper(page);

  // What is in use is the checkout, from the install itself.
  await expect(page.getByTestId("install-in-use")).toContainText("Your PsyNeuLink checkout");

  const notice = page.getByTestId("pnl-record-mismatch");
  await expect(notice).toContainText("GitHub (devel)");
  await expect(notice).toContainText(`your checkout at ${CHECKOUT}`);

  await page.getByTestId("pnl-record-keep").click();
  await expect(notice).toHaveCount(0);
  const ops = await page.evaluate(() => (window as any).__pnvMessages.map((m: any) => m.op));
  expect(ops).toContain("syncPnlSource");
});

test("no notice when the saved choice matches what is installed", { tag: "@ci" }, async ({ page }) => {
  await stubSwitchBackend(page, () => CHECKOUT_IN_USE);
  await stubMacApp(page, `local:${CHECKOUT}`, `local:${CHECKOUT}`);
  await openDeveloper(page);
  await expect(page.getByTestId("install-in-use")).toContainText("Your PsyNeuLink checkout");
  await expect(page.getByTestId("pnl-record-mismatch")).toHaveCount(0);
});

test("in a browser there is no Mac app record, so no notice", { tag: "@ci" }, async ({ page }) => {
  await stubSwitchBackend(page, () => CHECKOUT_IN_USE);
  await openDeveloper(page);
  await expect(page.getByTestId("install-in-use")).toContainText("Your PsyNeuLink checkout");
  await expect(page.getByTestId("pnl-record-mismatch")).toHaveCount(0);
});
