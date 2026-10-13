/**
 * Editing a Reference Model, in the app and in an outside editor (#1242, part B
 * cases 4–5 and part C cases 6–8; part of #652).
 *
 * The rules for editing were tested through the UI only on a plain model file
 * (external-edit-sync, preview-not-save). This runs them on the catalog people
 * actually open models from. Reference Models are the developer and
 * walkthrough path since #1228; test-base switches that catalog on.
 *
 * A reference model opens as a *working copy* in the session's working dir;
 * the bundled original in backend/reference_models/ is never written. Each
 * test learns the working copy's path from the load response rather than
 * guessing it, and asserts on the bytes on disk, because that is the promise.
 *
 * Outside edits are written the way PyCharm saves ("safe write": temp file,
 * move the original aside, rename the temp file into place).
 *
 * Cases 1–3 (PsyNeuLink Library with a local checkout, and the Reference EGO
 * against an edit to PsyNeuLink's own EGO) need a local-kind PsyNeuLink source,
 * which the e2e backend can't be pointed at; they are covered by
 * backend/tests/test_reference_edit_local_source.py.
 */
import { mutatingTest as test, expect, canvasNode } from "./test-base";
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Small and quick to load; ships a curated layout and labels.
const MODEL = "stroop_reference_basic";
const LABEL = "Stroop — Basic";
const OTHER_LABEL = "Simple Stroop"; // a demo, to open something else in between
const PRISTINE = path.resolve(__dirname, "../../backend/reference_models", `${MODEL}.py`);

const EXTRA = "extra_1242";
const ADDED_NODE = [
  `${EXTRA} = pnl.TransferMechanism(input_shapes=2, name='${EXTRA}')`,
  `stroop_model.add_node(${EXTRA})`,
].join("\n");

/** The model with one more node: what "an edit" means in these tests. */
function withExtraNode(source: string): string {
  return `${source.trimEnd()}\n${ADDED_NODE}\n`;
}

/** Save the way PyCharm does. */
function safeWrite(file: string, content: string) {
  const tmp = `${file}___jb_tmp___`;
  const old = `${file}___jb_old___`;
  writeFileSync(tmp, content);
  renameSync(file, old);
  renameSync(tmp, file);
  unlinkSync(old);
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
}

/** Open the reference from the Open menu; return its working copy's path. */
async function openReference(page: Page): Promise<{ workingCopy: string; diverged: boolean }> {
  await openMenu(page);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/reference-models/load") && r.request().method() === "POST",
      { timeout: 60_000 },
    ),
    page.getByText(LABEL, { exact: true }).first().click(),
  ]);
  expect(resp.ok(), `reference load failed: ${resp.status()}`).toBe(true);
  const body = await resp.json();
  await expect(canvasNode(page, "color_input")).toBeVisible({ timeout: 60_000 });
  return { workingCopy: body.file_path, diverged: !!body.workingCopy?.diverged };
}

