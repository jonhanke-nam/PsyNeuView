/**
 * Edges to/from a nested composition's CIM ports render (#644).
 *
 * Loads the EGO reference model, whose `EM` EMComposition is wired into the
 * parent graph via its CompositionInterfaceMechanism ports:
 *   STATE / PREVIOUS STATE / CONTEXT [NORMALIZED]  ->  EM Input_CIM[...]
 *   EM Output_CIM[...]                             ->  PREDICTION
 * React Flow only emits an edge into the DOM when BOTH endpoints resolve to
 * real <Handle>s. Before the fix the composition node exposed no CIM-port
 * handles, so every edge touching EM was silently dropped and the box looked
 * disconnected. Asserting the edges exist is a precise regression test.
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
  "Giallanza2024_ego_study2.py",
);

test.describe("nested-composition CIM edges (#644)", { tag: "@ci" }, () => {
  test("edges to/from the EM composition render", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(MODEL);
    await prompt.press("Enter");
    await expect(
      page.getByText("Giallanza2024_ego_study2.py").first(),
    ).toBeVisible({ timeout: 30000 });

    // CIM edges belong to the nested view; models open flattened (#48).
    const viewSelect = page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
      .first();
    await expect(viewSelect).toBeVisible({ timeout: 30000 });
    const values = await viewSelect.locator("option").evaluateAll((os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    const outer = values.find((v) => !v.startsWith("__"))!;
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/load") && r.request().method() === "POST"),
      viewSelect.selectOption(outer),
    ]);

    // Graph rendered at all.
    await expect(page.locator(".react-flow__edge").first()).toBeVisible({
      timeout: 30000,
    });

    // Three projections feed the EM input_CIM; one leaves its output_CIM.
    // These exist in the DOM only if the composition node exposes matching
    // CIM-port handles.
    await expect(
      page.locator('.react-flow__edge[data-id*="EM Input_CIM["]'),
    ).toHaveCount(3);
    await expect(
      page.locator('.react-flow__edge[data-id*="EM Output_CIM["]'),
    ).toHaveCount(1);
  });
});
