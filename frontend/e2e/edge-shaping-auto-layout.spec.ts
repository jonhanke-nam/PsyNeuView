/**
 * Shaping an arrow in Layout: Auto (#41, #164).
 *
 * Shaping belongs to a custom layout (#41). Since #164 a drag on an arrow in
 * Auto no longer pans: the layout becomes Custom where it stands, as it is on
 * screen, and the arrow is shaped. No node moves.
 *
 * The reshape is saved to the model's layout file on its own (no node move
 * needed), under the nested view's key, and is one named History step: Undo
 * puts the arrow back, in the file too, and the layout back to Auto; Redo
 * bends it again, in Custom.
 *
 * edge-bend-drag.spec.ts covers bending in depth; arrow-drag-keeps-layout
 * covers the arrow's ends and reloads.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

/**
 * A private copy with no saved layout beside it, so it opens in Auto and the
 * layout file the test reads is its own.
 */
function scratchModel() {
  const dir = mkdtempSync(path.join(tmpdir(), "edge-shaping-164-"));
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
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node")).toHaveCount(2, { timeout: 60_000 });
}

const hitPath = (page: Page) => page.locator(".projection-edge-hit").first();
const drawnPath = (page: Page) => page.locator(".react-flow__edge path").first();

/** Every node's place in the graph's own coordinates, and the canvas pan and zoom. */
async function placement(page: Page): Promise<{ nodes: Record<string, string>; viewport: string }> {
  return page.evaluate(() => {
    const nodes: Record<string, string> = {};
    document.querySelectorAll<HTMLElement>(".react-flow__node").forEach((el) => {
      nodes[el.dataset.id ?? ""] = el.style.transform;
    });
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "";
    return { nodes, viewport };
  });
}

/** Wait for the layout to settle (boxes measured, any refit done), then read it. */
async function settled(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await placement(page));
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [300, 300, 300, 500, 500, 1000] })
    .toBe(true);
  return JSON.parse(last) as Awaited<ReturnType<typeof placement>>;
}

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

/** The routes the layout file holds for the nested view, once it is written. */
const savedRoutes = (model: string) => () => readLayout(model)?.edgeRoutes ?? null;

test("a drag on an arrow in Auto makes the layout Custom and bends it; saved, and one Undo (#164)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  const model = scratchModel();
  await openModel(page, model);
  const layout = page.getByRole("button", { name: /^Layout: (Auto|Custom)$/ });
  await expect(layout).toHaveText("Layout: Auto");
  // The arrow says what a drag will do.
  await expect(hitPath(page).locator("title")).toContainText("the layout becomes Custom");
  const start = await settled(page);
  const straight = await drawnPath(page).getAttribute("d");
  expect(readLayout(model)).toBeNull();

  // Auto: the drag bends the arrow and makes the layout Custom. No node
  // moves, and the canvas does not pan.
  await dragEdge(page);
  await expect(layout).toHaveText("Layout: Custom");
  await expect.poll(() => drawnPath(page).getAttribute("d")).not.toBe(straight);
  const bent = await drawnPath(page).getAttribute("d");
  expect(await settled(page)).toEqual(start);

  // One History step, named for the arrow.
  await expect(page.getByTestId("undo-button")).toHaveAttribute("title", /^Undo: Reshaped arrow .+ \(⌘Z\)$/);

  // Saved on its own, under the nested view's key, with the nodes where they
  // are, so the model opens in this custom layout next time.
  await expect.poll(() => Object.keys(savedRoutes(model)() ?? {}).length, { timeout: 10_000 }).toBe(1);
  const route = Object.values(savedRoutes(model)()!)[0] as { waypoints?: unknown[] };
  expect(route.waypoints?.length).toBeGreaterThan(0);
  const saved = readLayout(model)!;
  expect(Object.keys(saved.positions ?? {}).sort()).toEqual(["receiver_mech", "sender_mech"]);
  expect(saved.flatEdgeRoutes).toBeUndefined();

  // Undo: the arrow's automatic route again, in the file too, and the layout
  // is Auto again, as it was. Nodes stay.
  await page.getByTestId("undo-button").click();
  await expect.poll(() => drawnPath(page).getAttribute("d")).toBe(straight);
  await expect(layout).toHaveText("Layout: Auto");
  await expect.poll(savedRoutes(model), { timeout: 10_000 }).toEqual({});
  expect((await settled(page)).nodes).toEqual(start.nodes);

  // Redo: bent again, and saved again.
  await page.getByTestId("redo-button").click();
  await expect.poll(() => drawnPath(page).getAttribute("d")).toBe(bent);
  await expect(layout).toHaveText("Layout: Custom");
  await expect.poll(() => Object.keys(savedRoutes(model)() ?? {}).length, { timeout: 10_000 }).toBe(1);

  // Opened again, the model is in Custom, with the arrow as shaped.
  await openModel(page, model);
  await expect(layout).toHaveText("Layout: Custom");
  await expect.poll(() => drawnPath(page).getAttribute("d")).toBe(bent);
});
