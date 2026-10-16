/**
 * The pointer in the graph view (#1301).
 *
 * By default the canvas, nodes and edges show the arrow — our own image, its
 * hot spot on the tip, the system arrow as the fallback — and the grabbing
 * hand only while the canvas is being dragged. A real control (a React Flow
 * control button) keeps its pointer. Settings ▸ Appearance changes the size,
 * which changes the computed cursor, and "Hand" restores React Flow's grab
 * hand. The choice is remembered per browser.
 *
 * Screenshots never show the OS pointer, so with PNV_SHOTS_DIR set this spec
 * also saves review images with the cursor's own image drawn at the mouse
 * position in a test-only overlay (removed afterwards), beside the computed
 * `cursor` value.
 */
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import { mkdirSync } from "fs";
import path from "path";

type Page = import("@playwright/test").Page;

const SHOTS_DIR = process.env.PNV_SHOTS_DIR;

/** `cursor: url("data:image/svg+xml,…") X Y, default` → the pieces. */
const ARROW_CURSOR = /^url\("data:image\/svg\+xml,([^"]+)"\) (\d+) (\d+), default$/;

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

/** The arrow's SVG from a computed cursor, or null when it isn't our arrow. */
function arrowOf(cursor: string): { svg: string; hotspot: [number, number] } | null {
  const m = cursor.match(ARROW_CURSOR);
  return m ? { svg: decodeURIComponent(m[1]), hotspot: [Number(m[2]), Number(m[3])] } : null;
}

/** A point on the pane with nothing drawn under it. */
async function emptyPanePoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(".react-flow__pane").boundingBox();
  if (!box) throw new Error("no pane");
  // The right-hand middle first, where a large arrow has room to show in a
  // review screenshot; the corners after it. The zoom controls sit bottom-left.
  const candidates = [
    { x: box.x + box.width - 80, y: box.y + box.height * 0.45 },
    { x: box.x + 40, y: box.y + box.height - 40 },
    { x: box.x + box.width - 40, y: box.y + box.height - 40 },
    { x: box.x + 40, y: box.y + 60 },
    { x: box.x + box.width - 40, y: box.y + 60 },
  ];
  for (const p of candidates) {
    const onPane = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("react-flow__pane") ?? false,
      p,
    );
    if (onPane) return p;
  }
  throw new Error("no empty point on the pane");
}

async function openAppearance(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("settings-content-appearance")).toBeVisible();
}

/**
 * Review screenshot: the arrow's image drawn where the mouse is, since the
 * OS pointer is never in a screenshot. Test-only; removed before returning.
 */
