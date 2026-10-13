/**
 * The two-headed workflow: PsyNeuView open beside an external editor (#926).
 *
 * Writing to the `.py` with `fs` is exactly what PyCharm does — save a file the
 * app is watching. The app should notice.
 *
 * Two behaviors, and the difference between them is the whole design:
 *   - no unsaved edits here  -> take the external version silently
 *   - unsaved edits here     -> block and ask, never guess which one you meant
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

/** What PyCharm saves: the model plus a third mechanism. */
const EXTERNALLY_EDITED = BASE.replace(
  "two_mech_projection.add_projection(sender_to_receiver)",
  [
    "extra_mech = pnl.TransferMechanism(input_shapes=[3], function=pnl.Linear(), name='extra_mech')",
    "two_mech_projection.add_projection(sender_to_receiver)",
    "two_mech_projection.add_node(extra_mech)",
  ].join("\n"),
);

/** A copy we can freely write to — never the checked-in fixture. */
function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "extedit926-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function openFromPath(page: any, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page
    .getByRole("button", { name: /^Skip$/ })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

test("an external edit lands on the canvas when nothing here is unsaved (#926)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openFromPath(page, model);
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toHaveCount(0);

  // PyCharm saves.
  writeFileSync(model, EXTERNALLY_EDITED);

  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toBeVisible({
    timeout: 60_000,
  });
  // Applied cleanly, so the buffer is not left looking dirty against a stale
  // baseline — Save stays disabled until the user actually changes something.
  await expect(page.locator('[data-testid="external-change-modal"]')).toHaveCount(0);
});

test("an external edit on top of unsaved edits blocks and asks (#926)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openFromPath(page, model);

  // Unsaved edit here: a comment is enough to make the buffer dirty, and it
  // survives re-introspection so we can assert on it afterwards.
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(`${BASE}\n# edited in PsyNeuView, not saved\n`);
  await expect(editor).toContainText("edited in PsyNeuView, not saved");

  // PyCharm saves underneath us. Both sides have now changed.
  writeFileSync(model, EXTERNALLY_EDITED);

  const modal = page.locator('[data-testid="external-change-modal"]');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  // Nothing has been applied while the question is open.
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toHaveCount(0);

  // Keeping our changes leaves the buffer alone...
  await page.getByTestId("external-change-keep-mine").click();
  await expect(modal).toHaveCount(0);
  await expect(editor).toContainText("edited in PsyNeuView, not saved");
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toHaveCount(0);
  // ...and does not touch the file, which still holds the external version.
  expect(readFileSync(model, "utf8")).toContain("extra_mech");

  // A second external save asks again, and this time we take the disk version.
  writeFileSync(model, `${EXTERNALLY_EDITED}\n# saved again from PyCharm\n`);
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("external-change-load-disk").click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(editor).not.toContainText("edited in PsyNeuView, not saved");
});
