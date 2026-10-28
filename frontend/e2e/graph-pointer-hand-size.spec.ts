/**
 * The sized hand, and the pointer over a control point (#40).
 *
 * Settings ▸ Appearance ▸ Pointer size covers the hand too: under "Hand" the
 * pane shows our own open hand at the chosen size (a different image per
 * size, the system grab hand as the fallback), and a drag in progress shows
 * the closed hand at that size — under the arrow as well. A control point
 * (an edge's bend handle) shows the arrow rather than the hand, even under
 * "Hand", and the crosshair under Crosshair. The arrow and the precise
 * pointers themselves are covered by graph-pointer.spec.ts and
 * graph-pointer-precise.spec.ts.
 *
 * Screenshots never show the OS pointer, so with PNV_SHOTS_DIR set the review
 * images draw the cursor's image at the mouse in a test-only overlay.
 */
import { mutatingTest as test, expect } from "./test-base";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A model with a saved layout, so its edges can be bent and show handles
// (the same one edge-bend-drag.spec.ts shapes).
const MODEL = path.resolve(__dirname, "..", "..", "backend", "reference_models", "stroop_reference_basic.py");

const SHOTS_DIR = process.env.PNV_SHOTS_DIR;
/** `cursor: url("data:image/svg+xml,…") X Y, fallback` → the pieces. */
const IMAGE_CURSOR = /^url\("data:image\/svg\+xml,([^"]+)"\) (\d+) (\d+), (\w+)$/;

function imageOf(cursor: string): { svg: string; hotspot: [number, number]; fallback: string } | null {
  const m = cursor.match(IMAGE_CURSOR);
  return m ? { svg: decodeURIComponent(m[1]), hotspot: [Number(m[2]), Number(m[3])], fallback: m[4] } : null;
}

async function loadModel(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".react-flow__edge").first()).toBeVisible();
}

async function computedCursor(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).cursor);
}

async function openAppearance(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("settings-content-appearance")).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
}

/** A point on the pane with nothing drawn under it. */
async function emptyPanePoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(".react-flow__pane").boundingBox();
  if (!box) throw new Error("no pane");
  const candidates = [
    { x: box.x + box.width - 80, y: box.y + box.height * 0.45 },
    { x: box.x + box.width - 40, y: box.y + box.height - 40 },
    { x: box.x + box.width - 40, y: box.y + 60 },
    { x: box.x + 40, y: box.y + 60 },
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

/** A point genuinely on an SVG path, in client coords (the hit path is `pointerEvents: stroke`). */
async function pointOnPath(locator: Locator) {
  return locator.evaluate((el) => {
    const p = el as unknown as SVGPathElement;
    const at = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f };
  });
}

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Bend the first edge (so it has a corner) and select it, so a bend handle shows. */
async function showBendHandle(page: Page): Promise<Locator> {
  const edge = page.locator('.react-flow__edge path[stroke="transparent"]').first();
  await expect(edge).toBeAttached({ timeout: 15000 });
  const from = await pointOnPath(edge);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (45 * i) / 8, from.y + (30 * i) / 8);
  await page.mouse.up();
  const onEdge = await pointOnPath(edge);
  await page.mouse.click(onEdge.x, onEdge.y);
  const handle = page.getByTestId("edge-bend-handle").first();
  await expect(handle, "no bend handle appeared on the selected edge").toBeVisible({ timeout: 10000 });
  return handle;
}

/**
 * Review screenshot: the cursor's image drawn where the mouse is, since the
 * OS pointer is never in a screenshot. Test-only; removed before returning.
 */
