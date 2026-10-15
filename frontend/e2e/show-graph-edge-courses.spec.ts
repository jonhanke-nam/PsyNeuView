import { mutatingTest as test, expect } from "./test-base";

/**
 * #23: in the "Like show_graph" layout, edges follow show_graph's own courses
 * (marked `pnv-edge-showgraph`), and a node moved by hand hands its edges back
 * to normal routing while the others keep theirs.
 */
test("Like show_graph draws edges along show_graph's courses until a node moves @ci", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText("Stroop — Basic", { exact: true }).first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });

  const curved = page.locator(".react-flow__edge path.pnv-edge-showgraph");
  const edges = page.locator(".react-flow__edge");
  await expect(curved).toHaveCount(0);

  await page.locator('select:has(option[value="showgraph"])').selectOption("showgraph");
  // Every Stroop projection is one show_graph draws.
  const total = await edges.count();
  expect(total).toBeGreaterThan(0);
  await expect(curved).toHaveCount(total, { timeout: 30000 });

  // Drag one input node aside: its one edge goes back to normal routing.
  const node = page.locator('.react-flow__node[data-id="color_input"]');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect(curved).toHaveCount(total - 1);

  // Any other layout clears the courses.
  await page.locator('select:has(option[value="showgraph"])').selectOption("layered");
  await expect(curved).toHaveCount(0);
});
