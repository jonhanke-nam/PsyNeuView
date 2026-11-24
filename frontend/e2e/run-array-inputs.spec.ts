/**
 * Trial inputs as arrays (#330), arranged by trial by default (#331).
 *
 * Loads Stroop, types `[0, 1]` for color_input's first trial in bracket
 * notation, checks a wrong length and a non-number are named and block Run,
 * runs, and checks the inputs sent are exactly the bracketed values. Then
 * turns on Settings ▸ General ▸ Run inputs ▸ Edit each element in its own
 * box and checks the per-element boxes come back, holding the same values.
 *
 * ARRAY330_SHOTS=<dir> also saves the numbered review screenshots there.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const REF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backend/reference_models");
const SHOTS = process.env.ARRAY330_SHOTS;

// Review screenshots at the Mac app's default window, 1200 by 800.
if (SHOTS) test.use({ viewport: { width: 1200, height: 800 } });

type Locator = import("@playwright/test").Locator;

async function shot(page: Page, name: string, target?: Locator, frame?: Locator) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, `${name}.png`);
  if (target && frame) {
    // `target` centred in view, and the visible part of `frame` (a
    // scrolling panel) captured round it.
    await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await frame.screenshot({ path: file });
  } else if (target) {
    // Centred, so the panel's sticky Run row doesn't cover its top.
    await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await target.screenshot({ path: file });
  } else await page.screenshot({ path: file });
}

async function loadStroop(page: Page) {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "array330-"));
  for (const f of ["stroop_reference_basic.py", "stroop_reference_basic.labels.yaml", "stroop_reference_basic.pnlview.json"]) {
    copyFileSync(path.join(REF, f), path.join(dir, f));
  }
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(dir, "stroop_reference_basic.py"));
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__edge").first()).toBeVisible({ timeout: 60_000 });
}

test("trial inputs are typed as arrays and sent as typed", { tag: "@ci" }, async ({ page }) => {
  await loadStroop(page);
  await page.getByTestId("tab-run").click();
  const panel = page.getByTestId("run-panel");
  await expect(panel.getByRole("button", { name: /Run Model/ })).toBeVisible();

  // #331: arranged by trial, the first choice in the switch.
  const grouping = panel.getByTestId("run-grouping");
  await expect(grouping.getByText("Arrange inputs:")).toBeVisible();
  await expect(grouping.getByRole("button", { name: "By trial" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("run-trial-group-1")).toBeVisible();

  // Each trial's input is one field in bracket notation.
  const field = panel.getByTestId("run-trial-input-color_input-1");
  await expect(field).toHaveValue("[1, 0]");
  await shot(page, "00-run-tab-context");
  await shot(page, "01-bracket-default-by-trial", panel.getByTestId("run-trial-group-1"));

  // A wrong length is named beside the field and blocks the run.
  const runButton = panel.getByRole("button", { name: /Run Model/ });
  await field.fill("[0, 1, 1]");
  const error = panel.getByTestId("run-trial-input-error-color_input-1");
  await expect(error).toHaveText("Needs 2 numbers, got 3");
  await expect(runButton).toBeDisabled();
  await shot(page, "02-bracket-wrong-length", panel.getByTestId("run-trial-group-1"));

  await field.fill("[0, x]");
  await expect(error).toHaveText('"x" isn\'t a number');
  await shot(page, "03-bracket-not-a-number", panel.getByTestId("run-trial-group-1"));

  // PsyNeuLink's extra pair of brackets round a one-port value is accepted.
  await field.fill("[[0, 1]]");
  await expect(error).toHaveCount(0);
  await shot(page, "04-bracket-nested-accepted", panel.getByTestId("run-trial-group-1"));

  await field.fill("[0, 1]");
  await expect(error).toHaveCount(0);
  await expect(runButton).toBeEnabled();

  // What runs is exactly what was typed.
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/model/run") && r.method() === "POST"),
    runButton.click(),
  ]);
  const body = request.postDataJSON() as { inputs: Record<string, unknown[]> };
  expect(body.inputs.color_input[0]).toEqual([0, 1]);
  await expect(panel.getByText(/Results \(\d+ trials?\)/)).toBeVisible({ timeout: 60_000 });
  await shot(page, "05-after-run");

  // By node: the same fields under each node, its elements named in the header.
  await grouping.getByRole("button", { name: "By node" }).click();
  await expect(panel.getByText(/color_input\s*\[2 elements: red_ink, green_ink\]/)).toBeVisible();
  await expect(panel.getByTestId("run-trial-input-color_input-1")).toHaveValue("[0, 1]");
  await shot(page, "06-bracket-by-node", panel.getByTestId("run-input-color_input"), panel);
  await grouping.getByRole("button", { name: "By trial" }).click();
  await shot(page, "07-arrange-inputs-control", grouping);

  // Row height in bracket notation, to compare with the grid below.
  const bracketRow = await panel.getByTestId("run-trial-group-1").boundingBox();

  // The setting brings the per-element boxes back, holding the same values.
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-general").click();
  const setting = page.getByTestId("setting-run-input-cell-grid");
  await expect(setting).not.toBeChecked();
  await setting.scrollIntoViewIfNeeded();
  await shot(page, "08-setting-off-by-default", page.getByTestId("settings-panel").getByText("Run inputs", { exact: true }), page.getByTestId("settings-panel"));
  await setting.check();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();

  await expect(panel.getByTestId("run-trial-input-color_input-1")).toHaveCount(0);
  const trial1 = panel.getByTestId("run-trial-group-1");
  const cells = trial1.locator('input[inputmode="decimal"]');
  await expect(cells.nth(0)).toHaveValue("0");
  await expect(cells.nth(1)).toHaveValue("1");
  await shot(page, "09-grid-when-setting-on", trial1);
  const gridRow = await trial1.boundingBox();

  // A cell edit in the grid is the same text the bracket field shows.
  await cells.nth(0).fill("abc");
  await expect(runButton).toBeDisabled();
  await shot(page, "10-grid-not-a-number", trial1);
  await cells.nth(0).fill("1");
  await expect(runButton).toBeEnabled();

  if (SHOTS) {
    writeFileSync(
      path.join(SHOTS, "row-heights.json"),
      JSON.stringify({ bracketTrialGroup: bracketRow?.height, gridTrialGroup: gridRow?.height }, null, 2),
    );
  }
});
