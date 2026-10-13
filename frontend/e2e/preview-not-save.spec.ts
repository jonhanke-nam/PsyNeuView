/**
 * Typing in the code editor must not write the user's file (#1029).
 *
 * The canvas is built by executing a model file, and it used to be *your* file
 * that got written — on a 1.5s timer, unprompted, including every half-typed
 * intermediate state. With an IDE open on the same model that is a real
 * problem. Edits are now previewed instead, and only Save writes.
 *
 * These assert on the bytes on disk, because that is the actual promise.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

// A distinctive gain: the inspector renders many bare "1"/"0" inputs, and
// matching on value is the only stable way to find a specific one.
const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8").replace(
  "function=pnl.Logistic()",
  "function=pnl.Logistic(gain=1.7)",
);
const ADDED_NODE = [
  "extra_mech = pnl.TransferMechanism(input_shapes=[3], function=pnl.Linear(), name='extra_mech')",
  "two_mech_projection.add_node(extra_mech)",
].join("\n");

function scratchModel() {
  const dir = mkdtempSync(path.join(tmpdir(), "preview1029-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function openModel(page: any, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

async function typeIntoEditor(page: any, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

test("typing previews on the canvas without writing the file (#1029)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  const before = readFileSync(model, "utf8");
  await openModel(page, model);

  await typeIntoEditor(page, `${BASE}\n${ADDED_NODE}\n`);

  // The canvas keeps up — that capability must survive the change.
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toBeVisible({
    timeout: 60_000,
  });

  // ...and the user's file is untouched, which is the whole point.
  expect(readFileSync(model, "utf8")).toBe(before);
});

test("Save is what writes the file (#1029)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openModel(page, model);

  await typeIntoEditor(page, `${BASE}\n${ADDED_NODE}\n`);
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toBeVisible({
    timeout: 60_000,
  });
  expect(readFileSync(model, "utf8")).not.toContain("extra_mech");

  // The toolbar Save button, not Cmd-S: headless Chromium reports
  // `navigator.platform === "Win32"`, so CodeMirror resolves "Mod-s" to Ctrl-s
  // while Playwright's ControlOrMeta sends Meta on a macOS host. The keybinding
  // is fine for real users; it is the test browser that disagrees. Both routes
  // land in the same saveAndRefresh.
  await page.getByRole("button", { name: /^Save$/ }).first().click();

  await expect
    .poll(() => readFileSync(model, "utf8").includes("extra_mech"), { timeout: 30_000 })
    .toBe(true);
});

test("an inspector edit commits the buffer first, not stale source (#1029)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openModel(page, model);

  // An unsaved code edit sitting in the buffer...
  await typeIntoEditor(page, `${BASE}\n${ADDED_NODE}\n`);
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toBeVisible({
    timeout: 60_000,
  });
  expect(readFileSync(model, "utf8")).not.toContain("extra_mech");

  // ...then a deliberate inspector action. These are applied by the backend to
  // the file *on disk*, so the buffer has to reach it first or the edit is
  // computed from source the user is no longer looking at.
  await page.locator('.react-flow__node[data-id^="receiver_mech"]').first().click();
  await expect(page.getByText("gain", { exact: true })).toBeVisible({ timeout: 15_000 });
  const gain = page.locator('input[value="1.7"]').first();
  await expect(gain).toBeVisible({ timeout: 15_000 });
  // Drive it by keyboard once focused: the locator matches on value="1.7",
  // so it stops matching the instant we type into it.
  await gain.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("2.5");
  await page.keyboard.press("Enter");

  // Both the buffered edit and the inspector edit are in the file.
  await expect
    .poll(() => readFileSync(model, "utf8"), { timeout: 30_000 })
    .toContain("extra_mech");
  expect(readFileSync(model, "utf8")).toMatch(/gain\s*=\s*2\.5/);
});

test("a preview firing mid-save must not abort the save (#1029)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openModel(page, model);

  // Make the save outlast the 1.5s preview timer, so the timer is guaranteed to
  // fire while the write is in flight. On a fast machine the save always wins
  // and the race is invisible; on a loaded CI runner it is not.
  await page.route("**/api/model/save-source", async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });

  await typeIntoEditor(page, `${BASE}\n${ADDED_NODE}\n`);
  const saveBtn = page.getByRole("button", { name: "Save", exact: true });
  await expect(saveBtn).toBeEnabled();

  await saveBtn.click();

  // The save completed: the buffer reconciled with disk and the file has the
  // edit. If a preview aborted the save, neither would be true.
  await expect(saveBtn).toBeDisabled({ timeout: 30_000 });
  expect(readFileSync(model, "utf8")).toContain("extra_mech");
});
