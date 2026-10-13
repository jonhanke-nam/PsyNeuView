/**
 * Undo as far back as the session goes (#558).
 *
 * History used to keep the last 500 steps. It now keeps every step, holding
 * older ones compactly (code as a difference from the next step, positions,
 * no graph) and rebuilding the graph from the code when undo gets there.
 *
 * Six hundred code edits are recorded through the automation hook
 * (`window.__pnvUndoTest`, utils/history.ts; a real edit waits for its
 * preview, which would take many minutes), under a small memory budget so
 * most of them are compacted. Then the real Undo button walks back through
 * all of them: the code ends exactly where it started, the graph is there,
 * and the file was never written. Redo comes forward again.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const EDITS = 600;

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "undo558-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

/** The code the editor holds (`.cm-content` has only the lines drawn). */
function editorText(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__pnvUndoTest.source() as string);
}

test.describe("Undo depth (#558)", { tag: "@ci" }, () => {
  test("600 edits, undone all the way back to the start, then redone", async ({ page }) => {
    test.setTimeout(300_000);
    const model = scratchModel();
    await openFromPath(page, model);
    const undo = page.getByTestId("undo-button");
    const redo = page.getByTestId("redo-button");
    // Let the load's own step land before recording ours.
    await expect(undo).toBeDisabled({ timeout: 10_000 });

    // A small budget, so all but the newest few steps are compact.
    const stats = await page.evaluate(
      ({ BASE, EDITS }) => {
        const hook = (window as any).__pnvUndoTest;
        hook.setBudget({ fullBytes: 50_000 });
        let s = BASE;
        for (let i = 1; i <= EDITS; i++) {
          s += `# edit ${i}\n`;
          hook.recordCodeEdit(s, `Edit ${i}`);
        }
        return hook.stats();
      },
      { BASE, EDITS },
    );
    expect(stats.steps).toBe(EDITS + 1);
    expect(stats.compact).toBeGreaterThan(EDITS - 50);
    await expect.poll(() => editorText(page)).toContain(`# edit ${EDITS}\n`);

    // History lists them, says it keeps every step, and offers the earlier ones.
    await page.getByTestId("history-button").click();
    const panel = page.getByTestId("history-panel");
    await expect(panel.getByTestId("history-counts")).toContainText(`${EDITS} undo steps, 0 redo steps`);
    await expect(panel.getByTestId("history-depth")).toHaveText("· keeps every step");
    await expect(panel.getByTestId("history-show-earlier")).toBeVisible();
    await shot(page, "undo558-01-history-keeps-every-step");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Undo every edit with the toolbar button.
    for (let i = 0; i < EDITS; i++) await undo.click();
    await expect(undo).toBeDisabled();
    await expect.poll(() => editorText(page)).toBe(BASE);
    await expect(page.locator(".cm-content")).not.toContainText("# edit");
    // Back to exactly the text on disk: nothing unsaved.
    await expect(page.getByTestId("unsaved-dot")).toHaveCount(0, { timeout: 30_000 });
    // The graph was rebuilt from the oldest (compact) step's code.
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
    // Undo never writes the file.
    expect(readFileSync(model, "utf8")).toBe(BASE);

    // Redo comes forward through compact steps too.
    for (let i = 0; i < 3; i++) await redo.click();
    await expect.poll(() => editorText(page)).toBe(`${BASE}# edit 1\n# edit 2\n# edit 3\n`);
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    expect(readFileSync(model, "utf8")).toBe(BASE);

    // History agrees: three undo steps, the rest to redo.
    await page.getByTestId("history-button").click();
    await expect(page.getByTestId("history-counts")).toContainText(`3 undo steps, ${EDITS - 3} redo steps`);
    await shot(page, "undo558-02-history-after-undo-and-redo");
  });
});
