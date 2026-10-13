/**
 * Tutorial capture + verification — "The two-editor workflow" (#1034, #662).
 *
 * Walks the loop a PyCharm user actually runs: open a model that lives in a
 * normal project folder, edit it *outside* PsyNeuView, and watch the canvas
 * follow. Then edit inside PsyNeuView and confirm the file on disk changed.
 *
 * The external editor here is `fs`. CI has no PyCharm, and driving a desktop
 * IDE is not something a runner can do — but the app cannot tell the
 * difference, because all it ever sees is the file changing underneath it.
 * A real PyCharm is exercised by `e2e/pycharm-live.local.spec.ts`, which is
 * developer-run.
 *
 * Works on a temp copy: the walkthrough edits the model, and pointing it at a
 * checked-in reference model would rewrite one.
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/two-headed",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

/** What someone would write in PyCharm to begin with. */
const STARTING_MODEL = [
  "import psyneulink as pnl",
  "",
  "stimulus = pnl.TransferMechanism(input_shapes=[2], name='stimulus')",
  "decision = pnl.TransferMechanism(input_shapes=[2], function=pnl.Logistic(), name='decision')",
  "",
  "model = pnl.Composition(name='model')",
  "model.add_linear_processing_pathway([stimulus, decision])",
  "",
].join("\n");

/** The same file after adding a node in the editor. */
const AFTER_EXTERNAL_EDIT = STARTING_MODEL.replace(
  "model.add_linear_processing_pathway([stimulus, decision])",
  [
    "response = pnl.TransferMechanism(input_shapes=[2], name='response')",
    "model.add_linear_processing_pathway([stimulus, decision, response])",
  ].join("\n"),
);

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: The two-editor workflow", () => {
  test("an edit made outside PsyNeuView appears on the canvas", async ({ page }) => {
    test.setTimeout(180_000);

    const dir = mkdtempSync(path.join(tmpdir(), "two-headed-"));
    const model = path.join(dir, "model.py");
    writeFileSync(model, STARTING_MODEL);

    // 1. Open the model that lives in the project folder.
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(model);
    await prompt.press("Enter");
    await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
    await expect(page.locator('.react-flow__node[data-id^="stimulus"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('.react-flow__node[data-id^="response"]')).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("01-opened.png") });

    // 2. The editor saves a new node into the file. PsyNeuView is not touched.
    writeFileSync(model, AFTER_EXTERNAL_EDIT);

    // Guarantee: the canvas follows the file, with no reload and no interaction.
    await expect(page.locator('.react-flow__node[data-id^="response"]')).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("02-after-external-edit.png") });

    // 3. Editing here and saving goes back to the same file on disk.
    //    Typing alone must not write it (#1029) — preview-not-save.spec.ts
    //    is where that property is asserted.
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(
      `${AFTER_EXTERNAL_EDIT}\n# edited in PsyNeuView\n`,
    );
    // Save via the toolbar button rather than Cmd-S: headless Chromium reports
    // `navigator.platform === "Win32"`, so CodeMirror resolves "Mod-s" to
    // Ctrl-s while Playwright's ControlOrMeta sends Meta on a macOS host. Both
    // routes reach the same save; only the test browser disagrees about keys.
    await page.getByRole("button", { name: /^Save$/ }).first().click();

    // Guarantee: the file the external editor has open is what PsyNeuView wrote.
    await expect
      .poll(() => readFileSync(model, "utf8").includes("# edited in PsyNeuView"), {
        timeout: 30_000,
      })
      .toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("03-edited-here.png") });
  });
});
