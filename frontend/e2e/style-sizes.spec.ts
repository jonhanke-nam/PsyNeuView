/**
 * A restyle keeps the old size: colour moves, size stays (#1302).
 *
 * The palette sweeps put every primary/secondary button at 34px and every
 * row button at 17px, and rows grew or shrank with them: Settings' footer,
 * the Run panel's Run row, Learn's Start row, the Inspector's port headers
 * and the Run panel's Trial headers. docs/ui-style-conventions.md now says
 * a restyle keeps each place's height, and Button has the sizes those places
 * had (compact, slim, tall, line, icon).
 *
 * This holds the heights of the controls and rows in the swept areas to the
 * numbers measured on the builds before each sweep, so a later sweep cannot
 * grow them again without someone deciding to. Where the numbers came from:
 * a Playwright pass over the built frontend at a206aaa (before #1343, Settings
 * and the dialogs), 6396ead (before #1354, the Inspector), 6228c13 (before
 * #1360, the Run and Learn panels) and 898af31 (before #1361, the toolbars),
 * at a 1600×1000 viewport. A row's height is its flex parent's. Tolerance is
 * 2px: Run Model, for one, was 28px beside a 30px Reset and is 30px now, so
 * the two match.
 */
import { mutatingTest as test, expect, clickCanvasNode, ORIENTATION_OFFER_KEY } from "./test-base";
import { writeFileSync, mkdtempSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

// Measured on macOS. Linux (CI) draws the same button a pixel or so smaller,
// so CI gets one more pixel of slack.
const TOLERANCE = process.platform === "darwin" ? 2 : 3;

/**
 * Heights in px. Mostly the pre-sweep builds named above; where the size fix
 * deliberately chose a neighbour's height so side-by-side controls match, the
 * entry is that intended height and says what it was.
 */
const BASELINE = {
  settingsClose: 30, // a206aaa: 6×14 padding, 13px
  settingsFooter: 51,
  moveButtons: 30,
  orientationButtons: 30,
  fileBrowserOpen: 30, // was 28 at 12px text; now 30, level with the path field
  appToolbarButton: 26, // Open ▾, Save, Layout ▾, Tutorials ▾
  graphToolbarButton: 21, // Layout: Auto/Custom, Advanced Graph View Options ▾ (were Roles, More ▾)
  portHeaderButton: 13, // the Inspector's Inputs + / Outputs +
  portHeaderRow: 13,
  addExecutionCondition: 21,
  // Was 23 before the sweep; deliberately made the same height as + Add
  // Execution Condition (21), its neighbour in the same panel, so the two
  // match. Measures 20–21 across macOS and Linux fonts.
  addGraphCondition: 21,
  conditionRemove: 20, // a condition's ✕ and Edit
  conditionRow: 20,
  conditionFormButtons: 21, // the Inspector's inline Save / Cancel: was 23, now the tall size like + Add … Condition
  runReset: 30,
  runModel: 30, // was 28; now matches Reset beside it
  runTrialX: 13, // was an 11px bare glyph; now a 13px box, the row unchanged
  runAddTrial: 21,
  runTrialHeaderRow: 13, // "Trial 1 ✕" in the by-trial view
  learnStart: 24,
};

const height = async (el: Locator) => (await el.boundingBox())!.height;

async function expectHeight(el: Locator, baseline: number, what: string) {
  await expect(el, what).toBeVisible();
  const h = await height(el);
  // soft: report every height that's off in one run, not just the first
  expect.soft(Math.abs(h - baseline), `${what}: ${h}px, expected ${baseline}px`).toBeLessThanOrEqual(TOLERANCE);
}

/** Side by side: every button in `row` the same height. */
async function expectLevel(row: Locator, what: string) {
  const hs = await row.locator(":scope > button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(hs.length, what).toBeGreaterThan(1);
  expect(Math.max(...hs) - Math.min(...hs), `${what}: ${hs.join(", ")}`).toBeLessThanOrEqual(1);
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

/** The Inspector / Run / Learn panel: the box holding the tab buttons. */
const sidePanel = (page: Page) => page.getByTestId("tab-inspector").locator("xpath=../..");

test.use({ viewport: { width: 1600, height: 1000 } });

test("Settings and the dialogs keep their button heights", { tag: "@ci" }, async ({ page }) => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "sizes1302-"));
  const src = path.join(root, "models");
  mkdirSync(src, { recursive: true });
  const cleared = await (await page.request.post("/api/test/models-dir", { data: { path: null } })).json();
  try {
    expect((await page.request.post("/api/catalogs/project-folder", { data: { path: src } })).ok()).toBe(true);
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    const close = page.getByTestId("settings-close");
    await expectHeight(close, BASELINE.settingsClose, "Settings' Close");
    await expectHeight(close.locator("xpath=.."), BASELINE.settingsFooter, "Settings' footer");

    await page.getByTestId("settings-section-folders").click();
    await page.getByTestId("project-folder-move").click();
    const move = page.getByTestId("project-folder-move-dialog");
    const confirm = page.getByTestId("project-folder-move-confirm");
    await expectHeight(confirm, BASELINE.moveButtons, "Move…'s Move");
    await expectHeight(move.getByRole("button", { name: "Cancel" }), BASELINE.moveButtons, "Move…'s Cancel");
    await expectLevel(confirm.locator("xpath=.."), "Move…'s footer");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  } finally {
    await page.request.post("/api/test/models-dir", { data: { path: cleared.previous } });
  }

  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const browser = page.getByTestId("file-browser-modal");
  const open = browser.getByRole("button", { name: "Open", exact: true });
  await expectHeight(open, BASELINE.fileBrowserOpen, "the file browser's Open");
  // The path field and Open stay level.
  const field = browser.locator('input[placeholder*="/path/to/model.py"]');
  expect(Math.abs((await height(field)) - (await height(open))), "path field beside Open").toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
});

