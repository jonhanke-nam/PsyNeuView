/**
 * Spacing between nodes (#278): Settings ▸ Appearance ▸ Automatic layout.
 * Compact draws a Layered layout's rows closer than Roomy, and is Layered's
 * default; Like show_graph keeps show_graph's own spacing by default; no
 * spacing makes nodes overlap.
 */
import { readOnlyTest as test, expect, closePalette } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";
import { copyFileSync } from "fs";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;
const here = path.dirname(fileURLToPath(import.meta.url));
const FEEDFORWARD = path.resolve(here, "../../backend/demos/feedforward_network.py");

/** A copy with no saved layout of its own, so the automatic layout applies. */
function freshCopy(): string {
  const file = test.info().outputPath("feedforward_network.py");
  copyFileSync(FEEDFORWARD, file);
  return file;
}

async function openPath(page: Page, file: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await closePalette(page);
}

/** Node positions in flow coordinates (unaffected by zoom), by id. */
async function positions(page: Page) {
  return page.locator(".react-flow__node").evaluateAll((ns) =>
    Object.fromEntries(
      ns.map((n) => {
        const m = (n as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!;
        const r = n.getBoundingClientRect();
        return [(n as HTMLElement).dataset.id!, { x: +m[1], y: +m[2], w: r.width, h: r.height }];
      }),
    ),
  );
}

async function setSpacing(page: Page, value: string) {
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-graph-layout-spacing").selectOption(value);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  await page.waitForTimeout(400);
}

const height = (p: Record<string, { y: number }>) => {
  const ys = Object.values(p).map((v) => v.y);
  return Math.max(...ys) - Math.min(...ys);
};

/** The flow-coordinate boxes of mechanism nodes; none may overlap. */
async function expectNoOverlap(page: Page) {
  const boxes = await page.locator(".react-flow__node-mechanismNode").evaluateAll((ns) => ns.map((n) => {
    const r = n.getBoundingClientRect();
    return { id: (n as HTMLElement).dataset.id!, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  for (const a of boxes) for (const b of boxes) {
    if (a.id >= b.id) continue;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
  }
}

test.describe("Spacing between nodes (#278)", { tag: "@ci" }, () => {
  test("Layered: Compact by default, closer than Roomy, and nothing overlaps", async ({ page }) => {
    await openPath(page, freshCopy());
    await expect(page.locator('select:has(option[value="layered"])')).toHaveValue("layered");
    await page.waitForTimeout(400);
    const byDefault = await positions(page);
    await expectNoOverlap(page);

    await setSpacing(page, "roomy");
    const roomy = await positions(page);
    expect(height(roomy)).toBeGreaterThan(height(byDefault) * 1.4);

    await setSpacing(page, "compact");
    expect(height(await positions(page))).toBeCloseTo(height(byDefault), 0);
    await expectNoOverlap(page);
  });

  test("Settings says what the default is", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-appearance").click();
    const setting = page.getByTestId("setting-graph-layout-spacing");
    await expect(setting).toHaveValue("default");
    await expect(setting.locator('option[value="default"]')).toContainText("Compact for Layered");
  });

  test("Like show_graph keeps show_graph's own spacing by default", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("psyneuview.graph.layoutDefault", "showgraph"));
    await openPath(page, freshCopy());
    await expect(page.locator(".react-flow__edge path.pnv-edge-showgraph").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);
    const byDefault = await positions(page);
    await setSpacing(page, "standard");
    expect(await positions(page)).toEqual(byDefault);
    await setSpacing(page, "roomy");
    expect(height(await positions(page))).toBeGreaterThan(height(byDefault));
  });

  test("a nested model, compact, has no overlapping nodes", async ({ page }) => {
    await openPath(page, fixturePath("deep_nested"));
    await page.waitForTimeout(400);
    await expectNoOverlap(page);
  });
});
