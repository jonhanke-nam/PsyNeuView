/**
 * A blank screen by choice (#215): Settings ▸ Appearance ▸ Panels.
 *
 * Off by default, one of the graph, the code editor and the Inspector panel
 * always stays, with the notice (#213). On, the last one can go too: the
 * toolbar stays and a hint says how to bring a panel back. A model opened
 * onto a blank screen brings the chosen panels (the graph by default); with
 * panels showing, opening changes nothing. Turning the setting off while the
 * screen is blank brings the graph back, a stored blank layout read with it
 * off opens as the graph, and a walkthrough started from blank ends on blank.
 *
 * The shared setup (`test-base.ts`) turns the code editor and the bottom panel
 * on; these tests set the layout keys outright. Playwright's profile reads as
 * Windows, so the keys read Ctrl+1..3 here.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { mutatingTest, readOnlyTest as test, expect, LAYOUT_BOTTOM_VISIBLE_KEY, LAYOUT_CODE_VISIBLE_KEY } from "./test-base";
import { fixturePath, type FixtureName } from "./fixtures";
import { EVERYTHING, GRAPH_ONLY, GRAPH_VISIBLE_KEY, PALETTE_OPEN_KEY, expectPanels, type Panels } from "./panels";

type Page = import("@playwright/test").Page;

/** Storage keys, kept literal: the suite drives the built app from outside. */
const ALLOW_BLANK_KEY = "psyneuview.layout.allowBlank";
const BLANK_LOAD_PANELS_KEY = "psyneuview.layout.blankLoadPanels";

const NOTHING: Panels = { code: false, graph: false, bottom: false, palette: false };
const TOUR = "orientation-settings";

/**
 * The layout keys as the page will first read them. `allowBlank` unset leaves
 * the default (off). Init scripts run again on a reload, so this only seeds the
 * first page; otherwise a reload would test the seed, not what the app stored.
 */
async function startWith(
  page: Page,
  layout: Panels,
  opts: { allowBlank?: string; loadPanels?: string } = {},
) {
  await page.addInitScript(
    ([keys, p, allow, allowKey, load, loadKey]) => {
      if (sessionStorage.getItem("blank215-seeded")) return;
      sessionStorage.setItem("blank215-seeded", "1");
      localStorage.setItem(keys.code, String(p.code));
      localStorage.setItem(keys.graph, String(p.graph));
      localStorage.setItem(keys.bottom, String(p.bottom));
      localStorage.setItem(keys.palette, String(p.palette));
      if (allow !== undefined) localStorage.setItem(allowKey, allow);
      if (load !== undefined) localStorage.setItem(loadKey, load);
    },
    [
      { code: LAYOUT_CODE_VISIBLE_KEY, graph: GRAPH_VISIBLE_KEY, bottom: LAYOUT_BOTTOM_VISIBLE_KEY, palette: PALETTE_OPEN_KEY },
      layout,
      opts.allowBlank,
      ALLOW_BLANK_KEY,
      opts.loadPanels,
      BLANK_LOAD_PANELS_KEY,
    ] as const,
  );
}

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
}

async function openAppearance(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-allow-blank-screen")).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();
}

/** A small model in a scratch folder, opened with Open from path. */
function scratchModel(fixture: FixtureName = "two_mech_projection"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "blank215-"));
  const file = path.join(dir, `${fixture}.py`);
  writeFileSync(file, readFileSync(fixturePath(fixture), "utf8"));
  return file;
}

async function openFromPath(page: Page, model: string) {
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
}

/** The model is drawn, and its first node is in view: the graph fitted itself when it came back. */
async function expectGraphDrawnInView(page: Page) {
  const node = page.getByTestId("graph-canvas").locator(".react-flow__node").first();
  await expect(node).toBeVisible({ timeout: 60_000 });
  await expect(node).toBeInViewport();
}

const hint = (page: Page) => page.getByTestId("blank-screen-hint");
const lastPanelNotice = (page: Page) =>
  page.getByTestId("notification-message").filter({ hasText: "One panel has to stay open" });

