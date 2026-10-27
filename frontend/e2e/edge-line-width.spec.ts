/**
 * The lines between nodes have a width in Settings ▸ Appearance ▸ Lines
 * between nodes (#107). An ordinary (Mapping) line is drawn at exactly the
 * chosen width, its arrowhead scales with it, and the choice is remembered.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const STROOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backend/reference_models/stroop_reference_basic.py");

/** The first drawn projection line's stroke width, and its arrowhead's length. */
async function firstEdge(page: Page): Promise<{ stroke: number; headLength: number }> {
  return page.locator(".react-flow__edge").first().evaluate((g) => {
    const line = g.querySelector<SVGPathElement>("path.react-flow__edge-path")!;
    const head = g.querySelector<SVGPolygonElement>('[data-testid="edge-arrowhead"]')!;
    const xs = Array.from(head.points).map((p) => p.x);
    return {
      stroke: parseFloat(getComputedStyle(line).strokeWidth),
      headLength: Math.max(...xs) - Math.min(...xs),
    };
  });
}

test("lines between nodes: a width in Settings, arrowheads follow, remembered", { tag: "@ci" }, async ({ page }) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "edges107-"));
  const model = path.join(dir, "stroop.py");
  copyFileSync(STROOP, model);

  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__edge").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid="edge-arrowhead"]').first()).toBeAttached();

  // The default: 3 px, the width lines were drawn at before the setting.
  const before = await firstEdge(page);
  expect(before.stroke).toBe(3);
  if (process.env.EDGE107_SHOTS) await page.screenshot({ path: path.join(process.env.EDGE107_SHOTS, "stroop-default-3px.png") });

  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-edge-line-width")).toHaveValue("3");
  await page.getByTestId("setting-edge-line-width").selectOption("4");
  await page.keyboard.press("Escape");

  // The canvas follows without a reload; the arrowhead grows in proportion.
  await expect.poll(async () => (await firstEdge(page)).stroke).toBe(4);
  const after = await firstEdge(page);
  expect(after.headLength / before.headLength).toBeCloseTo(4 / 3, 2);
  if (process.env.EDGE107_SHOTS) await page.screenshot({ path: path.join(process.env.EDGE107_SHOTS, "stroop-4px.png") });

  // Remembered across a reload.
  await page.reload();
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-edge-line-width")).toHaveValue("4");
});
