/**
 * Save a copy as .py carries the layout and label files along (#1244).
 *
 * The copy used to be the `.py` alone: it opened with a default layout and no
 * labels, and its later layout changes went to files the original never used.
 * Now the copy gets copies of the original's layout, labels and index, named
 * to match, so it opens looking like the model it was copied from — and the
 * per-model lock does *not* come along: a copy starts unlocked, as documented.
 *
 * A file already at the destination gets the same question the `.py` gets:
 * the backend answers 409 naming the file, and the app asks before overwriting.
 */
import type { Page } from "@playwright/test";
import { mutatingTest as test, expect, canvasNode } from "./test-base";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

const STEM = "two_mech_projection";
const POSITIONS = { sender_mech: { x: 40, y: 60 }, receiver_mech: { x: 420, y: 60 } };
const LABELS = "sender_mech:\n  element_names: [first, second, third]\n";

/** A model of the user's with visible sidecars beside it, and locked. */
function originalModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "savecopy1244-"));
  const model = path.join(dir, `${STEM}.py`);
  copyFileSync(fixturePath(STEM), model);
  writeFileSync(
    path.join(dir, `${STEM}.pnlview.json`),
    JSON.stringify({ version: 1, positions: POSITIONS, editLock: "viewOnly" }, null, 2) + "\n",
  );
  writeFileSync(path.join(dir, `${STEM}.labels.yaml`), LABELS);
  return model;
}

/** A sidecar of `model`, wherever the placement rules put it. */
function sidecarOf(model: string, suffix: string): string | null {
  const dir = path.dirname(model);
  const name = path.basename(model, ".py") + suffix;
  for (const candidate of [path.join(dir, name), path.join(dir, ".psyneuview", name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function openModel(page: Page, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(canvasNode(page, "sender_mech").first()).toBeVisible({ timeout: 60_000 });
}

/** Where React Flow put the node: the layout, as rendered. */
const placement = (page: Page, name: string) =>
  canvasNode(page, name).first().evaluate((el) => (el as HTMLElement).style.transform);

async function saveCopyAs(page: Page, name: string) {
  await page.getByRole("button", { name: /Save a copy as/ }).click();
  const nameInput = page.locator('input[placeholder="my_model.py"]');
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await nameInput.fill(name);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/models/save-as") && r.request().method() === "POST",
      { timeout: 60_000 },
    ),
    nameInput.press("Enter"),
  ]);
  return resp;
}

const lockTag = (page: Page) => page.getByTestId("edit-mode-badge");

test("the copy gets the layout and labels, named to match, and starts unlocked (#1244)", async ({ page }) => {
  test.setTimeout(180_000);
  const original = originalModel();
  await openModel(page, original);

  // The original, as opened: its layout applied, and locked.
  await expect(lockTag(page)).toHaveText("view only", { timeout: 15_000 });
  const senderBefore = await placement(page, "sender_mech");
  const receiverBefore = await placement(page, "receiver_mech");
  expect(senderBefore).toContain("translate(40px, 60px)");

  const name = `copy_of_two_mech_${Date.now()}.py`;
  const resp = await saveCopyAs(page, name);
  expect(resp.ok(), `save-as failed: ${resp.status()}`).toBe(true);
  const copy: string = (await resp.json()).file_path;
  expect(path.basename(copy)).toBe(name);
  expect(path.dirname(copy)).not.toBe(path.dirname(original));

  // On disk: a layout and labels file for the copy, by the copy's name.
  const layoutFile = sidecarOf(copy, ".pnlview.json");
  expect(layoutFile, "the copy has no layout file").not.toBeNull();
  const layout = JSON.parse(readFileSync(layoutFile!, "utf8"));
  expect(layout.positions).toEqual(POSITIONS);
  expect(layout.editLock, "the lock must not carry over to a copy").toBeUndefined();
  const labelsFile = sidecarOf(copy, ".labels.yaml");
  expect(labelsFile, "the copy has no labels file").not.toBeNull();
  expect(readFileSync(labelsFile!, "utf8")).toBe(LABELS);

  // The original's files are untouched — and still locked.
  const originalLayout = JSON.parse(readFileSync(sidecarOf(original, ".pnlview.json")!, "utf8"));
  expect(originalLayout.editLock).toBe("viewOnly");

  // On screen: the copy is now the open file, laid out like the original,
  // and not locked.
  await expect(page.getByText(`Saved as ${name}`)).toBeVisible({ timeout: 15_000 });
  await expect(canvasNode(page, "sender_mech").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => placement(page, "sender_mech"), { timeout: 15_000 }).toBe(senderBefore);
  expect(await placement(page, "receiver_mech")).toBe(receiverBefore);
  await expect(lockTag(page)).toHaveCount(0);

  // A later layout change goes to the copy's file, not the original's.
  const originalBytes = readFileSync(sidecarOf(original, ".pnlview.json")!, "utf8");
  const save = await page.request.post("/api/model/save-layout", {
    data: { file_path: copy, positions: { ...POSITIONS, sender_mech: { x: 1, y: 2 } } },
  });
  expect(save.ok()).toBe(true);
  expect(JSON.parse(readFileSync(layoutFile!, "utf8")).positions.sender_mech).toEqual({ x: 1, y: 2 });
  expect(readFileSync(sidecarOf(original, ".pnlview.json")!, "utf8")).toBe(originalBytes);
});

test("a layout file already at the destination gets the same overwrite question as the .py (#1244)", async ({ page }) => {
  test.setTimeout(180_000);
  const original = originalModel();
  await openModel(page, original);

  const name = `copy_twice_${Date.now()}.py`;
  const first = await saveCopyAs(page, name);
  expect(first.ok()).toBe(true);
  const copy: string = (await first.json()).file_path;
  const layoutFile = sidecarOf(copy, ".pnlview.json")!;
  expect(layoutFile).not.toBeNull();

  // Back to the original, which the copy was made from, then copy again
  // under the same name: the .py *and* its files are already there.
  await openModel(page, original);
  const questions: string[] = [];
  page.on("dialog", (d) => {
    questions.push(d.message());
    void d.accept();
  });
  const again = await saveCopyAs(page, name);
  // The first answer is the refusal; accepting the question sends the
  // overwrite, which is what lands.
  expect(again.status()).toBe(409);
  const detail = (await again.json()).detail as string;
  expect(detail).toContain(name);
  expect(detail).toContain(path.basename(layoutFile));
  expect(detail).toContain(path.basename(copy, ".py") + ".labels.yaml");
  await expect.poll(() => questions.length, { timeout: 15_000 }).toBe(1);
  expect(questions[0]).toContain(path.basename(layoutFile));
  await expect(page.getByText(`Saved as ${name}`)).toBeVisible({ timeout: 30_000 });
  expect(JSON.parse(readFileSync(layoutFile, "utf8")).positions).toEqual(POSITIONS);
});
