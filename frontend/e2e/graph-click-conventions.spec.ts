/**
 * Clicks on the graph follow the macOS conventions (#261), and their
 * Windows/Linux counterparts. Each row of the table in
 * docs/ui-interaction-conventions.md ("Clicks on the graph") is a test here.
 *
 * Playwright's desktop Chrome reports Windows, so the Mac rows run with a
 * Macintosh user agent: the graph library picks Command or Ctrl from it.
 */
import { readOnlyTest as test, expect, closePalette, fitGraph } from "./test-base";

type Page = import("@playwright/test").Page;
type Mod = "Meta" | "Control" | "Shift";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function openStroop(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText("Stroop").first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await closePalette(page);
  await fitGraph(page);
  await page.waitForTimeout(500);
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const selected = (page: Page) =>
  page.locator(".react-flow__node.selected").evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.id).sort());
const pane = (page: Page) => page.locator(".react-flow__pane");
async function clear(page: Page) {
  await page.keyboard.press("Escape");
  await pane(page).click({ position: { x: 4, y: 4 } });
}

function conventions(platform: "mac" | "other", primary: Mod) {
  test.describe(`clicks on the graph, ${platform === "mac" ? "as a Mac" : "as Windows/Linux"} (#261)`, { tag: "@ci" }, () => {
    if (platform === "mac") test.use({ userAgent: MAC_UA });

    test("click selects one; Command/Ctrl-click and Shift-click add and take away", async ({ page }) => {
      await openStroop(page);
      await node(page, "word_hidden").click();
      expect(await selected(page)).toEqual(["word_hidden"]);
      await node(page, "color_hidden").click({ modifiers: [primary] });
      expect(await selected(page)).toEqual(["color_hidden", "word_hidden"]);
      await node(page, "color_hidden").click({ modifiers: [primary] });
      expect(await selected(page)).toEqual(["word_hidden"]);
      await node(page, "output").click({ modifiers: ["Shift"] });
      expect(await selected(page)).toEqual(["output", "word_hidden"]);
      await node(page, "word_hidden").click();
      expect(await selected(page)).toEqual(["word_hidden"]);
    });

    test("a secondary click on an unselected node selects it and shows its menu", async ({ page }) => {
      await openStroop(page);
      await node(page, "word_hidden").click();
      await node(page, "color_hidden").click({ button: "right" });
      await expect(page.getByTestId("node-context-menu")).toBeVisible();
      expect(await selected(page)).toEqual(["color_hidden"]);
      if (platform === "mac") {
        // Control-click is the same gesture as a right-click on a Mac.
        await clear(page);
        await node(page, "output").click({ modifiers: ["Control"] });
        await expect(page.getByTestId("node-context-menu")).toBeVisible();
        expect(await selected(page)).toEqual(["output"]);
        // macOS usually makes Control-click a secondary click itself; off a
        // real Mac (CI) it arrives as a click with Control held, and must
        // still open the menu.
        await clear(page);
        await expect(page.getByTestId("node-context-menu")).toHaveCount(0);
        await node(page, "decision").dispatchEvent("click", { ctrlKey: true, button: 0, bubbles: true });
        await expect(page.getByTestId("node-context-menu")).toBeVisible();
        expect(await selected(page)).toEqual(["decision"]);
      }
    });

    test("a secondary click inside a selection keeps the selection", async ({ page }) => {
      await openStroop(page);
      await node(page, "word_hidden").click();
      await node(page, "color_hidden").click({ modifiers: [primary] });
      await node(page, "color_hidden").click({ button: "right" });
      await expect(page.getByTestId("node-context-menu")).toBeVisible();
      expect(await selected(page)).toEqual(["color_hidden", "word_hidden"]);
    });

    test("an arrow has a menu: Select sender and Select receiver", async ({ page }) => {
      await openStroop(page);
      const edge = page.locator('.react-flow__edge[data-id*="color_hidden"][data-id*="output"], .react-flow__edge').first();
      const hit = (await edge.locator(".projection-edge-hit").first().boundingBox())!;
      const at = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
      await page.mouse.click(at.x, at.y, { button: "right" });
      await expect(page.getByTestId("edge-context-menu")).toBeVisible();
      await page.getByTestId("edge-menu-select-receiver").click();
      await expect(page.getByTestId("edge-context-menu")).toHaveCount(0);
      expect((await selected(page)).length).toBe(1);
      await page.mouse.click(at.x, at.y, { button: "right" });
      await page.getByTestId("edge-menu-select-sender").click();
      expect((await selected(page)).length).toBe(1);
    });

    test("the canvas has a menu: Select All, Fit, Components", async ({ page }) => {
      await openStroop(page);
      await pane(page).click({ button: "right", position: { x: 30, y: 30 } });
      await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
      await page.getByTestId("canvas-menu-select-all").click();
      expect((await selected(page)).length).toBe(7);
      await pane(page).click({ button: "right", position: { x: 30, y: 30 } });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("canvas-context-menu")).toHaveCount(0);
    });

    test("drag on the canvas pans; Shift-drag draws a selection box", async ({ page }) => {
      await openStroop(page);
      await clear(page);
      const viewport = page.locator(".react-flow__viewport");
      const before = await viewport.getAttribute("style");
      const box = (await pane(page).boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + box.height / 2 + 40, { steps: 6 });
      await page.mouse.up();
      expect(await viewport.getAttribute("style")).not.toBe(before);
      expect(await selected(page)).toEqual([]);

      await fitGraph(page);
      await page.keyboard.down("Shift");
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      expect((await selected(page)).length).toBe(7);
    });
  });
}

conventions("mac", "Meta");
// Off the Mac, Ctrl adds to the selection. A browser running on a Mac turns
// Ctrl-click into a secondary click whatever the page is told, so there the
// Windows/Linux rows check the same rule with Shift; CI runs on Linux, where
// Ctrl-click is genuine.
conventions("other", process.platform === "darwin" ? ("Shift" as Mod) : "Control");
