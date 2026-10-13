/**
 * Nested composition cluster frames — box-in-box (#718).
 *
 * In the flat view, each origin composition is drawn as a containment frame
 * (#713). For a model nested 2+ levels deep, the inner composition's frame must
 * sit *inside* its parent composition's frame. Uses the deep_nested fixture
 * (outer > mid > inner).
 */
import { readOnlyTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";

const inside = (child: any, frame: any, pad = 6) =>
  child.x >= frame.x - pad &&
  child.y >= frame.y - pad &&
  child.x + child.width <= frame.x + frame.width + pad &&
  child.y + child.height <= frame.y + frame.height + pad;

test.describe("nested cluster frames", { tag: "@ci" }, () => {
  test("inner composition frame sits inside its parent frame", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(fixturePath("deep_nested"));
    await prompt.press("Enter");
    await expect(page.getByText("deep_nested.py").first()).toBeVisible({ timeout: 30000 });

    const canvas = page.getByTestId("graph-canvas");

    // Flatten via the composition selector.
    const sel = page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
      .first();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/load") && r.request().method() === "POST"),
      sel.selectOption("__flat__"),
    ]);
    await expect(canvas.getByText("inner_a", { exact: true })).toBeVisible({ timeout: 15000 });
    await canvas.locator(".react-flow__controls-fitview").click().catch(() => {});
    await page.waitForTimeout(400);

    const midFrame = canvas.locator('.react-flow__node-compositionNode[data-id="cluster::mid"]');
    const innerFrame = canvas.locator(
      '.react-flow__node-compositionNode[data-id^="cluster::"][data-id*="inner"]',
    );

    await expect(midFrame).toBeVisible({ timeout: 10000 });
    await expect(innerFrame).toBeVisible();

    const mb = (await midFrame.boundingBox())!;
    const ib = (await innerFrame.boundingBox())!;
    expect(inside(ib, mb)).toBe(true);
  });
});
