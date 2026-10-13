/**
 * One Settings: the Mac app's parts (PsyNeuView-MacApp#200, #1279, #1290).
 *
 * Inside the Mac app, PsyNeuView's Settings gains the settings only the app
 * can act on, each in the section it belongs to — the two app switches in
 * General, which PsyNeuView runs in Developer, problem reports in their own
 * section, listed only inside the app (#1295) — read
 * and written through the app's pnvSettings bridge, and the app's Settings…
 * (⌘,) opens this same Settings. In a browser there is no bridge and none of
 * them.
 *
 * The bridge is the app's, so it is stubbed here: a fake
 * window.webkit.messageHandlers.pnvSettings that answers like the app does and
 * records what the page sent.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

/** Install a fake Mac app before the page loads. */
async function stubMacApp(page: Page, opts: { developerMode?: boolean; openSettings?: boolean } = {}) {
  await page.addInitScript((o) => {
    const w = window as any;
    const state = {
      install: {
        running: "PsyNeuView 0.5.14, included with this app",
        choice: "bundled",
        checkoutPath: null,
        includedVersion: "0.5.14",
        recentCheckouts: ["/Users/someone/code/PsyNeuView"],
      },
      autoRestart: false,
      launchAtLogin: false,
      developerMode: !!o.developerMode,
      reportSendWith: "ask",
      reportSendTo: "",
      reportSendToDefault: "contact@example.org",
    };
    w.__pnvMessages = [];
    const reply = (body: any) => {
      switch (body.op) {
        case "get":
          return state;
        case "set":
          // Like the app: "Send to" must look like an address, or be empty.
          if (body.key === "reportSendTo" && body.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.value)) {
            throw new Error(`“${body.value}” doesn't look like an email address.`);
          }
          (state as any)[body.key] = body.value;
          return state;
        case "checkInstall":
        case "switchInstall":
          if (body.choice === "bundled") return { decision: "nothingToDo", message: "This is the PsyNeuView running now." };
          return body.path === "/Users/someone/code/PsyNeuView"
            ? { decision: "useCheckout", message: "Looks like a PsyNeuView checkout. Apply & Restart switches to it.", path: body.path }
            : { decision: "refuse", message: `There is no folder at ${body.path}.` };
        default:
          throw new Error(`pnvSettings: unknown op '${body.op}'`);
      }
    };
    w.webkit = {
      messageHandlers: {
        pnvSettings: {
          postMessage: async (body: any) => {
            w.__pnvMessages.push(body);
            return JSON.parse(JSON.stringify(reply(body)));
          },
        },
      },
    };
    // ⌘, pressed before the page had loaded: the app leaves this flag.
    if (o.openSettings) w.__pnvOpenSettingsRequested = true;
  }, opts);
}

const messages = (page: Page) => page.evaluate(() => (window as any).__pnvMessages as any[]);
/** The last "set" sent. A change also re-asks checkInstall, so it may not be the last message. */
const lastSet = async (page: Page) => (await messages(page)).filter((m) => m.op === "set").at(-1);

/** Unfold a group that starts folded, by its heading. */
async function unfold(page: Page, groupId: string, title: string) {
  await page.getByTestId(`settings-group-${groupId}`).getByRole("button", { name: title }).click();
}

test("in a browser, Settings has none of the Mac app's parts", { tag: "@ci" }, async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-general").click();
  await expect(page.getByText("Mac app", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("setting-mac-auto-restart")).toHaveCount(0);
  await page.getByTestId("settings-section-developer").click();
  await expect(page.getByTestId("settings-group-mac-install")).toHaveCount(0);
  await expect(page.getByTestId("settings-section-reports")).toHaveCount(0);
  await expect(page.getByTestId("settings-group-problem-reports")).toHaveCount(0);
});

