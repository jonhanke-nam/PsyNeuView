/**
 * Edge shaping must not pan the canvas (#975, #951, #957).
 *
 * Regression guard for the #968 regression: dragging an edge — or one of its
 * bend handles — moved the bend for a few pixels and then handed the gesture to
 * React Flow, which panned the whole view instead.
 *
 * Cause: the interactive surfaces carried `e.stopPropagation()` but not the
 * `nopan` class. React Flow pans via d3-zoom, which listens *natively* on the
 * pane and never observes React's synthetic propagation — so the drag worked
 * only until d3-zoom's own drag threshold tripped. `nopan` is the documented
 * opt-out, and the few-pixel delay is exactly that threshold.
 *
 * The assertion that matters is the viewport transform: if it changes during an
 * edge-shaping drag, the canvas stole the gesture and the feature is broken.
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "reference_models",
  "stroop_reference_basic.py",
);

async function openStroop(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await page
    .getByRole("button", { name: /^Skip$/ })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
}

/** The `transform` React Flow writes on the viewport — our pan/zoom fingerprint. */
async function viewportTransform(page: Page) {
  return page
    .locator(".react-flow__viewport")
    .evaluate((el) => (el as HTMLElement).style.transform);
}

/**
 * A point genuinely ON an SVG path, in client coords.
 *
 * The hit path is `pointerEvents: "stroke"`, and for a curved edge the centre of
 * its bounding box is usually nowhere near the stroke — pressing there hits the
 * canvas instead and the drag silently does nothing.
 */
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
  if (!box) throw new Error("drag target has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragFrom(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several small steps: one big jump can outrun the threshold this guards.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  }
  await page.mouse.up();
}

const hitPath = (page: Page) =>
  page.locator('.react-flow__edge path[stroke="transparent"]').first();

/**
 * The rendered edge geometry. Bend handles only exist while the edge is
 * selected or hovered, so after a drag they're gone — the durable evidence that
 * a bend was applied is the drawn path itself.
 */
const drawnPath = (page: Page) => page.locator(".react-flow__edge path").first();

test.describe("edge shaping does not pan the canvas (#975)", () => {
  test("dragging an unselected edge bends it and leaves the viewport put", async ({ page }) => {
    await openStroop(page);
    const edge = hitPath(page);
    await expect(edge).toBeAttached({ timeout: 15000 });

    const beforeView = await viewportTransform(page);
    const beforePath = await drawnPath(page).getAttribute("d");

    await dragFrom(page, await pointOnPath(edge), 45, 30);

    expect(
      await viewportTransform(page),
      "the canvas panned during an edge drag — the shaping gesture went to d3-zoom (#975)",
    ).toBe(beforeView);
    expect(
      await drawnPath(page).getAttribute("d"),
      "the edge geometry is unchanged — the drag never bent it (#951)",
    ).not.toBe(beforePath);
  });

  test("dragging a bend handle on a selected edge does not pan", async ({ page }) => {
    await openStroop(page);
    const edge = hitPath(page);
    await expect(edge).toBeAttached({ timeout: 15000 });

    // Give the edge a bend first: a straight edge with no obstacle detour has
    // no corners, so there would be no handles to grab. Then select it — a
    // press with no motion selects rather than bending — so the handles render.
    // The reported symptom was specifically worse with the edge selected, so
    // that is the state under test.
    await dragFrom(page, await pointOnPath(edge), 45, 30);
    const onEdge = await pointOnPath(edge);
    await page.mouse.click(onEdge.x, onEdge.y);

    const handle = page.getByTestId("edge-bend-handle").first();
    await expect(
      handle,
      "no bend handle appeared on the selected edge (#961/#965)",
    ).toBeVisible({ timeout: 10000 });

    const beforeView = await viewportTransform(page);
    const beforePath = await drawnPath(page).getAttribute("d");

    await dragFrom(page, await centerOf(handle), 40, -25);

    expect(
      await viewportTransform(page),
      "the canvas panned while dragging a bend handle — this is the #975 report",
    ).toBe(beforeView);
    expect(
      await drawnPath(page).getAttribute("d"),
      "the handle drag did not move the bend",
    ).not.toBe(beforePath);
  });
});
