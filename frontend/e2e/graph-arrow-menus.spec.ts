/**
 * The rest of #261's menus: an arrow (a projection) can be renamed and
 * deleted from its menu, and a scheduling arrow's menu, opened from the
 * arrow or its label, edits or deletes its condition. Each also has another
 * route: the Inspector's name (double-click) and the Delete shortcut.
 */
import { readOnlyTest as test, expect, closePalette, fitGraph, showSchedulingArrows } from "./test-base";
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;
const here = path.dirname(fileURLToPath(import.meta.url));

async function openCopy(page: Page, source: string, name: string): Promise<string> {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "arrowmenu-")), name);
  copyFileSync(source, file);
  page.on("dialog", (d) => void d.accept());
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await closePalette(page);
  await fitGraph(page);
  await page.waitForTimeout(400);
  return file;
}
const feedforward = (page: Page) =>
  openCopy(page, path.resolve(here, "../../backend/demos/feedforward_network.py"), "feedforward_network.py");

async function rightClickArrow(page: Page, id: string) {
  const hit = (await page.locator(`.react-flow__edge[data-id*="${id}"] .projection-edge-hit`).first().boundingBox())!;
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2, { button: "right" });
  await expect(page.getByTestId("edge-context-menu")).toBeVisible();
}

test.describe("arrow menus (#261)", { tag: "@ci" }, () => {
  test("Rename… renames the projection in the file", async ({ page }) => {
    const file = await feedforward(page);
    await rightClickArrow(page, "input_to_hidden");
    await page.getByTestId("edge-menu-rename").click();
    await page.getByTestId("edge-menu-rename-input").fill("sensory_path");
    await page.getByTestId("edge-menu-rename-input").press("Enter");
    await expect(page.getByTestId("edge-context-menu")).toHaveCount(0);
    await expect.poll(() => readFileSync(file, "utf8")).toMatch(/^input_to_hidden = pnl\.MappingProjection\([\s\S]*?name='sensory_path'/m);
  });

  test("Delete removes the projection; the Delete shortcut does too", async ({ page }) => {
    const file = await feedforward(page);
    await rightClickArrow(page, "input_to_hidden");
    await page.getByTestId("edge-menu-delete").click();
    await expect.poll(() => readFileSync(file, "utf8")).not.toMatch(/^input_to_hidden = /m);

    // The other route: select the arrow, press the Delete shortcut.
    const hit = (await page.locator('.react-flow__edge[data-id*="hidden_to_output"] .projection-edge-hit').first().boundingBox())!;
    await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await page.keyboard.press("Backspace");
    await expect.poll(() => readFileSync(file, "utf8")).not.toMatch(/^hidden_to_output = /m);
  });

  test("the Inspector renames an arrow too (double-click its name)", async ({ page }) => {
    const file = await feedforward(page);
    const hit = (await page.locator('.react-flow__edge[data-id*="input_to_hidden"] .projection-edge-hit').first().boundingBox())!;
    await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
    const name = page.getByTitle("Double-click to rename").first();
    await name.dblclick();
    const input = page.locator("input:focus");
    await input.fill("sensory_path");
    await input.press("Enter");
    await expect.poll(() => readFileSync(file, "utf8")).toMatch(/name='sensory_path'/);
  });

  test("a scheduling arrow's label opens its menu: Edit condition, Delete", async ({ page }) => {
    await showSchedulingArrows(page);
    const src = path.join(mkdtempSync(path.join(tmpdir(), "gsc-")), "gsc_afternodes.py");
    writeFileSync(src, readFileSync(fixturePath("gsc_afternodes"), "utf8"));
    const file = await openCopy(page, src, "gsc_afternodes.py");
    const badge = page.getByTestId("gsc-edge-badge").first();
    await expect(badge).toBeVisible({ timeout: 30_000 });

    await badge.click({ button: "right" });
    await expect(page.getByTestId("edge-context-menu")).toBeVisible();
    await page.getByTestId("edge-menu-edit-condition").click();
    await expect(page.getByTestId("gsc-edge-badge").first()).toHaveAttribute("data-selected", "true");

    await badge.click({ button: "right" });
    await page.getByTestId("edge-menu-delete").click();
    await expect.poll(() => readFileSync(file, "utf8")).not.toMatch(/AfterNodes\(A, B, C\)/);
  });
});