test("inside the Mac app, its parts read and write through the bridge", { tag: "@ci" }, async ({ page }) => {
  await stubMacApp(page);
  await page.goto("/");
  await page.getByTestId("settings-button").click();

  // General: the two app switches. A switch posts the right message.
  await page.getByTestId("settings-section-general").click();
  await expect(page.getByText("Mac app", { exact: true })).toBeVisible();
  await page.getByTestId("setting-mac-auto-restart").check();
  await expect.poll(() => lastSet(page)).toEqual({
    op: "set", key: "autoRestart", value: true,
  });
  await expect(page.getByTestId("setting-mac-auto-restart")).toBeChecked();

  // Folders: the harness fixes the project folder through the variable the
  // app itself sets on launch, so inside the app that is the app's doing.
  await page.getByTestId("settings-section-folders").click();
  await expect(page.getByTestId("project-folder-fixed")).toHaveText("Set by the PsyNeuView app. Moving it from here comes in a later version.");
  await expect(page.getByTestId("project-folder-fixed").getByTestId("developer-badge")).toHaveCount(0);
  await expect(page.getByTestId("project-folder-move")).toHaveCount(0);

  // Developer: which PsyNeuView runs, folded to what's running now.
  await page.getByTestId("settings-section-developer").click();
  await expect(page.getByTestId("settings-group-mac-install-summary")).toHaveText(
    "Running now: PsyNeuView 0.5.14, included with this app",
  );
  await unfold(page, "mac-install", "Which PsyNeuView runs");
  await expect(page.getByTestId("mac-install-running")).toHaveText(
    "Running now: PsyNeuView 0.5.14, included with this app",
  );
  await expect(page.getByTestId("mac-install-bundled")).toBeChecked();
  // Nothing to apply: no button, a quiet line instead (#1303).
  await expect(page.getByTestId("mac-install-apply")).toHaveCount(0);
  await expect(page.getByTestId("mac-install-in-use")).toHaveText("✓ In use now: PsyNeuView 0.5.14, included with this app");

  // Choosing a checkout asks the app first, and says why it can't — still no button.
  await page.getByTestId("mac-install-checkout").check();
  await page.getByTestId("mac-install-path").fill("/nowhere");
  await expect(page.getByTestId("mac-install-hint")).toHaveText("There is no folder at /nowhere.");
  await expect(page.getByTestId("mac-install-apply")).toHaveCount(0);
  await expect(page.getByTestId("mac-install-in-use")).toHaveCount(0);

  // A checkout used before is one click; the field shows it with ~ (#1290)
  // while the app is sent the full path, and Apply asks the app to switch.
  await page.getByTestId("mac-install-recent").click();
  await expect(page.getByTestId("mac-install-path")).toHaveValue("~/code/PsyNeuView");
  await expect(page.getByTestId("mac-install-hint")).toContainText("Looks like a PsyNeuView checkout");
  await expect(page.getByTestId("mac-install-apply-explanation")).toContainText("Nothing changes until you press Apply & restart.");
  await page.getByTestId("mac-install-apply").click();
  await expect.poll(async () => (await messages(page)).at(-1)).toEqual({
    op: "switchInstall", choice: "checkout", path: "/Users/someone/code/PsyNeuView",
  });
});

test("inside the Mac app, developer mode is the app's value, with one toggle", { tag: "@ci" }, async ({ page }) => {
  await stubMacApp(page, { developerMode: true });
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-developer").click();
  await expect(page.getByTestId("setting-developer-mode")).toBeChecked();
  await page.getByTestId("setting-developer-mode").uncheck();
  await expect.poll(() => lastSet(page)).toEqual({
    op: "set", key: "developerMode", value: false,
  });
});

test("the Mac app's Settings… (⌘,) opens this Settings, even before the page is ready", { tag: "@ci" }, async ({ page }) => {
  await stubMacApp(page, { openSettings: true });
  await page.goto("/");
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  // The first time, it opens on About.
  await expect(page.getByTestId("settings-content-about")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);

  // And again with the page up, the way the app sends it.
  await page.evaluate(() => {
    (window as any).__pnvOpenSettingsRequested = true;
    window.dispatchEvent(new CustomEvent("pnv:open-settings"));
  });
  await expect(page.getByTestId("settings-panel")).toBeVisible();
});

test("inside the Mac app, Problem reports' two settings go through the bridge", { tag: "@ci" }, async ({ page }) => {
  await stubMacApp(page);
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  // Its own section, listed only inside the app, and open from the start.
  await expect(page.getByTestId("settings-sidebar").getByRole("button")).toHaveText([
    "About", "General", "Appearance", "Tutorials and Voice", "Open menu", "Folders", "Keyboard shortcuts", "Problem reports", "Developer (advanced)",
  ]);
  await page.getByTestId("settings-section-reports").click();
  await expect(page.getByTestId("settings-group-problem-reports-summary")).toHaveCount(0);
  await expect(page.getByText("Help ▸ Report a Problem…").first()).toBeVisible();
  const sendWith = page.getByTestId("setting-mac-report-send-with");
  const sendTo = page.getByTestId("setting-mac-report-send-to");
  await expect(sendWith).toHaveValue("ask");
  // The default contact is the app's, shown as the placeholder.
  await expect(sendTo).toHaveValue("");
  await expect(sendTo).toHaveAttribute("placeholder", "contact@example.org");

  await sendWith.selectOption("gmail");
  await expect.poll(() => lastSet(page)).toEqual({
    op: "set", key: "reportSendWith", value: "gmail",
  });
  await expect(sendWith).toHaveValue("gmail");

  // A refused address says why and isn't kept.
  await sendTo.fill("Someone at the lab");
  await sendTo.press("Enter");
  await expect(page.getByTestId("mac-report-error")).toHaveText(/doesn't look like an email address/);

  await sendTo.fill("help@example.org");
  await sendTo.press("Enter");
  await expect.poll(() => lastSet(page)).toEqual({
    op: "set", key: "reportSendTo", value: "help@example.org",
  });
  await expect(page.getByTestId("mac-report-error")).toHaveCount(0);
  await expect(sendTo).toHaveValue("help@example.org");
});
