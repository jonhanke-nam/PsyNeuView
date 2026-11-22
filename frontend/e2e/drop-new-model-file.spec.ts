/**
 * Dropping a .py file the models folder has never seen (#227).
 *
 * The import writes the dropped file into the models folder, then opens it.
 * Writing over an existing file and creating a new one are different calls on
 * the server, and the new-file case used to fail with "Import failed: File not
 * found". This drops a file under a name made fresh for the run, so it is
 * always the new-file case, and then drops it again, the write-over case.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

/** Drag the file over the window, which raises the drop overlay, then let go in the middle. */
async function dropFile(page: Page, name: string, source: string) {
  const dt = await page.evaluateHandle(
    ([n, s]) => {
      const data = new DataTransfer();
      data.items.add(new File([s], n, { type: "text/x-python" }));
      return data;
    },
    [name, source] as const,
  );
  await page.getByTestId("app-toolbar").dispatchEvent("dragover", { dataTransfer: dt });
  await page.waitForFunction(() => {
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2) as HTMLElement | null;
    return hit !== null && hit.style.zIndex === "10000";
  });
  await page.evaluate((data) => {
    document
      .elementFromPoint(innerWidth / 2, innerHeight / 2)!
      .dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  }, dt);
}

test.describe("dropping a new .py file (#227)", { tag: "@ci" }, () => {
  test("a file whose name is not in the models folder is created there and opens", async ({ page }) => {
    const name = `dropped_new_${Date.now()}.py`;
    const source = readFileSync(fixturePath("two_mech_projection"), "utf8");
    const dirs = await (await page.request.get("/api/models/dirs")).json();
    const saved = path.join(dirs.default_save_dir, name);
    expect(existsSync(saved)).toBe(false);

    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });

    const failed = page.getByTestId("notification-message").filter({ hasText: "Import failed" });
    const node = page.getByTestId("graph-canvas").locator(".react-flow__node").first();

    await dropFile(page, name, source);
    await expect(page.getByTestId("model-name").getByTitle(new RegExp(name.replace(".", "\\.")))).toBeVisible({ timeout: 60_000 });
    await expect(node).toBeVisible({ timeout: 60_000 });
    await expect(failed).toHaveCount(0);
    expect(readFileSync(saved, "utf8")).toBe(source);

    // The same name again: now it is there, and is written over.
    const edited = `${source}\n# dropped again\n`;
    await dropFile(page, name, edited);
    await expect.poll(() => readFileSync(saved, "utf8"), { timeout: 30_000 }).toBe(edited);
    await expect(node).toBeVisible({ timeout: 60_000 });
    await expect(failed).toHaveCount(0);
  });
});
