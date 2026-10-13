/**
 * Flat view (#658 / #659 / #660).
 *
 * The Flatten toggle inlines nested compositions into one graph: descendant
 * mechanisms are hoisted to the top level with cross-boundary edges stitched to
 * their real endpoints. In Custom layout it preserves known positions and a
 * round-trip save doesn't clobber the other view's positions. Selecting a
 * hoisted node shows its origin composition in the inspector.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";

async function openNested(page: any, file = fixturePath("nested_minimal"), label = "nested_minimal.py") {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await expect(page.getByText(label).first()).toBeVisible({ timeout: 30000 });
}

// View modes live in the composition selector (#717).
function viewSelect(page: any) {
  return page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
    .first();
}
async function setFlatView(page: any) {
  await viewSelect(page).selectOption("__flat__");
}
async function setNestedView(page: any, label = "nested_minimal") {
  await viewSelect(page).selectOption({ label });
}

test.describe("flat view", { tag: "@ci" }, () => {
  test("flatten hoists nested mechanisms and restores", async ({ page }) => {
    await openNested(page);
    const canvas = page.getByTestId("graph-canvas");

    // Nested (default): inner_comp auto-collapses, hiding its children.
    await expect(canvas.getByText("inner_comp", { exact: true })).toBeVisible();
    await expect(canvas.getByText("inner_a", { exact: true })).toHaveCount(0);

    await setFlatView(page);
    // Flattened: the hoisted inner mechanisms are now visible. ("inner_comp"
    // still appears — it's the #713 cluster-frame label around them, no longer
    // a collapsed group node.)
    await expect(canvas.getByText("inner_a", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(canvas.getByText("inner_b", { exact: true })).toBeVisible();

    await setNestedView(page);
    await expect(canvas.getByText("inner_comp", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(canvas.getByText("inner_a", { exact: true })).toHaveCount(0);
  });

  test("inspector shows the origin composition for a hoisted node", async ({ page }) => {
    await openNested(page);
    const canvas = page.getByTestId("graph-canvas");
    await setFlatView(page);
    await expect(canvas.getByText("inner_a", { exact: true })).toBeVisible({ timeout: 15000 });

    await canvas.getByText("inner_a", { exact: true }).click();
    const provenance = page.getByTestId("flat-provenance");
    await expect(provenance).toBeVisible({ timeout: 10000 });
    await expect(provenance).toContainText("inner_comp");
  });

  // Custom-layout round-trip is covered by flat-layout-namespace.spec.ts (#719):
  // flat positions now live in their own sidecar namespace, so a flat-view save
  // no longer touches the nested `positions` map.
});
