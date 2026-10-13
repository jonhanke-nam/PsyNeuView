/**
 * Modulatory projections to parameter ports render as edges (#616).
 *
 * Loads the stroop_with_lc reference model, whose LCControlMechanism
 * modulates the `gain` parameter of color_hidden / word_hidden via
 * `modulated_mechanisms=[...]` (added with add_node, so comp.controller is
 * None and the edges flow through the generic projection path). React Flow
 * only emits an edge into the DOM when BOTH endpoints resolve to real
 * <Handle>s — so before the fix (parameter ports were visual-only divs) these
 * edges were silently dropped. Asserting the edge groups exist is therefore a
 * precise regression test for the fix.
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "reference_models",
  "stroop_reference_with_lc.py",
);

test.describe("modulatory projections to parameter ports (#616)", { tag: "@ci" }, () => {
  test("LC→gain control edges render", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(MODEL);
    await prompt.press("Enter");
    await expect(page.getByText("stroop_reference_with_lc.py").first()).toBeVisible({
      timeout: 30000,
    });

    // The processing edges should be present (graph rendered at all).
    await expect(page.locator(".react-flow__edge").first()).toBeVisible({
      timeout: 30000,
    });

    // The two modulatory edges target the `gain` parameter ports — these only
    // exist in the DOM if the parameter ports are connectable handles.
    await expect(
      page.locator('.react-flow__edge[data-id*="color_hidden[gain]"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('.react-flow__edge[data-id*="word_hidden[gain]"]'),
    ).toHaveCount(1);
  });
});
