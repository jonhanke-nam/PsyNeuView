/**
 * Fit frames the edges' courses, not only the nodes (#52).
 *
 * In Like show_graph, EGO's STATE → LOSS for PREDICTION runs in a wide curve
 * round the left of the graph. React Flow's fitView frames nodes only, so that
 * curve ran off the canvas.
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(__dirname, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py");

// A wide canvas with the Components panel closed: the graph is fitted to its
// width, which is where the curve swings outside the nodes.
test.use({ viewport: { width: 2600, height: 1300 } });

test("after Fit, every edge lies inside the canvas (#52)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
  // Wait for show_graph's description, so its curves are what gets fitted
  // (until then the Layered layout stands in, with no wide curves).
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/model/show-graph") && r.ok(), { timeout: 60000 }),
    page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "Like show_graph" }) })
      .first()
      .selectOption({ label: "Like show_graph" }),
  ]);
  await expect(canvas.getByText("LOSS for PREDICTION")).toBeVisible();

  await page.getByText("Components", { exact: true }).locator("xpath=..").getByRole("button").last().click();
  await expect(page.getByText("Components", { exact: true })).toHaveCount(0);

  const pane = canvas.locator(".react-flow");
  const outside = async () => {
    const box = (await pane.boundingBox())!;
    const paths = await canvas.locator(".react-flow__edge-path").evaluateAll((ps) =>
      ps.map((p) => {
        const r = p.getBoundingClientRect();
        return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
      }),
    );
    return paths.filter(
      (r) => r.x0 < box.x - 1 || r.y0 < box.y - 1 || r.x1 > box.x + box.width + 1 || r.y1 > box.y + box.height + 1,
    ).length;
  };

  // The relayout lands a moment after the response; Fit after it settles.
  await page.waitForTimeout(1500);
  await canvas.locator(".react-flow__controls-fitview").click();
  await expect.poll(outside, { timeout: 5000 }).toBe(0);
});