test("the first-launch offer keeps its button heights", { tag: "@ci" }, async ({ page }) => {
  await page.addInitScript((key) => localStorage.removeItem(key), ORIENTATION_OFFER_KEY);
  await page.goto("/");
  const start = page.getByTestId("orientation-offer-start");
  await expectHeight(start, BASELINE.orientationButtons, "Start part 1");
  await expectLevel(start.locator("xpath=.."), "the orientation offer's answers");
});

test("the Inspector and the toolbars keep their row heights", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  // A model with execution conditions, one of them composite, so the
  // Inspector shows a condition line and its builder.
  const dir = mkdtempSync(path.join(tmpdir(), "sizes1302-"));
  const file = path.join(dir, "conds.py");
  writeFileSync(
    file,
    [
      "# PsyNeuLink Model File",
      "# Format Version: 1.0",
      "# Model: conds",
      "import psyneulink as pnl",
      "A = pnl.TransferMechanism(name='A')",
      "B = pnl.TransferMechanism(name='B')",
      "conds = pnl.Composition(name='conds')",
      "conds.add_linear_processing_pathway([A, B])",
      "conds.scheduler.add_condition(B, pnl.All(pnl.EveryNCalls(A, 1), pnl.AfterPass(1)))",
      "",
    ].join("\n"),
  );
  await openFromPath(page, file);

  const toolbar = page.getByTestId("app-toolbar");
  await expectHeight(page.getByTestId("open-menu"), BASELINE.appToolbarButton, "Open ▾");
  await expectHeight(page.getByTestId("toolbar-save"), BASELINE.appToolbarButton, "Save");
  await expectHeight(page.getByTestId("layout-menu-button"), BASELINE.appToolbarButton, "Layout ▾");
  await expect(toolbar).toBeVisible();
  // The view toggles moved into Advanced Graph View Options (#123); its
  // button and Layout: Auto/Custom keep the toggles' height.
  await expectHeight(page.getByTestId("graph-view-options-button"), BASELINE.graphToolbarButton, "Advanced Graph View Options ▾");
  await expectHeight(page.getByRole("button", { name: /^Layout: (Auto|Custom)$/ }), BASELINE.graphToolbarButton, "Layout: Auto/Custom");

  await clickCanvasNode(page, "B");
  await page.getByTestId("tab-inspector").click();
  const panel = sidePanel(page);
  const addPort = panel.locator('button[title="Add input port"]');
  await expectHeight(addPort, BASELINE.portHeaderButton, "Inputs +");
  await expectHeight(addPort.locator("xpath=.."), BASELINE.portHeaderRow, "the Inputs header line");

  const remove = panel.locator('button[title="Remove condition"]');
  await expectHeight(remove, BASELINE.conditionRemove, "a condition's ✕");
  await expectHeight(remove.locator("xpath=.."), BASELINE.conditionRow, "the condition's line");
  await expectHeight(panel.locator('button[title="Edit condition"]'), BASELINE.conditionRemove, "a condition's Edit");
  await expectHeight(panel.getByRole("button", { name: "+ Add Graph Condition" }), BASELINE.addGraphCondition, "+ Add Graph Condition");

  await panel.locator('button[title="Edit condition"]').click();
  const save = panel.getByRole("button", { name: "Save", exact: true });
  await expectHeight(save, BASELINE.conditionFormButtons, "the condition builder's Save");
  await expectLevel(save.locator("xpath=.."), "the condition builder's Save and Cancel");
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();

  // A node without an execution condition offers to add one.
  await clickCanvasNode(page, "A");
  await page.getByTestId("tab-inspector").click();
  await expectHeight(
    sidePanel(page).getByRole("button", { name: "+ Add Execution Condition" }),
    BASELINE.addExecutionCondition,
    "+ Add Execution Condition",
  );
});

test("the Run and Learn panels keep their row heights", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  await openFromPath(page, fixturePath("two_input_nodes"));
  await page.getByTestId("tab-run").click();
  const panel = page.getByTestId("run-panel");
  const runModel = page.getByRole("button", { name: /Run Model/ });
  const reset = panel.getByRole("button", { name: "Reset", exact: true });
  await expectHeight(reset, BASELINE.runReset, "Reset");
  await expectHeight(runModel, BASELINE.runModel, "Run Model");
  expect(Math.abs((await height(reset)) - (await height(runModel))), "Reset beside Run Model").toBeLessThanOrEqual(1);

  const addTrial = panel.getByRole("button", { name: "+ Add trial" });
  await expectHeight(addTrial, BASELINE.runAddTrial, "+ Add trial");
  await addTrial.click();
  await expectHeight(panel.locator('button[title="Remove this trial"]').first(), BASELINE.runTrialX, "a trial's ✕");

  await page.getByRole("button", { name: "Trial", exact: true }).click();
  const trialX = panel.locator('button[title="Remove this trial"]').first();
  await expectHeight(trialX.locator("xpath=.."), BASELINE.runTrialHeaderRow, "the Trial 1 ✕ line");

  // Learn: Start Learning, on the autodiff demo.
  await page.getByTestId("open-menu").click();
  await page.getByText("Autodiff Feedforward", { exact: true }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tab-learn").click();
  await expectHeight(page.getByRole("button", { name: /Start Learning/i }), BASELINE.learnStart, "Start Learning");
});

