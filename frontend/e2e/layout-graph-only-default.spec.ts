/**
 * The window opens with the graph alone (#189), and one key per panel brings
 * the others back (#191).
 *
 * The shared setup (`test-base.ts`) turns the code editor and the bottom panel
 * on for the rest of the suite, so the tests about the default use Playwright's
 * own empty profile, the closest thing to a new install. The tests about the
 * shortcuts start from the shared setup and set the panels they need.
 *
 * Playwright sends a key straight to the page, and its Desktop Chrome profile
 * presents itself as Windows, so the page reads `Mod` as Ctrl: the tests press
 * `Control+1` on every host. A real browser keeps Cmd+1..9 (Ctrl+1..9) for its
 * tabs; the Mac app's web view passes them on.
 */
import { test as freshProfileTest, expect } from "@playwright/test";
import {
  readOnlyTest,
  LAYOUT_BOTTOM_VISIBLE_KEY,
  LAYOUT_CODE_VISIBLE_KEY,
  ORIENTATION_OFFER_KEY,
} from "./test-base";
import { EVERYTHING, GRAPH_ONLY, GRAPH_VISIBLE_KEY, PALETTE_OPEN_KEY, expectPanels } from "./panels";

type Page = import("@playwright/test").Page;

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
}

freshProfileTest.describe("the default layout (#189)", { tag: "@ci" }, () => {
  // A first run offers the orientation a moment after the page is up; this is
  // about the layout, so answer it the way the shared setup does.
  freshProfileTest.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "never"), ORIENTATION_OFFER_KEY);
  });

  freshProfileTest("a new install opens with the graph alone", async ({ page }) => {
    await openApp(page);

    // Nothing stored: this really is a first run, and the default is the graph
    // with no code editor and no bottom panel. The Components panel keeps its
    // own start setting (#113), which is open.
    expect(await page.evaluate((k) => localStorage.getItem(k), LAYOUT_CODE_VISIBLE_KEY)).toBeNull();
    expect(await page.evaluate((k) => localStorage.getItem(k), LAYOUT_BOTTOM_VISIBLE_KEY)).toBeNull();
    await expectPanels(page, { ...GRAPH_ONLY, palette: true });

    // The Layout menu agrees, and still offers each panel.
    await page.getByTestId("layout-menu-button").click();
    const menu = page.getByTestId("layout-menu-list");
    await expect(menu.getByTestId("layout-menu-panel-code")).toContainText("·");
    await expect(menu.getByTestId("layout-menu-panel-bottom")).toContainText("·");
    await expect(menu.getByTestId("layout-menu-panel-graph")).toContainText("✓");
    // The graph is the last visible of the three, so its row looks unavailable
    // (#213: it stays clickable, so a click can say why; see the test below).
    await expect(menu.getByTestId("layout-menu-panel-graph")).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByTestId("layout-menu-panel-code")).not.toHaveAttribute("aria-disabled");
    await page.keyboard.press("Escape");

    // Opening the app didn't store a layout choice either.
    expect(await page.evaluate((k) => localStorage.getItem(k), LAYOUT_CODE_VISIBLE_KEY)).toBeNull();
  });

  freshProfileTest("a layout someone already chose is kept", async ({ page }) => {
    // Someone who had the code editor on before this default changed still
    // has it; only people with nothing stored get the new default.
    await page.addInitScript(
      ([code, bottom]) => {
        localStorage.setItem(code, "true");
        localStorage.setItem(bottom, "true");
      },
      [LAYOUT_CODE_VISIBLE_KEY, LAYOUT_BOTTOM_VISIBLE_KEY] as const,
    );
    await openApp(page);
    await expectPanels(page, EVERYTHING);
  });
});

