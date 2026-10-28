/**
 * Arrowheads sit at the end of each line by default, where it meets the
 * receiving node, as show_graph draws them (they used to sit mid-line).
 */
import { mutatingTest as test, expect } from "./test-base";

test("arrowheads point into the receiving node, at the end of each line", { tag: "@ci" }, async ({ page }) => {
  await page.goto("/?tour=orientation-window");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tour-dismiss").click();
  await expect(page.getByTestId("edge-arrowhead").first()).toBeVisible();
  const gaps = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="edge-arrowhead"]')).map((poly) => {
      const path = poly.parentElement!.querySelector('[data-testid="edge-measure-path"]') as SVGPathElement;
      const end = path.getPointAtLength(path.getTotalLength());
      const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(poly.getAttribute("transform") ?? "")!;
      return Math.hypot(Number(m[1]) - end.x, Number(m[2]) - end.y);
    }),
  );
  expect(gaps.length).toBeGreaterThan(3);
  for (const g of gaps) expect(g).toBeLessThan(1);
});
