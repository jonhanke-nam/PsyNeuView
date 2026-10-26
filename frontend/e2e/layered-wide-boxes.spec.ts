/**
 * The Layered layout doesn't overlap boxes wider than it assumes (#72).
 *
 * EGO's EM members have long names, so their boxes are up to 320px wide, and
 * Layered spaced them as 180px boxes. A model opened while Layered is picked
 * is laid out before it is drawn; once drawn, it is laid out again.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");

async function openModel(page: Page, model: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(BACKEND_DIR, model));
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/model/load") && (r.request().postData() ?? "").includes(path.basename(model)),
      { timeout: 60000 },
    ),
    prompt.press("Enter"),
  ]);
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
}

/** Pairs of node boxes that overlap, once the canvas has stopped moving. */
async function overlaps(page: Page): Promise<string[]> {
  const nodes = page.getByTestId("graph-canvas").locator(".react-flow__node-mechanismNode");
  const read = () =>
    nodes.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute("data-id") ?? "", x: r.left, y: r.top, w: r.width, h: r.height };
      }),
    );
  let boxes = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const now = await read();
    if (JSON.stringify(now) === JSON.stringify(boxes)) break;
    boxes = now;
  }
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) {
        found.push(`${a.id} / ${b.id}`);
      }
    }
  }
  return found;
}

test("Layered doesn't overlap EGO's wide boxes, opened fresh or reloaded", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await closePalette(page);
  await openModel(page, "demos/simple_stroop.py");
  await page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Like show_graph" }) })
    .first()
    .selectOption("layered");

  // Opened while Layered is picked: laid out before its boxes are drawn.
  await openModel(page, "reference_models/Giallanza2024_ego_study2.py");
  expect(await overlaps(page), "opened fresh").toEqual([]);

  // Reloaded with Learning shown: laid out with the boxes already drawn.
  await page.getByTestId("graph-more-button").click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60000 }),
    page.getByTestId("graph-more-menu").getByRole("button").filter({ hasText: /^Learning/ }).click(),
  ]);
  await page.keyboard.press("Escape");
  expect(await overlaps(page), "reloaded with Learning shown").toEqual([]);
});