readOnlyTest.describe("one key per panel (#191)", { tag: "@ci" }, () => {
  readOnlyTest("the Layout menu shows each panel's shortcut", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("layout-menu-button").click();
    const menu = page.getByTestId("layout-menu-list");
    // ⌘ on a Mac, Ctrl elsewhere; the number is what matters.
    await expect(menu.getByTestId("layout-menu-panel-graph")).toContainText("1");
    await expect(menu.getByTestId("layout-menu-panel-code")).toContainText("2");
    await expect(menu.getByTestId("layout-menu-panel-bottom")).toContainText("3");
    await expect(menu.getByTestId("layout-menu-panel-palette")).toContainText("4");
    await page.keyboard.press("Escape");

    // ...and Settings lists them, where they can be changed.
    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await page.getByTestId("settings-section-shortcuts").click();
    const list = page.getByTestId("setting-keyboard-shortcuts");
    for (const label of [
      "Show or hide the graph",
      "Show or hide the code editor",
      "Show or hide the Inspector panel",
      "Show or hide the Components panel",
    ]) {
      await expect(list.getByText(label)).toBeVisible();
    }
    await page.keyboard.press("Escape");
  });

  readOnlyTest("each shortcut toggles its panel, and the choice is remembered", async ({ page }) => {
    await openApp(page);
    // The shared setup: code, graph and bottom on; the palette open.
    await expectPanels(page, EVERYTHING);

    await page.keyboard.press("Control+2");
    await expectPanels(page, { ...EVERYTHING, code: false });
    await page.keyboard.press("Control+3");
    await expectPanels(page, { ...EVERYTHING, code: false, bottom: false });
    await page.keyboard.press("Control+4");
    await expectPanels(page, GRAPH_ONLY);

    // Each is remembered like a Layout-menu change.
    await page.reload();
    await expect(page.getByTestId("graph-canvas")).toBeVisible();
    await expectPanels(page, GRAPH_ONLY);

    // And each comes back with the same key.
    await page.keyboard.press("Control+2");
    await expectPanels(page, { ...GRAPH_ONLY, code: true });
    await page.keyboard.press("Control+3");
    await expectPanels(page, { ...GRAPH_ONLY, code: true, bottom: true });
    await page.keyboard.press("Control+4");
    await expectPanels(page, EVERYTHING);

    // The graph too, while something else is showing.
    await page.keyboard.press("Control+1");
    await expectPanels(page, { ...EVERYTHING, graph: false });
    await page.keyboard.press("Control+1");
    await expectPanels(page, EVERYTHING);
  });

  readOnlyTest("the last visible panel stays, and every way of hiding it says why", async ({ page }) => {
    // Start from the graph alone.
    await page.addInitScript(
      ([code, bottom, graph, palette]) => {
        localStorage.setItem(code, "false");
        localStorage.setItem(bottom, "false");
        localStorage.setItem(graph, "true");
        localStorage.setItem(palette, "false");
      },
      [LAYOUT_CODE_VISIBLE_KEY, LAYOUT_BOTTOM_VISIBLE_KEY, GRAPH_VISIBLE_KEY, PALETTE_OPEN_KEY] as const,
    );
    await openApp(page);
    await expectPanels(page, GRAPH_ONLY);

    // #213: the notice says which panel stays, and which to show first with
    // its key. The keys come from the shortcut registry; the page reads
    // Playwright's profile as Windows, so they read Ctrl+2 and Ctrl+3 here.
    const notice = (text: string) => page.getByTestId("notification-message").filter({ hasText: text });
    const graphStays = notice("One panel has to stay open, so PsyNeuView can't hide the graph.");

    await page.keyboard.press("Control+1");
    await expectPanels(page, GRAPH_ONLY);
    await expect(graphStays).toBeVisible();
    await expect(graphStays).toContainText("Show the code editor (Ctrl+2) or the Inspector panel (Ctrl+3) first");
    await expect(graphStays).toContainText("from the Layout menu");

    // Trying again doesn't stack a second notice.
    await page.keyboard.press("Control+1");
    await expectPanels(page, GRAPH_ONLY);
    await expect(graphStays).toHaveCount(1);

    // The Layout menu's row looks unavailable but still answers a click with
    // the same notice. (Playwright treats aria-disabled as not clickable, so
    // the click is forced; a person's click lands as usual.)
    await page.getByTestId("layout-menu-button").click();
    const menu = page.getByTestId("layout-menu-list");
    const graphRow = menu.getByTestId("layout-menu-panel-graph");
    await expect(graphRow).toHaveAttribute("aria-disabled", "true");
    await graphRow.click({ force: true });
    await expectPanels(page, GRAPH_ONLY);
    await expect(graphStays).toBeVisible();
    await expect(graphStays).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // The bottom panel's collapse button, once it is the last one: the same
    // notice, naming the Inspector panel and the other two.
    await page.keyboard.press("Control+3");
    await expectPanels(page, { ...GRAPH_ONLY, bottom: true });
    await page.keyboard.press("Control+1");
    await expectPanels(page, { code: false, graph: false, bottom: true, palette: false });
    await page.getByTestId("bottom-panel-collapse").click();
    await expectPanels(page, { code: false, graph: false, bottom: true, palette: false });
    const inspectorStays = notice("PsyNeuView can't hide the Inspector panel.");
    await expect(inspectorStays).toBeVisible();
    await expect(inspectorStays).toContainText("Show the graph (Ctrl+1) or the code editor (Ctrl+2) first");
    // ...and the collapse works again once the graph is back.
    await page.keyboard.press("Control+1");
    await expectPanels(page, { ...GRAPH_ONLY, bottom: true });
    await page.getByTestId("bottom-panel-collapse").click();
    await expectPanels(page, GRAPH_ONLY);

    // The Components panel is not one of the three, so it can't stand in for them.
    await page.keyboard.press("Control+4");
    await expectPanels(page, { ...GRAPH_ONLY, palette: true });
    await page.keyboard.press("Control+1");
    await expectPanels(page, { ...GRAPH_ONLY, palette: true });

    // Once another panel is on, the graph can go, and the code editor is then the last.
    await page.keyboard.press("Control+2");
    await expectPanels(page, { ...GRAPH_ONLY, palette: true, code: true });
    await page.keyboard.press("Control+1");
    await expectPanels(page, { code: true, graph: false, bottom: false, palette: true });
    await page.keyboard.press("Control+2");
    await expectPanels(page, { code: true, graph: false, bottom: false, palette: true });
  });

  readOnlyTest("Show Inspector brings the bottom panel back", async ({ page }) => {
    await page.addInitScript((bottom) => localStorage.setItem(bottom, "false"), LAYOUT_BOTTOM_VISIBLE_KEY);
    await openApp(page);
    await expectPanels(page, { ...EVERYTHING, bottom: false });
    await page.keyboard.press("Control+i");
    await expectPanels(page, EVERYTHING);
  });
});
