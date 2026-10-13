/**
 * Removing a condition in the Inspector is its own undo step (#1369).
 *
 * The graph-structure condition's Remove Condition and the execution
 * condition's ✕ edited the model without recording a step first; undo only
 * worked because the reload after the edit happened to record one. Now each
 * records the step before the edit, as the other Inspector edits do.
 *
 * Asserted against the bytes on disk, like saves-in-history.spec.ts: the
 * Inspector's remove writes the file, and undo never does (#1349). After the
 * undo the condition is back in the code and the Inspector, and the file still
 * holds the removal until you save.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

const MODEL_SOURCE = [
  "import psyneulink as pnl",
  "",
  "A = pnl.TransferMechanism(name='A')",
  "B = pnl.TransferMechanism(name='B')",
  "C = pnl.TransferMechanism(name='C')",
  "",
  "cond_undo = pnl.Composition(name='cond_undo')",
  "cond_undo.add_linear_processing_pathway([A, B])",
  "cond_undo.add_node(C)",
  "",
  "cond_undo.scheduler.add_condition(C, pnl.BeforeNode(A))",
  "cond_undo.scheduler.add_condition(B, pnl.EveryNCalls(A, 2))",
  "",
].join("\n");

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "condundo1369-"));
  const file = path.join(dir, "cond_undo.py");
  writeFileSync(file, MODEL_SOURCE);
  return file;
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.react-flow__node[data-id="B"]')).toBeVisible({ timeout: 60_000 });
  // The graph-condition legend floats over the canvas; it is not under test.
  await page.getByTestId("gsc-legend-hide").click({ timeout: 10_000 }).catch(() => {});
}

/** Check, every quarter second for `ms`, that something stays true. */
async function holdsFor(page: Page, ms: number, check: () => void) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    check();
    await page.waitForTimeout(250);
  }
  check();
}

const editor = (page: Page) => page.locator(".cm-content");
const inspector = (page: Page) => page.getByTestId("panel-inspector");

// Room for the graph beside the editor and Inspector, and nothing over it.
test.use({ viewport: { width: 1600, height: 1000 } });

/** Select a node by its top edge: an edge's label can sit over its middle. */
async function selectNode(page: Page, id: string) {
  const node = page.locator(`.react-flow__node[data-id="${id}"]`);
  const box = await node.boundingBox();
  await node.click({ position: { x: (box?.width ?? 40) / 2, y: 10 } });
}

test.describe("Inspector condition removes record their own undo step (#1369)", { tag: "@ci" }, () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("remove a graph-structure condition, undo: it is back, the file is not rewritten", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);

    // Select the condition by its dashed edge's badge on the canvas.
    await page.locator(".react-flow__edgelabel-renderer").getByText("before", { exact: true }).click();
    await expect(inspector(page).getByText("Scheduling Condition")).toBeVisible();
    await page.getByRole("button", { name: "Remove Condition" }).click();

    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).not.toContain("BeforeNode");
    await expect(editor(page)).not.toContainText("BeforeNode");
    const removed = readFileSync(model, "utf8");

    await page.getByTestId("undo-button").click();

    await expect(editor(page)).toContainText("pnl.BeforeNode(A)");
    // Back in the Inspector: the node's Scheduling section lists it again.
    await selectNode(page, "C");
    await expect(inspector(page).getByText("Graph conditions (owned)")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    // Undo never writes the file (#1349): it still holds the removal.
    await holdsFor(page, 3_000, () => expect(readFileSync(model, "utf8")).toBe(removed));
  });

  test("remove an execution condition, undo: it is back, the file is not rewritten", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);

    await selectNode(page, "B");
    await expect(inspector(page).getByText("Execution condition", { exact: true })).toBeVisible();
    await inspector(page).getByTitle("Remove condition", { exact: true }).click();

    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).not.toContain("EveryNCalls");
    await expect(editor(page)).not.toContainText("EveryNCalls");
    await expect(inspector(page).getByRole("button", { name: "+ Add Execution Condition" })).toBeVisible({ timeout: 30_000 });
    const removed = readFileSync(model, "utf8");

    await page.getByTestId("undo-button").click();

    await expect(editor(page)).toContainText("pnl.EveryNCalls(A, 2)");
    await selectNode(page, "B");
    await expect(inspector(page).getByTitle("Edit condition", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(inspector(page).getByTitle("Remove condition", { exact: true })).toBeVisible();
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();
    await holdsFor(page, 3_000, () => expect(readFileSync(model, "utf8")).toBe(removed));
  });

  test("the step is taken before the edit: an unsaved edit not yet previewed comes back too", async ({ page }) => {
    // Before #1369 the only step was the one the reload took after the edit,
    // so what the editor held just before the remove (typed, not yet
    // previewed) was in no step, and undo could not bring it back.
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    // Hold every preview back, so the typed line reaches no step on its own.
    await page.route("**/api/model/preview", (route) => route.abort());

    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("# typed just before the remove\n");
    await page.locator(".react-flow__edgelabel-renderer").getByText("before", { exact: true }).click();
    await inspector(page).getByRole("button", { name: "Remove Condition" }).click();
    await expect.poll(() => readFileSync(model, "utf8"), { timeout: 30_000 }).not.toContain("BeforeNode");
    const removed = readFileSync(model, "utf8");

    await page.getByTestId("undo-button").click();

    await expect(editor(page)).toContainText("pnl.BeforeNode(A)");
    await expect(editor(page)).toContainText("# typed just before the remove");
    await holdsFor(page, 3_000, () => expect(readFileSync(model, "utf8")).toBe(removed));
  });
});
