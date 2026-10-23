/**
 * Edges are shaped only in a custom layout (#41).
 *
 * With Layout: Auto, nodes can't be dragged, but dragging an edge still added
 * bends: a hand-shaped edge in a layout the app recomputes. Now an edge in
 * Auto can be selected, not shaped; switch to Custom and dragging bends it,
 * as before (edge-bend-drag.spec.ts covers that in depth).
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

/** A copy with no saved layout beside it, so it opens in Auto. */
function scratchModel() {
  const dir = mkdtempSync(path.join(tmpdir(), "edge-shaping-41-"));
  const file = path.join(dir, "two_mech_projection.py");
  copyFileSync(fixturePath("two_mech_projection"), file);
  return file;
}

async function openModel(page: Page, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

const hitPath = (page: Page) => page.locator(".projection-edge-hit").first();
const drawnPath = (page: Page) => page.locator(".react-flow__edge path").first();

/** Press on the middle of the edge's stroke and drag sideways. */
async function dragEdge(page: Page) {
  const at = await hitPath(page).evaluate((el) => {
    const p = el as unknown as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(at.x + 5 * i, at.y + 4 * i);
  await page.mouse.up();
}

test("an edge in Auto can be selected but not shaped; in Custom it bends", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  await openModel(page, scratchModel());
  const layout = page.getByRole("button", { name: /^Layout: (Auto|Custom)$/ });
  await expect(layout).toHaveText("Layout: Auto");

  // Auto: the edge says it can't be shaped, and a drag leaves it as it was.
  await expect(hitPath(page)).toHaveAttribute("data-shapeable", "false");
  await expect(hitPath(page).locator("title")).toContainText("Switch to Custom");
  const before = await drawnPath(page).getAttribute("d");
  await dragEdge(page);
  await expect(page.getByTestId("edge-bend-handle")).toHaveCount(0);
  expect(await drawnPath(page).getAttribute("d")).toBe(before);

  // Custom: the same drag bends it.
  await layout.click();
  await expect(layout).toHaveText("Layout: Custom");
  await expect(hitPath(page)).toHaveAttribute("data-shapeable", "true");
  const straight = await drawnPath(page).getAttribute("d");
  await dragEdge(page);
  await expect.poll(() => drawnPath(page).getAttribute("d")).not.toBe(straight);
});
