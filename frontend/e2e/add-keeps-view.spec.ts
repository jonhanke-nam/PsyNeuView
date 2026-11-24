/**
 * Adding a component keeps the view still (#346).
 *
 * The canvas used to fit the whole graph after every change to its nodes, so
 * a component put down where the user clicked was drawn, then everything
 * zoomed and shifted and it seemed to land in the wrong place. Adding, moving
 * and deleting a node now leave the zoom and pan alone; Fit is separate.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

/** The canvas's pan and zoom, from React Flow's viewport transform. */
async function viewport(page: Page) {
  return page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".react-flow__viewport")!).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
}

test.describe("adding a component keeps the view still (#346)", { tag: "@ci" }, () => {
  test("the zoom and pan don't change, and the node is put down at the click", async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "keepview346-"));
    const file = path.join(dir, "stroop_basic.py");
    writeFileSync(file, readFileSync(path.resolve(import.meta.dirname, "../../backend/demos/stroop_basic.py"), "utf8"));

    await page.goto("/");
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(file);
    await prompt.press("Enter");
    await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
    // Let the opening fit and the Layered layout's second pass settle.
    await page.waitForTimeout(2500);

    await page.getByPlaceholder("Search components…").fill("ProcessingMechanism");
    const pick = page.locator('[data-testid="palette-item"][data-type="ProcessingMechanism"]').first();
    await expect(pick).toBeVisible();
    await pick.click();

    const before = await viewport(page);
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const at = { x: pane.x + pane.width * 0.15, y: pane.y + pane.height * 0.5 };
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
    await page.mouse.click(at.x, at.y);
    await done;

    const fresh = page.locator('.react-flow__node[data-id^="New_ProcessingMechanism"]').first();
    await expect(fresh).toBeVisible({ timeout: 30_000 });
    // Long enough for the old fit-after-every-change to have run.
    await page.waitForTimeout(1500);

    const after = await viewport(page);
    expect(after.zoom).toBeCloseTo(before.zoom, 4);
    expect(Math.abs(after.x - before.x), JSON.stringify({ before, after })).toBeLessThan(1);
    expect(Math.abs(after.y - before.y), JSON.stringify({ before, after })).toBeLessThan(1);

    // A node is put down with its top-left corner at the click (#252), so
    // that corner is where the click was, not somewhere the view moved it.
    const box = (await fresh.boundingBox())!;
    const corner = { x: box.x, y: box.y };
    expect(Math.hypot(corner.x - at.x, corner.y - at.y), JSON.stringify({ corner, at })).toBeLessThan(8);
  });
});
