/**
 * Shaping a Smooth arrow with tangent handles (#39).
 *
 * A selected Smooth arrow shows a handle at each anchor, like a pen tool's.
 * Dragging one shapes the curve: one History step, saved with the layout, and
 * the same curve after the model is opened again.
 *
 * edge-shaping-auto-layout.spec.ts covers bends; this one covers handles.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

/** A private copy with no saved layout beside it. */
function scratchModel() {
  const dir = mkdtempSync(path.join(tmpdir(), "edge-curve-handles-39-"));
  const file = path.join(dir, "two_mech_projection.py");
  copyFileSync(fixturePath("two_mech_projection"), file);
  return file;
}

/** The model's layout file, beside it or in its hidden folder (#927), if written yet. */
function readLayout(model: string): Record<string, any> | null {
  const dir = path.dirname(model);
  for (const file of [
    path.join(dir, "two_mech_projection.pnlview.json"),
    path.join(dir, ".psyneuview", "two_mech_projection.pnlview.json"),
  ]) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  }
  return null;
}

async function openModel(page: Page, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node")).toHaveCount(2, { timeout: 60_000 });
}

const hitPath = (page: Page) => page.locator(".projection-edge-hit").first();
const drawnPath = (page: Page) => page.locator(".react-flow__edge path").first();
const handles = (page: Page) => page.getByTestId("edge-curve-handle");

/** A point on the middle of the arrow, in page coordinates. */
async function midpoint(page: Page) {
  return hitPath(page).evaluate((el) => {
    const p = el as unknown as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
  });
}

/** Number of cubic segments in a path. */
const cubics = (d: string | null) => (d?.match(/C/g) ?? []).length;

test("a selected Smooth arrow shows handles; dragging one shapes the curve, saved and one Undo (#39)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  const model = scratchModel();
  await openModel(page, model);
  await expect(drawnPath(page)).toHaveAttribute("d", /\S/);
  const before = await drawnPath(page).getAttribute("d");

  // Not selected: no handles. A click on the arrow selects it and shows one
  // handle at each end (no bends yet).
  await expect(handles(page)).toHaveCount(0);
  const at = await midpoint(page);
  await page.mouse.click(at.x, at.y);
  await expect(handles(page)).toHaveCount(2);
  const source = page.locator('[data-testid="edge-curve-handle"][data-anchor="0"]');
  await expect(source).toHaveAttribute("data-pinned", "false");

  // Drag the source's handle sideways: the curve bends towards it.
  const box = (await source.boundingBox())!;
  const [hx, hy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(hx + 12 * i, hy - 6 * i);
  await page.mouse.up();

  await expect(source).toHaveAttribute("data-pinned", "true");
  await expect.poll(() => drawnPath(page).getAttribute("d")).not.toBe(before);
  const shaped = await drawnPath(page).getAttribute("d");
  expect(cubics(shaped)).toBe(1);

  // One History step, named for the arrow.
  await expect(page.getByTestId("undo-button")).toHaveAttribute("title", /^Undo: Reshaped arrow .+ \(⌘Z\)$/);

  // Saved with the layout: the source's handle, and the tension it is drawn with.
  await expect
    .poll(() => Object.values(readLayout(model)?.edgeRoutes ?? {})[0] ?? null, { timeout: 10_000 })
    .toMatchObject({ handles: { s: { x: expect.any(Number), y: expect.any(Number) } }, tension: expect.any(Number) });

  // Undo puts the arrow back as it was; Redo shapes it again.
  await page.getByTestId("undo-button").click();
  await expect.poll(() => drawnPath(page).getAttribute("d")).toBe(before);
  await page.getByTestId("redo-button").click();
  await expect.poll(() => drawnPath(page).getAttribute("d")).toBe(shaped);
  await expect
    .poll(() => Object.keys(readLayout(model)?.edgeRoutes ?? {}).length, { timeout: 10_000 })
    .toBe(1);

  // Opened again, the arrow has the same curve.
  await openModel(page, model);
  await expect.poll(() => drawnPath(page).getAttribute("d")).toBe(shaped);
});
