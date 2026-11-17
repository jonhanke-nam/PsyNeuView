/**
 * Two windows on two models each notice their own model being edited
 * elsewhere, and one closing leaves the other watching (#272).
 *
 * The server had one watcher: each window's "watch this file" re-pointed it,
 * so only the window opened last was watched, and any window closing stopped
 * it for all. Found when an e2e waited for an outside edit while other test
 * pages, on the same server, opened and closed.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

function scratch(name: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "watch272-")), `${name}.py`);
  writeFileSync(file, readFileSync(fixturePath("two_mech_projection"), "utf8"));
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
  await expect(page.locator(".react-flow__node")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByText("Watching for changes")).toBeVisible({ timeout: 30_000 });
}

/** Another editor adds a third mechanism to the file. */
function editElsewhere(file: string, name: string) {
  const src = readFileSync(file, "utf8");
  const comp = src.match(/^(\w+)\s*=\s*pnl\.Composition\(/m)![1];
  writeFileSync(file, `${src}\n${name} = pnl.TransferMechanism(name='${name}')\n${comp}.add_node(${name})\n`);
}

test.describe("watching, with two windows open (#272)", { tag: "@ci" }, () => {
  test("each window hears its own model, and one closing leaves the other watching", async ({ page, context }) => {
    test.setTimeout(180_000);
    const first = scratch("first"), second = scratch("second");
    await open(page, first);
    const other = await context.newPage();
    await open(other, second);

    // The window opened first is still watched (it was re-pointed away).
    editElsewhere(first, "added_to_first");
    await expect(page.locator(".react-flow__node")).toHaveCount(3, { timeout: 30_000 });
    await expect(other.locator(".react-flow__node")).toHaveCount(2);

    // And the second hears its own.
    editElsewhere(second, "added_to_second");
    await expect(other.locator(".react-flow__node")).toHaveCount(3, { timeout: 30_000 });

    // One window closes: the other keeps watching (everyone's stopped).
    await other.close();
    editElsewhere(first, "added_again");
    await expect(page.locator(".react-flow__node")).toHaveCount(4, { timeout: 30_000 });
  });
});
