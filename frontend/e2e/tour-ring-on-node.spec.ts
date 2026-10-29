/**
 * A walkthrough's ring goes round the node it points at.
 *
 * A side of the ring used to tuck inside the node wherever something else lay
 * just beyond it (#102's rule for panels): a line leaving the node, or the
 * panels below the canvas. The ring then cut through the oval. Only another
 * node keeps a side inside now.
 */
import { mutatingTest as test, expect } from "./test-base";

test.use({ viewport: { width: 1600, height: 1000 } });

test("the ring goes round a node with lines leaving it", { tag: "@ci" }, async ({ page }) => {
  await page.goto("/?tour=demo");
  const fit = page.getByTestId("tour-fit");
  const ring = page.getByTestId("tour-highlight");
  await expect(ring.or(fit).first()).toBeVisible({ timeout: 30000 });
  if (await fit.isVisible()) await fit.click();
  await expect(ring).toBeVisible({ timeout: 15000 });
  const node = page.locator('.react-flow__node[data-id^="color_hidden"]').first();

  const check = async (label: string) => {
    await page.waitForTimeout(500);
    const [r, n] = await Promise.all([ring.boundingBox(), node.boundingBox()]);
    const rc = { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 };
    const nc = { x: n!.x + n!.width / 2, y: n!.y + n!.height / 2 };
    expect(Math.abs(rc.x - nc.x), `${label}: ring centre x`).toBeLessThan(2);
    expect(Math.abs(rc.y - nc.y), `${label}: ring centre y`).toBeLessThan(2);
    expect(r!.width, `${label}: ring wider than node`).toBeGreaterThan(n!.width);
    expect(r!.height, `${label}: ring taller than node`).toBeGreaterThan(n!.height);
  };
  // color_hidden has lines leaving its top and bottom: the sides the ring
  // used to tuck inside the oval.
  await check("start");
  await page.locator(".react-flow__controls-zoomin").click();
  await check("zoomed");
});
