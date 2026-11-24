/**
 * When an edit made on the graph writes a line that doesn't run, the warning
 * names that edit ("Adding X broke the model at line N.") and offers Undo,
 * which puts the file back as it was (#353). It used to appear as an
 * unexplained failure, sometimes only after some later action (#349).
 *
 * The test hook: the add's request to the backend is given a parameter whose
 * value is an undefined name, so the line it writes fails to run.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

function scratchStroop(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "edit-broke-353-"));
  const file = path.join(dir, "stroop_basic.py");
  writeFileSync(file, readFileSync(path.resolve(import.meta.dirname, "../../backend/demos/stroop_basic.py"), "utf8"));
  return file;
}

async function open(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.react-flow__node[data-id="decision"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("palette-sidebar")).toBeVisible();
  await page.locator(".react-flow__controls-fitview").click();
}

test.describe("an edit that breaks the model is named, with Undo (#353)", { tag: "@ci" }, () => {
  test("adding a node that writes a failing line: the warning names the add; Undo restores the file", async ({ page }) => {
    const file = scratchStroop();
    const original = readFileSync(file, "utf8");
    await page.route("**/api/model/structural-change", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.changes?.action === "add_node") {
        body.changes.params = { ...(body.changes.params ?? {}), gain: "undefined_name_353" };
      }
      await route.continue({ postData: JSON.stringify(body) });
    });
    await open(page, file);

    // Pick up a TransferMechanism and put it down on empty canvas.
    await page.getByPlaceholder("Search components…").fill("TransferMechanism");
    await page.locator('[data-testid="palette-item"][data-type="TransferMechanism"]').first().click();
    await expect(page.getByTestId("place-component-hint")).toBeVisible();
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    await page.mouse.click(pane.x + pane.width * 0.95, pane.y + pane.height * 0.5);

    // The warning names the add and the line, which is one the add wrote.
    const warning = page.getByTestId("notification-message").filter({ hasText: "broke the model at line" });
    await expect(warning).toBeVisible({ timeout: 30_000 });
    const text = (await warning.textContent()) ?? "";
    const m = text.match(/^Adding (\w+) broke the model at line (\d+)\.$/);
    expect(m, text).not.toBeNull();
    const [, name, line] = m!;
    const broken = readFileSync(file, "utf8");
    expect(broken).toContain(`${name} = pnl.TransferMechanism(`);
    const declared = broken.split("\n").findIndex((l) => l.startsWith(`${name} = pnl.TransferMechanism(`)) + 1;
    expect(Number(line)).toBeGreaterThanOrEqual(declared);
    expect(Number(line)).toBeLessThanOrEqual(declared + 4);
    // Not reported as done.
    await expect(page.getByTestId("notification-message").filter({ hasText: `Added TransferMechanism "${name}"` })).toHaveCount(0);

    // Undo puts the file back, and the warning goes.
    await page.getByTestId("graph-edit-undo").click();
    await expect.poll(() => readFileSync(file, "utf8")).toBe(original);
    await expect(warning).toHaveCount(0);
    await expect(page.locator(".cm-content")).not.toContainText(name);
  });
});
