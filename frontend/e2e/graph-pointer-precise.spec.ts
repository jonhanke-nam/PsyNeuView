/**
 * The crosshair and the circle pointers in the graph view (#40).
 *
 * Picking either in Settings ▸ Appearance ▸ Pointer puts our own image on the
 * pane, nodes and edges, with the hot spot exactly at its centre (half the
 * image's size, at every size), the system crosshair as the fallback, and a
 * heavier pressed look while the button is held over a node. The arrow and
 * the hand are covered by graph-pointer.spec.ts.
 *
 * Screenshots never show the OS pointer, so with PNV_SHOTS_DIR set the review
 * images draw the cursor's image at the mouse in a test-only overlay.
 */
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import { mkdirSync } from "fs";
import path from "path";

type Page = import("@playwright/test").Page;

const SHOTS_DIR = process.env.PNV_SHOTS_DIR;
const PRECISE_CURSOR = /^url\("data:image\/svg\+xml,([^"]+)"\) (\d+) (\d+), crosshair$/;

async function loadModel(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(fixturePath("two_mech_projection"));
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".react-flow__edge").first()).toBeVisible();
}

async function computedCursor(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).cursor);
}

function preciseOf(cursor: string): { svg: string; hotspot: [number, number] } | null {
  const m = cursor.match(PRECISE_CURSOR);
  return m ? { svg: decodeURIComponent(m[1]), hotspot: [Number(m[2]), Number(m[3])] } : null;
}

async function openAppearance(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("settings-content-appearance")).toBeVisible();
}

async function shotWithCursor(page: Page, name: string, cursor: string, at: { x: number; y: number }) {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  const hotspot = preciseOf(cursor)!.hotspot;
  await page.evaluate(
    ({ x, y, cursor, hotspot }) => {
      const src = cursor.match(/^url\("([^"]+)"\)/)![1];
      const overlay = document.createElement("div");
      overlay.id = "pnv-cursor-overlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
      const img = document.createElement("img");
      img.src = src;
      img.style.cssText = `position:absolute;left:${x - hotspot[0]}px;top:${y - hotspot[1]}px`;
      overlay.append(img);
      document.body.append(overlay);
    },
    { x: at.x, y: at.y, cursor, hotspot },
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
  await page.evaluate(() => document.getElementById("pnv-cursor-overlay")?.remove());
}

test.describe("the crosshair and circle pointers (#40)", { tag: "@ci" }, () => {
  for (const pointer of ["crosshair", "circle"] as const) {
    test(`${pointer}: chosen in Settings, centred hot spot on the pane, nodes and edges, pressed look over a node`, async ({ page }) => {
      await loadModel(page);
      await openAppearance(page);
      await page.getByTestId("setting-graph-pointer").selectOption(pointer);
      await expect(page.getByTestId("graph-pointer-preview-pressed")).toBeVisible();
      if (SHOTS_DIR) {
        mkdirSync(SHOTS_DIR, { recursive: true });
        await page.getByTestId("settings-content-appearance").screenshot({ path: path.join(SHOTS_DIR, `settings-preview-${pointer}.png`) });
      }
      // Large: the hot spot is half the 48 px image.
      await page.getByTestId("setting-graph-pointer-size").selectOption("large");
      await expect(page.getByTestId("graph-pointer-preview").locator("img").first()).toHaveAttribute("width", "48");
      if (SHOTS_DIR) {
        await page.getByTestId("settings-content-appearance").screenshot({ path: path.join(SHOTS_DIR, `settings-preview-${pointer}-large.png`) });
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("settings-panel")).toHaveCount(0);

      const pane = await computedCursor(page, ".react-flow__pane");
      const image = preciseOf(pane);
      expect(image, pane).not.toBeNull();
      expect(image!.svg).toContain('width="48" height="48"');
      expect(image!.hotspot).toEqual([24, 24]);
      expect(await computedCursor(page, ".react-flow__node")).toBe(pane);
      expect(await computedCursor(page, ".react-flow__edge")).toBe(pane);
      // A real control keeps its pointer.
      expect(await computedCursor(page, ".react-flow__controls-button")).toBe("pointer");

      // Medium: 24 px, hot spot 12 12.
      await openAppearance(page);
      await page.getByTestId("setting-graph-pointer-size").selectOption("medium");
      await page.keyboard.press("Escape");
      const medium = await computedCursor(page, ".react-flow__node");
      expect(preciseOf(medium)!.hotspot).toEqual([12, 12]);

      // Over a node, and the pressed look while the button is held.
      const box = (await page.locator(".react-flow__node").first().boundingBox())!;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(at.x, at.y);
      await shotWithCursor(page, `node-${pointer}`, medium, at);
      await page.mouse.down();
      const held = await computedCursor(page, ".react-flow__node");
      expect(preciseOf(held), held).not.toBeNull();
      expect(held).not.toBe(medium);
      expect(preciseOf(held)!.hotspot).toEqual([12, 12]);
      await shotWithCursor(page, `node-${pointer}-pressed`, held, at);
      await page.mouse.up();

      // Remembered per browser.
      await loadModel(page);
      expect(await computedCursor(page, ".react-flow__pane")).toBe(await computedCursor(page, ".react-flow__node"));
      expect(preciseOf(await computedCursor(page, ".react-flow__pane"))).not.toBeNull();
    });
  }
});