async function replaceEditorText(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

/**
 * The toolbar Save button, not Cmd-S: headless Chromium resolves CodeMirror's
 * "Mod-s" differently from Playwright's ControlOrMeta on a macOS host (see
 * preview-not-save.spec.ts).
 */
function saveButton(page: Page) {
  return page.getByRole("button", { name: /^Save$/ }).first();
}

const editor = (page: Page) => page.locator(".cm-content");

/**
 * The text at the end of the code editor.
 *
 * CodeMirror renders only the lines in view, so a line appended to a 150-line
 * model isn't in the DOM until the editor scrolls to it; asserting on
 * `.cm-content` alone would read the top of the file. Scroll to the bottom,
 * then read. (The store isn't exposed on window in a production build.)
 */
async function editorTail(page: Page): Promise<string> {
  await page.locator(".cm-scroller").first().evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  return (await editor(page).textContent()) ?? "";
}
const conflictModal = (page: Page) => page.getByTestId("external-change-modal");

test.describe("Reference model editing (#1242)", { tag: "@ci" }, () => {
  test("reopening a reference keeps the edits saved to it, and says so (case 4)", async ({ page }) => {
    test.setTimeout(240_000);
    const pristineBefore = readFileSync(PRISTINE, "utf8");
    await page.goto("/");
    const { workingCopy } = await openReference(page);
    const edited = withExtraNode(readFileSync(workingCopy, "utf8"));

    await replaceEditorText(page, edited);
    await expect(canvasNode(page, EXTRA)).toBeVisible({ timeout: 60_000 });
    await saveButton(page).click();
    await expect.poll(() => readFileSync(workingCopy, "utf8"), { timeout: 30_000 }).toBe(edited);
    // The file lands before the app has taken in the save's reply; until it
    // has, opening another model rightly asks about unsaved changes.
    await expect(saveButton(page)).toBeDisabled({ timeout: 30_000 });

    // Open something else, then come back to the reference.
    await openMenu(page);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/demos/reset"), { timeout: 60_000 }),
      page.getByRole("button", { name: OTHER_LABEL, exact: true }).click(),
    ]);
    await expect(canvasNode(page, EXTRA)).toHaveCount(0, { timeout: 60_000 });

    const reopened = await openReference(page);
    expect(reopened.workingCopy).toBe(workingCopy);
    expect(reopened.diverged).toBe(true);
    await expect(page.getByText(/your changes were kept/)).toBeVisible({ timeout: 15_000 });
    await expect(canvasNode(page, EXTRA)).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => editorTail(page), { timeout: 15_000 }).toContain(`name='${EXTRA}'`);
    expect(readFileSync(workingCopy, "utf8")).toBe(edited);
    // The bundled original is never the thing that got edited.
    expect(readFileSync(PRISTINE, "utf8")).toBe(pristineBefore);
  });

  test("an outside save to the working copy lands on the canvas; the bundled file is untouched (case 5)", async ({ page }) => {
    test.setTimeout(180_000);
    const pristineBefore = readFileSync(PRISTINE, "utf8");
    await page.goto("/");
    const { workingCopy } = await openReference(page);
    expect(path.resolve(workingCopy)).not.toBe(PRISTINE);
    await expect(canvasNode(page, EXTRA)).toHaveCount(0);

    const outside = withExtraNode(readFileSync(workingCopy, "utf8"));
    safeWrite(workingCopy, outside);

    // Nothing unsaved here, so it is taken without asking.
    await expect(canvasNode(page, EXTRA)).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => editorTail(page), { timeout: 15_000 }).toContain(`name='${EXTRA}'`);
    await expect(conflictModal(page)).toHaveCount(0);
    expect(readFileSync(PRISTINE, "utf8")).toBe(pristineBefore);
  });

  test("both sides edited, Load from disk: the editor shows the disk version and nothing is written (case 6)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    const { workingCopy } = await openReference(page);
    const original = readFileSync(workingCopy, "utf8");

    await replaceEditorText(page, `${original.trimEnd()}\n# edited in PsyNeuView, not saved\n`);
    await expect.poll(() => editorTail(page)).toContain("edited in PsyNeuView, not saved");

    const outside = withExtraNode(original);
    safeWrite(workingCopy, outside);

    await expect(conflictModal(page)).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("external-change-load-disk").click();
    await expect(conflictModal(page)).toHaveCount(0);

    await expect(canvasNode(page, EXTRA)).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => editorTail(page), { timeout: 15_000 }).toContain(`name='${EXTRA}'`);
    expect(await editorTail(page)).not.toContain("edited in PsyNeuView, not saved");
    // Taking the disk version is a read; the file is exactly what was saved outside.
    expect(readFileSync(workingCopy, "utf8")).toBe(outside);
  });

  test("both sides edited, Keep my changes, then Save: the conflict asks again, never overwrites (case 7)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    const { workingCopy } = await openReference(page);
    const original = readFileSync(workingCopy, "utf8");
    const mine = `${original.trimEnd()}\n# edited in PsyNeuView\n`;

    await replaceEditorText(page, mine);
    await expect.poll(() => editorTail(page)).toContain("# edited in PsyNeuView");

    const outside = withExtraNode(original);
    safeWrite(workingCopy, outside);

    await expect(conflictModal(page)).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("external-change-keep-mine").click();
    await expect(conflictModal(page)).toHaveCount(0);
    await expect.poll(() => editorTail(page)).toContain("# edited in PsyNeuView");

    // Save now would discard the outside edit, so the server refuses (#926)...
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/save-source"), { timeout: 60_000 }),
      saveButton(page).click(),
    ]);
    expect(resp.status()).toBe(409);
    expect((await resp.json()).detail?.reason).toBe("stale_buffer");
    // ...and the app hands the choice back rather than guessing.
    await expect(conflictModal(page)).toBeVisible({ timeout: 30_000 });
    expect(readFileSync(workingCopy, "utf8")).toBe(outside);
    expect(await editorTail(page)).toContain("# edited in PsyNeuView");
  });

  test("after Save a copy as .py, later edits go to the copy and the working copy is unchanged (case 8)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    const { workingCopy } = await openReference(page);
    const workingBefore = readFileSync(workingCopy, "utf8");

    await page.getByRole("button", { name: /Save a copy as/ }).click();
    const name = `stroop_copy_1242_${Date.now()}.py`;
    const nameInput = page.locator('input[placeholder="my_model.py"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(name);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/models/save-as"), { timeout: 60_000 }),
      nameInput.press("Enter"),
    ]);
    expect(resp.ok(), `save-as failed: ${resp.status()}`).toBe(true);
    const copy: string = (await resp.json()).file_path;
    expect(path.basename(copy)).toBe(name);
    expect(readFileSync(copy, "utf8")).toBe(workingBefore);

    const edited = withExtraNode(workingBefore);
    await replaceEditorText(page, edited);
    await expect(canvasNode(page, EXTRA)).toBeVisible({ timeout: 60_000 });
    await saveButton(page).click();

    await expect.poll(() => readFileSync(copy, "utf8"), { timeout: 30_000 }).toBe(edited);
    expect(readFileSync(workingCopy, "utf8")).toBe(workingBefore);
  });
});