test.describe("a blank screen by choice (#215)", { tag: "@ci" }, () => {
  test("off by default: the last panel stays, and the second setting is greyed out", async ({ page }) => {
    await startWith(page, GRAPH_ONLY);
    await openApp(page);

    await openAppearance(page);
    await expect(page.getByTestId("setting-allow-blank-screen")).not.toBeChecked();
    const panels = page.getByTestId("setting-blank-load-panels");
    await expect(panels).toBeDisabled();
    await expect(panels).toHaveAttribute("aria-disabled", "true");
    await expect(panels).toContainText("Available while Allow a blank screen is on");
    // The default choice shows through the greying: the graph.
    await expect(page.getByTestId("blank-load-panel-graph")).toBeChecked();
    await expect(page.getByTestId("blank-load-panel-code")).not.toBeChecked();
    await closeSettings(page);

    // Nothing changed: the refusal and its notice are as before (#213).
    await page.keyboard.press("Control+1");
    await expectPanels(page, GRAPH_ONLY);
    await expect(lastPanelNotice(page)).toBeVisible();
    await expect(hint(page)).toHaveCount(0);
  });

  test("on: every panel can go, the hint says how to come back, and a reload stays blank", async ({ page }) => {
    await startWith(page, { ...EVERYTHING, palette: false });
    await openApp(page);

    await openAppearance(page);
    await page.getByTestId("setting-allow-blank-screen").check();
    await expect(page.getByTestId("setting-blank-load-panels")).toBeEnabled();
    await closeSettings(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), ALLOW_BLANK_KEY)).toBe("true");

    // Each key hides its panel; the last one goes too, with no notice.
    await page.keyboard.press("Control+2");
    await page.keyboard.press("Control+3");
    await expectPanels(page, GRAPH_ONLY);
    await expect(hint(page)).toHaveCount(0);
    await page.keyboard.press("Control+1");
    await expectPanels(page, NOTHING);
    await expect(lastPanelNotice(page)).toHaveCount(0);

    // The toolbar stays; the hint names the Layout menu and the real keys.
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(page.getByTestId("blank-screen")).toBeVisible();
    await expect(hint(page)).toHaveText(
      "Every panel is hidden. Bring one back from the Layout menu, or press Ctrl+1 for the graph, " +
        "Ctrl+2 for the code editor or Ctrl+3 for the Inspector panel.",
    );
    // The Layout menu's rows are all available: nothing is locked.
    await page.getByTestId("layout-menu-button").click();
    const menu = page.getByTestId("layout-menu-list");
    for (const id of ["graph", "code", "bottom"]) {
      await expect(menu.getByTestId(`layout-menu-panel-${id}`)).not.toHaveAttribute("aria-disabled");
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // A reload while blank stays blank.
    await page.reload();
    await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
    await expectPanels(page, NOTHING);
    await expect(hint(page)).toBeVisible();

    // A panel comes back from its key, and the hint goes.
    await page.keyboard.press("Control+2");
    await expectPanels(page, { ...NOTHING, code: true });
    await expect(hint(page)).toHaveCount(0);
    // ...and from the Layout menu.
    await page.keyboard.press("Control+2");
    await expectPanels(page, NOTHING);
    await page.getByTestId("layout-menu-button").click();
    await page.getByTestId("layout-menu-list").getByTestId("layout-menu-panel-graph").click();
    await expectPanels(page, GRAPH_ONLY);
    await expect(hint(page)).toHaveCount(0);
  });

  mutatingTest("a model opened onto a blank screen brings the graph, or the chosen panels, and nothing otherwise", async ({ page }) => {
    await startWith(page, NOTHING, { allowBlank: "true" });
    await openApp(page);
    await expectPanels(page, NOTHING);
    const model = scratchModel();

    // The default: the graph.
    await openFromPath(page, model);
    await expectPanels(page, GRAPH_ONLY);
    await expectGraphDrawnInView(page);

    // A chosen set: the code editor and the Inspector panel, not the graph.
    await openAppearance(page);
    await page.getByTestId("blank-load-panel-code").check();
    await page.getByTestId("blank-load-panel-bottom").check();
    await page.getByTestId("blank-load-panel-graph").uncheck();
    await expect(page.getByTestId("blank-load-panel-graph")).not.toBeChecked();
    // One of the three has to stay ticked: untick the code editor and the Inspector panel locks.
    await page.getByTestId("blank-load-panel-code").uncheck();
    await expect(page.getByTestId("blank-load-panel-bottom")).toBeDisabled();
    await page.getByTestId("blank-load-panel-code").check();
    await closeSettings(page);
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), BLANK_LOAD_PANELS_KEY)) ?? "null")).toEqual(["code", "bottom"]);

    // With a panel showing, opening changes nothing.
    await openFromPath(page, model);
    await expectPanels(page, GRAPH_ONLY);

    // Blank again, then open: the chosen two.
    await page.keyboard.press("Control+1");
    await expectPanels(page, NOTHING);
    await openFromPath(page, model);
    await expectPanels(page, { code: true, graph: false, bottom: true, palette: false });

    // Showing the graph later fits a model that loaded while it was hidden.
    await page.keyboard.press("Control+1");
    await expectGraphDrawnInView(page);
  });

  mutatingTest("the other load routes: library, recent files, a dropped file, the toolbar's picker", async ({ page }) => {
    await startWith(page, NOTHING, { allowBlank: "true" });
    await openApp(page);
    const blankAgain = async () => {
      await page.keyboard.press("Control+1");
      await expectPanels(page, NOTHING);
    };

    // Library: opened, then the same one re-opened (the path doesn't change).
    const openStroop = async () => {
      await page.getByTestId("open-menu").click();
      await page.getByText("Stroop — Basic", { exact: true }).first().click();
    };
    await openStroop();
    await expectPanels(page, GRAPH_ONLY);
    await expectGraphDrawnInView(page);
    await blankAgain();
    await openStroop();
    await expectPanels(page, GRAPH_ONLY);

    // Recent files: a nested model, opened once so it is listed, then from the list.
    const nested = scratchModel("nested_minimal");
    await openFromPath(page, nested);
    await expect(page.getByTestId("model-name")).toContainText("nested_minimal", { timeout: 60_000 });
    await blankAgain();
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-list").getByRole("button", { name: /nested_minimal/ }).first().click();
    await expectPanels(page, GRAPH_ONLY);

    // The toolbar's picker: choosing what to look at on a blank screen.
    await expectGraphDrawnInView(page);
    await blankAgain();
    const picker = page.getByTitle("View a composition — nested ones open in focus mode");
    await picker.selectOption("__flat__");
    await expectPanels(page, GRAPH_ONLY);

    // A file dropped on the window, then the same file again.
    const dropped = readFileSync(fixturePath("two_mech_projection"), "utf8");
    const dropModel = async () => {
      const dt = await page.evaluateHandle((source) => {
        const data = new DataTransfer();
        data.items.add(new File([source], "blank215_dropped.py", { type: "text/x-python" }));
        return data;
      }, dropped);
      // As a real drag goes: over the blank screen, which raises the drop
      // overlay, then let go on whatever is really at the middle of the window.
      await page.getByTestId("blank-screen").dispatchEvent("dragover", { dataTransfer: dt });
      await page.waitForFunction(() => {
        const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return hit !== null && !hit.closest('[data-testid="blank-screen"]');
      });
      await page.evaluate((data) => {
        document
          .elementFromPoint(innerWidth / 2, innerHeight / 2)!
          .dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
      }, dt);
    };
    await blankAgain();
    await dropModel();
    await expectPanels(page, GRAPH_ONLY);
    await expect(page.getByTestId("model-name").getByTitle(/blank215_dropped\.py/)).toBeVisible({ timeout: 60_000 });
    await blankAgain();
    await dropModel();
    await expectPanels(page, GRAPH_ONLY);
  });

  test("the keys that show a panel work on a blank screen: Show Inspector too", async ({ page }) => {
    await startWith(page, NOTHING, { allowBlank: "true" });
    await openApp(page);
    await expect(hint(page)).toBeVisible();

    await page.keyboard.press("Control+i");
    await expectPanels(page, { ...NOTHING, bottom: true });
    await expect(hint(page)).toHaveCount(0);

    // Diagnostics say so, whatever the panels: an empty list explains itself.
    await page.keyboard.press("Control+3");
    await expectPanels(page, NOTHING);
    const layout = await page.evaluate(async () => (await (window as any).__pnvDiagnostics()).state.ui.layout);
    expect(layout.visiblePanes).toEqual([]);
    expect(layout.allowBlankScreen).toBe(true);
  });

  mutatingTest("New Model onto a blank screen opens the graph too", async ({ page }) => {
    await startWith(page, NOTHING, { allowBlank: "true" });
    await openApp(page);
    await expectPanels(page, NOTHING);

    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-new-model").click();
    const prompt = page.getByTestId("prompt-modal").locator("input");
    await prompt.fill("blank_screen_215");
    await prompt.press("Enter");
    await expectPanels(page, GRAPH_ONLY);
    await expect(page.getByTestId("model-name")).toContainText("blank_screen_215", { timeout: 60_000 });
  });

  test("turning the setting off while blank brings the graph back, and the refusal with it", async ({ page }) => {
    await startWith(page, NOTHING, { allowBlank: "true" });
    await openApp(page);
    await expectPanels(page, NOTHING);

    await openAppearance(page);
    await page.getByTestId("setting-allow-blank-screen").uncheck();
    await expect(page.getByTestId("setting-blank-load-panels")).toBeDisabled();
    await closeSettings(page);
    await expectPanels(page, GRAPH_ONLY);
    await expect(hint(page)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), GRAPH_VISIBLE_KEY)).toBe("true");

    await page.keyboard.press("Control+1");
    await expectPanels(page, GRAPH_ONLY);
    await expect(lastPanelNotice(page)).toBeVisible();
  });

  test("a stored blank layout with the setting off, or corrupt stored values, fall back safely", async ({ page }) => {
    // Blank stored, the setting a value that isn't "true", the choice not a list.
    await startWith(page, NOTHING, { allowBlank: "yes", loadPanels: "{not json" });
    await openApp(page);
    await expectPanels(page, GRAPH_ONLY);
    await expect(hint(page)).toHaveCount(0);

    await openAppearance(page);
    await expect(page.getByTestId("setting-allow-blank-screen")).not.toBeChecked();
    await expect(page.getByTestId("blank-load-panel-graph")).toBeChecked();
    await expect(page.getByTestId("blank-load-panel-bottom")).not.toBeChecked();
    await closeSettings(page);
  });

  test("a walkthrough started from blank shows its panels and ends on blank, or the graph if the setting went off", async ({ page }) => {
    await startWith(page, NOTHING, { allowBlank: "true" });
    await openApp(page);
    await expectPanels(page, NOTHING);

    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId(`walkthrough-${TOUR}`).click();
    await expect(page.getByTestId("tour-bar")).toBeVisible();
    await expectPanels(page, EVERYTHING);
    await expect(hint(page)).toHaveCount(0);

    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toBeHidden();
    await expectPanels(page, NOTHING);
    await expect(hint(page)).toBeVisible();

    // Again, with the setting turned off meanwhile: the graph, not a blank.
    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId(`walkthrough-${TOUR}`).click();
    await expect(page.getByTestId("tour-bar")).toBeVisible();
    await expectPanels(page, EVERYTHING);
    await openAppearance(page);
    await page.getByTestId("setting-allow-blank-screen").uncheck();
    await closeSettings(page);
    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toBeHidden();
    await expectPanels(page, GRAPH_ONLY);
  });

  test("a walkthrough opened by its link from blank ends on blank", async ({ page }) => {
    await startWith(page, NOTHING, { allowBlank: "true" });
    await page.goto(`/?tour=${TOUR}`);
    await expect(page.getByTestId("tour-bar")).toBeVisible({ timeout: 30_000 });
    await expectPanels(page, EVERYTHING);

    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toBeHidden();
    await expectPanels(page, NOTHING);
    await expect(hint(page)).toBeVisible();
  });
});
