/**
 * The graph's menus stay inside the window (#109), as macOS menus do: one
 * opened near the bottom edge opens upward from the pointer, one near the
 * right edge opens to its left. A node's menu on the bottom row (where the
 * inputs sit) used to run off the window, its items out of reach.
 */
import { mutatingTest as test, expect, closePalette, fitGraph } from "./test-base";
import type { Locator, Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(here, "..", "..", "backend", "reference_models", "stroop_reference_basic.py");

async function openModel(page: Page) {
  // The graph alone, so the canvas reaches the window's bottom edge.
  await page.addInitScript(() => {
    localStorage.setItem("psyneuview_layout_code_visible", "false");
    localStorage.setItem("psyneuview_layout_bottom_visible", "false");
  });
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await closePalette(page);
  await fitGraph(page);
  await page.waitForTimeout(400);
}

async function expectInWindow(page: Page, menu: Locator, what: string) {
  await expect(menu, what).toBeVisible();
  const box = (await menu.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y, `${what}: top`).toBeGreaterThanOrEqual(0);
  expect(box.x, `${what}: left`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what}: bottom ${box.y + box.height} within ${vp.height}`).toBeLessThanOrEqual(vp.height);
  expect(box.x + box.width, `${what}: right ${box.x + box.width} within ${vp.width}`).toBeLessThanOrEqual(vp.width);
}

test.describe("the graph's menus stay inside the window (#109)", { tag: "@ci" }, () => {
  test("a node's menu near the bottom edge opens upward, every item in reach", async ({ page }) => {
    await openModel(page);
    // The lowest node on screen, right-clicked near its bottom edge.
    const boxes = await page.locator(".react-flow__node-mechanismNode").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect),
    );
    const low = boxes.reduce((a, b) => (b.bottom > a.bottom ? b : a));
    const vp = page.viewportSize()!;
    expect(vp.height - low.bottom, "the fitted graph's bottom row sits near the window's bottom").toBeLessThan(200);
    await page.mouse.click(low.x + low.width / 2, low.bottom - 4, { button: "right" });
    const menu = page.getByTestId("node-context-menu");
    await expectInWindow(page, menu, "the node's menu");
    // Opened upward: it ends at the pointer rather than starting there.
    expect((await menu.boundingBox())!.y).toBeLessThan(low.bottom - 4);
    await page.keyboard.press("Escape");
  });

  test("the canvas menu in the bottom-right corner opens up and to the left", async ({ page }) => {
    await openModel(page);
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const vp = page.viewportSize()!;
    const x = Math.min(pane.x + pane.width, vp.width) - 8;
    const y = Math.min(pane.y + pane.height, vp.height) - 8;
    await page.mouse.click(x, y, { button: "right" });
    const menu = page.getByTestId("canvas-context-menu");
    await expectInWindow(page, menu, "the canvas menu");
    const box = (await menu.boundingBox())!;
    expect(box.x + box.width, `right edge ${box.x + box.width}, pointer at ${x}`).toBeLessThanOrEqual(x + 1);
    expect(box.y + box.height, `bottom edge ${box.y + box.height}, pointer at ${y}`).toBeLessThanOrEqual(y + 1);
  });

  test("a menu with room opens at the pointer, as before", async ({ page }) => {
    await openModel(page);
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const x = pane.x + 40;
    const y = pane.y + 40;
    await page.mouse.click(x, y, { button: "right" });
    const box = (await page.getByTestId("canvas-context-menu").boundingBox())!;
    expect(Math.abs(box.x - x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - y)).toBeLessThanOrEqual(1);
  });
});