async function shotWithCursor(page: Page, name: string, cursor: string, at: { x: number; y: number }, caption: string) {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  const image = imageOf(cursor);
  if (!image) throw new Error(`not an image cursor: ${cursor}`);
  await page.evaluate(
    ({ x, y, cursor, hotspot, caption }) => {
      const src = cursor.match(/^url\("([^"]+)"\)/)![1];
      const overlay = document.createElement("div");
      overlay.id = "pnv-cursor-overlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
      const img = document.createElement("img");
      img.src = src;
      img.style.cssText = `position:absolute;left:${x - hotspot[0]}px;top:${y - hotspot[1]}px`;
      const note = document.createElement("div");
      note.style.cssText =
        "position:absolute;left:16px;bottom:16px;max-width:60%;font:12px/1.4 monospace;background:#fffbe6;" +
        "border:1px solid #e0c060;padding:6px 8px;border-radius:4px;overflow-wrap:anywhere";
      note.textContent = `[review overlay, not in the app] ${caption}`;
      overlay.append(img, note);
      document.body.append(overlay);
    },
    { x: at.x, y: at.y, cursor, hotspot: image.hotspot, caption },
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
  await page.evaluate(() => document.getElementById("pnv-cursor-overlay")?.remove());
}

test.describe("the sized hand and the pointer over a control point (#40)", { tag: "@ci" }, () => {
  test("Hand: Pointer size sizes the open hand and the closed hand of a drag; a bend handle shows the arrow", async ({ page }) => {
    await loadModel(page);
    await openAppearance(page);
    await page.getByTestId("setting-graph-pointer").selectOption("hand");
    // The preview shows the hand and its closed look.
    await expect(page.getByTestId("graph-pointer-preview-pressed")).toBeVisible();
    if (SHOTS_DIR) {
      mkdirSync(SHOTS_DIR, { recursive: true });
      await page.getByTestId("settings-content-appearance").screenshot({ path: path.join(SHOTS_DIR, "08-settings-preview-hand.png") });
    }
    await closeSettings(page);

    // Each size is a different hand image of that size, the system grab hand as the fallback.
    const pane = page.locator(".react-flow__pane");
    const seen = new Set<string>();
    const sizes = [
      ["small", 16],
      ["medium", 24],
      ["large", 48],
      ["xlarge", 96],
    ] as const;
    for (const [i, [size, px]] of sizes.entries()) {
      await openAppearance(page);
      await page.getByTestId("setting-graph-pointer-size").selectOption(size);
      await expect(page.getByTestId("graph-pointer-preview").locator("img").first()).toHaveAttribute("width", String(px));
      await closeSettings(page);
      const cursor = await computedCursor(pane);
      const hand = imageOf(cursor);
      expect(hand, cursor).not.toBeNull();
      expect(hand!.fallback).toBe("grab");
      expect(hand!.svg).toContain(`width="${px}" height="${px}"`);
      expect(hand!.hotspot).toEqual([px / 2, px / 2]);
      seen.add(cursor);
      // The hand over nodes and the edge's hit path too.
      expect(await computedCursor(page.locator(".react-flow__node").first())).toBe(cursor);
      expect(await computedCursor(page.locator(".projection-edge-hit").first())).toBe(cursor);
      const at = await emptyPanePoint(page);
      await page.mouse.move(at.x, at.y);
      await shotWithCursor(page, `0${i + 1}-hand-${size}`, cursor, at, `the hand at ${size} (${px} px), drawn at the mouse`);
    }
    expect(seen.size).toBe(sizes.length);

    // A drag in progress: the closed hand at the chosen size (Extra large now).
    const at = await emptyPanePoint(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await expect(pane).toHaveClass(/dragging/);
    for (let i = 1; i <= 5; i++) await page.mouse.move(at.x + i * 8, at.y - i * 4);
    const dragging = await computedCursor(pane);
    const closed = imageOf(dragging);
    expect(closed, dragging).not.toBeNull();
    expect(closed!.fallback).toBe("grabbing");
    expect(closed!.svg).toContain('width="96" height="96"');
    expect(dragging).not.toBe([...seen].at(-1));
    await shotWithCursor(page, "05-hand-xlarge-dragging", dragging, { x: at.x + 40, y: at.y - 20 }, "the closed hand while dragging the canvas, Extra large");
    await page.mouse.up();
    await expect(pane).not.toHaveClass(/dragging/);

    // A control point shows the arrow, not the hand, at the same size, and stays the arrow while held.
    await openAppearance(page);
    await page.getByTestId("setting-graph-pointer-size").selectOption("large");
    await closeSettings(page);
    const handle = await showBendHandle(page);
    const onHandle = await computedCursor(handle);
    const arrow = imageOf(onHandle);
    expect(arrow, onHandle).not.toBeNull();
    expect(arrow!.fallback).toBe("default");
    expect(arrow!.svg).toContain('width="48" height="48"');
    expect(arrow!.hotspot).toEqual([2, 2]);
    expect(onHandle).not.toBe(await computedCursor(pane));
    const handleAt = await centerOf(handle);
    await page.mouse.move(handleAt.x, handleAt.y);
    await shotWithCursor(page, "06-hand-large-over-bend-handle", onHandle, handleAt, "Pointer: Hand, Large — the arrow over a bend handle, drawn at the mouse");
    await page.mouse.down();
    expect(await computedCursor(handle)).toBe(onHandle);
    await page.mouse.up();
  });

  test("Arrow and Crosshair: the drag shows the sized closed hand; a bend handle shows the pointer itself", async ({ page }) => {
    await loadModel(page);
    // The default, the arrow at Medium: a drag shows the closed hand at 24 px, not the system's.
    const pane = page.locator(".react-flow__pane");
    const at = await emptyPanePoint(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await expect(pane).toHaveClass(/dragging/);
    const dragging = await computedCursor(pane);
    expect(imageOf(dragging)?.fallback, dragging).toBe("grabbing");
    expect(imageOf(dragging)!.svg).toContain('width="24" height="24"');
    await page.mouse.up();

    // Crosshair: over a bend handle, the crosshair (centred hot spot), heavier while held.
    await openAppearance(page);
    await page.getByTestId("setting-graph-pointer").selectOption("crosshair");
    await closeSettings(page);
    const handle = await showBendHandle(page);
    const onHandle = await computedCursor(handle);
    expect(imageOf(onHandle)?.fallback, onHandle).toBe("crosshair");
    expect(imageOf(onHandle)!.hotspot).toEqual([12, 12]);
    expect(onHandle).toBe(await computedCursor(pane));
    const handleAt = await centerOf(handle);
    await page.mouse.move(handleAt.x, handleAt.y);
    await shotWithCursor(page, "07-crosshair-over-bend-handle", onHandle, handleAt, "Pointer: Crosshair — over a bend handle, drawn at the mouse");
    await page.mouse.down();
    const held = await computedCursor(handle);
    expect(imageOf(held)?.fallback, held).toBe("crosshair");
    expect(held).not.toBe(onHandle);
    await page.mouse.up();
  });
});