async function shotWithCursor(page: Page, name: string, at: { x: number; y: number }) {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  const cursor = await computedCursor(page, ".react-flow__pane");
  const arrow = arrowOf(cursor);
  if (!arrow) throw new Error(`not the arrow: ${cursor}`);
  await page.evaluate(
    ({ x, y, cursor, hotspot }) => {
      const m = cursor.match(/^url\("([^"]+)"\)/);
      const overlay = document.createElement("div");
      overlay.id = "pnv-cursor-overlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
      const img = document.createElement("img");
      img.src = m![1];
      img.style.cssText = `position:absolute;left:${x - hotspot[0]}px;top:${y - hotspot[1]}px`;
      const note = document.createElement("div");
      note.style.cssText =
        "position:absolute;left:16px;bottom:16px;max-width:60%;font:12px/1.4 monospace;background:#fffbe6;" +
        "border:1px solid #e0c060;padding:6px 8px;border-radius:4px;overflow-wrap:anywhere";
      note.textContent =
        `[review overlay, not in the app] the pane's computed cursor, drawn at the mouse position: ` +
        cursor.replace(/url\("data:image\/svg\+xml,[^"]*"\)/, (u) => u.slice(0, 60) + "…\")");
      overlay.append(img, note);
      document.body.append(overlay);
    },
    { x: at.x, y: at.y, cursor, hotspot: arrow.hotspot },
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
  await page.evaluate(() => document.getElementById("pnv-cursor-overlay")?.remove());
}

test.describe("the pointer in the graph view (#1301)", { tag: "@ci" }, () => {
  test("the arrow by default over the pane, nodes and edges; grabbing only during a drag; controls keep their pointer", async ({ page }) => {
    await loadModel(page);

    // Medium by default: a 24 px image with the hot spot on its tip, then the system arrow.
    const pane = await computedCursor(page, ".react-flow__pane");
    const arrow = arrowOf(pane);
    expect(arrow, pane).not.toBeNull();
    expect(arrow!.svg).toContain('width="24" height="24"');
    expect(arrow!.hotspot).toEqual([1, 1]);

    // Nodes and edges, including the edge's own hit path, show the same arrow.
    expect(await computedCursor(page, ".react-flow__node")).toBe(pane);
    expect(await computedCursor(page, ".react-flow__edge")).toBe(pane);
    expect(await computedCursor(page, ".projection-edge-hit")).toBe(pane);

    // A real control keeps the pointer: React Flow's own zoom buttons.
    expect(await computedCursor(page, ".react-flow__controls-button")).toBe("pointer");

    // Press on empty canvas: the grabbing hand, for exactly as long as the
    // button is down.
    const at = await emptyPanePoint(page);
    await page.mouse.move(at.x, at.y);
    await shotWithCursor(page, "02-canvas-arrow-medium", at);
    await page.mouse.down();
    await expect(page.locator(".react-flow__pane")).toHaveClass(/dragging/);
    expect(await computedCursor(page, ".react-flow__pane")).toBe("grabbing");
    for (let i = 1; i <= 5; i++) await page.mouse.move(at.x + i * 8, at.y - i * 4);
    expect(await computedCursor(page, ".react-flow__pane")).toBe("grabbing");
    await page.mouse.up();
    await expect(page.locator(".react-flow__pane")).not.toHaveClass(/dragging/);
    expect(await computedCursor(page, ".react-flow__pane")).toBe(pane);
  });

  test("Settings ▸ Appearance: the size changes the cursor, Hand restores the grab hand, both remembered", async ({ page }) => {
    await loadModel(page);
    const medium = await computedCursor(page, ".react-flow__pane");

    await openAppearance(page);
    const size = page.getByTestId("setting-graph-pointer-size");
    await expect(size).toHaveValue("medium");
    await expect(page.getByTestId("setting-graph-pointer")).toHaveValue("arrow");
    if (SHOTS_DIR) {
      mkdirSync(SHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS_DIR, "01-settings-appearance.png") });
    }

    await size.selectOption("xlarge");
    // The preview follows the choice.
    await expect(page.getByTestId("graph-pointer-preview").locator("img")).toHaveAttribute("width", "96");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);

    const xlarge = await computedCursor(page, ".react-flow__pane");
    expect(xlarge).not.toBe(medium);
    const arrow = arrowOf(xlarge);
    expect(arrow, xlarge).not.toBeNull();
    expect(arrow!.svg).toContain('width="96" height="96"');
    expect(arrow!.hotspot).toEqual([4, 4]);
    expect(await computedCursor(page, ".react-flow__node")).toBe(xlarge);
    const at = await emptyPanePoint(page);
    await page.mouse.move(at.x, at.y);
    await shotWithCursor(page, "03-canvas-arrow-extra-large", at);

    // Remembered per browser: a fresh page (and a model opened again, since a
    // reload doesn't reopen one) shows the same cursor.
    await loadModel(page);
    expect(await computedCursor(page, ".react-flow__pane")).toBe(xlarge);

    // Hand: React Flow's own cursors, grab on the pane. The model is in Auto,
    // where an edge can be selected but not shaped (#41): a pointer, not a hand.
    await openAppearance(page);
    await page.getByTestId("setting-graph-pointer").selectOption("hand");
    await page.keyboard.press("Escape");
    expect(await computedCursor(page, ".react-flow__pane")).toBe("grab");
    expect(await computedCursor(page, ".projection-edge-hit")).toBe("pointer");
    await loadModel(page);
    expect(await computedCursor(page, ".react-flow__pane")).toBe("grab");
  });
});
