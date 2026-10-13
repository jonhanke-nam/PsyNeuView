/**
 * Undo and redo: one notice for a burst, not one per step (#1377).
 *
 * Every undo used to add its own notice, so holding Cmd+Z stacked a column of
 * them down the window. Now a burst of undos (or redos) is one notice,
 * updated in place, with a button that takes the whole burst back; a jump in
 * History is one action with one notice; and the notice clears itself.
 *
 * The edits are recorded through the automation hook (`window.__pnvUndoTest`,
 * utils/history.ts), as undo-depth.spec.ts does, so the test need not wait
 * for each one's preview.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const EDITS = 60;

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "undo1377-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  // A notice slides in; take it once it has arrived.
  for (const n of await page.getByTestId("notification").all()) await expect(n).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** Open a scratch copy of the model and record EDITS code edits on it. */
async function openWithEdits(page: Page) {
  const model = scratchModel();
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  // Let the load's own step land before recording ours.
  await expect(page.getByTestId("undo-button")).toBeDisabled({ timeout: 10_000 });
  await page.evaluate(
    ({ BASE, EDITS }) => {
      const hook = (window as any).__pnvUndoTest;
      let s = BASE;
      for (let i = 1; i <= EDITS; i++) {
        s += `# edit ${i}\n`;
        hook.recordCodeEdit(s, `Edit ${i}`);
      }
    },
    { BASE, EDITS },
  );
  await expect.poll(() => editorText(page)).toContain(`# edit ${EDITS}\n`);
}

function editorText(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__pnvUndoTest.source() as string);
}

const notices = (page: Page) => page.getByTestId("notification");

test.describe("Undo and redo notices (#1377)", { tag: "@ci" }, () => {
  test("20 quick undos leave one notice; its Redo redoes all 20; it clears itself", async ({ page }) => {
    test.setTimeout(120_000);
    await openWithEdits(page);

    // Twenty Cmd+Z presses in quick succession, with the canvas focused (not
    // a text field, where Cmd+Z is the field's own).
    await page.locator(".react-flow__pane").click({ position: { x: 10, y: 10 } });
    // The app picks Cmd or Ctrl from the platform the page reports, which in
    // the headless browser need not be the machine's (it can say Win32 on a
    // Mac), so the key follows the page, not ControlOrMeta.
    const mod = await page.evaluate(() => (/mac/i.test(navigator.platform) ? "Meta" : "Control"));
    for (let i = 0; i < 20; i++) await page.keyboard.press(`${mod}+z`);
    await expect.poll(() => editorText(page)).not.toContain("# edit 41\n");
    await expect(notices(page)).toHaveCount(1);
    await expect(notices(page).getByTestId("notification-message")).toHaveText("Undid 20 edits: back to Edit 40");
    await expect(page.getByTestId("history-notice-reverse")).toHaveText("Redo");
    await shot(page, "02-after-one-notice-for-twenty-undos");

    // Redo in the notice redoes the whole burst, and says so in the same place.
    await page.getByTestId("history-notice-reverse").click();
    await expect.poll(() => editorText(page)).toContain(`# edit ${EDITS}\n`);
    await expect(notices(page)).toHaveCount(1);
    await expect(notices(page).getByTestId("notification-message")).toHaveText(
      `Redid 20 edits: forward to Edit ${EDITS}`,
    );
    await expect(page.getByTestId("history-notice-reverse")).toHaveText("Undo");

    // It clears itself (5 s after the last step).
    await expect(notices(page)).toHaveCount(0, { timeout: 10_000 });

    // A single undo, with the toolbar button: a quiet one-line notice.
    await page.getByTestId("undo-button").click();
    await expect(notices(page)).toHaveCount(1);
    await expect(notices(page).getByTestId("notification-message")).toHaveText(`Undid Edit ${EDITS}`);
  });

  test("going back in History is one action with one notice", async ({ page }) => {
    test.setTimeout(120_000);
    await openWithEdits(page);

    await page.getByTestId("history-button").click();
    const panel = page.getByTestId("history-panel");
    const row = panel.getByTestId("history-step").filter({ hasText: /^Edit 40\b/ });
    await expect(row).toHaveAttribute("title", /undoes everything up to this step \(20 steps\)/);
    await row.click();
    await expect(panel.getByTestId("history-go-to-step")).toHaveText("Go back to this step (20 steps)");
    await shot(page, "03-history-step-offers-go-back");
    await panel.getByTestId("history-go-to-step").click();

    await expect.poll(() => editorText(page)).not.toContain("# edit 41\n");
    await expect(page.locator(".cm-content")).toContainText("# edit 40");
    await expect(panel.getByTestId("history-counts")).toContainText("40 undo steps, 20 redo steps");
    await expect(notices(page)).toHaveCount(1);
    await expect(notices(page).getByTestId("notification-message")).toHaveText("Went back 20 steps, to Edit 40");
    await shot(page, "04-after-one-notice-for-a-history-jump");

    // Its Redo goes forward all 20 again.
    await page.getByTestId("history-notice-reverse").click();
    await expect.poll(() => editorText(page)).toContain(`# edit ${EDITS}\n`);
    await expect(notices(page)).toHaveCount(1);
  });
});
