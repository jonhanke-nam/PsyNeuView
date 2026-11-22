/**
 * A secondary click inside a multi-selection opens a menu about the whole
 * selection (#261): it names the count, deletes all of it in one step (one
 * Undo brings it back), and can narrow the selection to the clicked node.
 * Backspace (the Delete shortcut) deletes the whole selection too, so the menu is never the
 * only way. A single node's menu has Delete as well.
 */
import { readOnlyTest as test, expect, closePalette, fitGraph } from "./test-base";
import { copyFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;
const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(here, "../../backend/demos/feedforward_network.py");

async function openCopy(page: Page): Promise<string> {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "selmenu-")), "feedforward_network.py");
  copyFileSync(DEMO, file);
  page.on("dialog", (d) => void d.accept());
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node-mechanismNode")).toHaveCount(3, { timeout: 60_000 });
  await closePalette(page);
  await fitGraph(page);
  await page.waitForTimeout(400);
  return file;
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const selected = (page: Page) =>
  page.locator(".react-flow__node.selected").evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.id).sort());

async function selectHiddenAndOutput(page: Page) {
  await node(page, "hidden_layer").click();
  await node(page, "output_layer").click({ modifiers: ["Shift"] });
  expect(await selected(page)).toEqual(["hidden_layer", "output_layer"]);
}

test.describe("the menu for a multi-selection (#261)", { tag: "@ci" }, () => {
  test("names the count, and Select only narrows to the clicked node", async ({ page }) => {
    await openCopy(page);
    await selectHiddenAndOutput(page);
    await node(page, "hidden_layer").click({ button: "right" });
    await expect(page.getByTestId("node-menu-selection-count")).toHaveText("2 nodes selected");
    await expect(page.getByTestId("node-menu-delete")).toHaveText("Delete 2 nodes");
    await page.getByTestId("node-menu-select-only").click();
    expect(await selected(page)).toEqual(["hidden_layer"]);
  });

  test("Delete 2 nodes removes both in one step; one Undo brings both back", async ({ page }) => {
    const file = await openCopy(page);
    await selectHiddenAndOutput(page);
    await node(page, "output_layer").click({ button: "right" });
    await page.getByTestId("node-menu-delete").click();
    await expect(page.locator(".react-flow__node-mechanismNode")).toHaveCount(1, { timeout: 30_000 });
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/^hidden_layer = /m);
    expect(src).not.toMatch(/^output_layer = /m);

    await page.getByTestId("undo-button").click();
    await expect(page.locator(".react-flow__node-mechanismNode")).toHaveCount(3, { timeout: 30_000 });
  });

  test("the Delete shortcut (Backspace) deletes the whole selection", async ({ page }) => {
    await openCopy(page);
    await selectHiddenAndOutput(page);
    await page.keyboard.press("Backspace");
    await expect(page.locator(".react-flow__node-mechanismNode")).toHaveCount(1, { timeout: 30_000 });
  });

  test("a single node's menu has Delete", async ({ page }) => {
    await openCopy(page);
    await node(page, "hidden_layer").click({ button: "right" });
    await expect(page.getByTestId("node-menu-selection-count")).toHaveCount(0);
    await page.getByTestId("node-menu-delete").click();
    await expect(page.locator(".react-flow__node-mechanismNode")).toHaveCount(2, { timeout: 30_000 });
  });
});
