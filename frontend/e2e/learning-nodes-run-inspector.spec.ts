/**
 * Learning models in the Run tab and the Inspector (#1383, #1385).
 *
 * #1383: PsyNeuLink gives a learning pathway's generated TARGET mechanism the
 * INPUT role, so the Run tab offered "TARGET for value_estimate" as an input
 * card on the TD demo. A run doesn't learn and takes no targets; the Run tab
 * now lists only the real inputs and the run succeeds without the target.
 *
 * #1385: RecurrentTransferMechanism never sets its enable_learning Parameter
 * from the constructor, so the Hebbian demo's feature_layer (which learns)
 * showed enable_learning = false. The Inspector now shows it as built.
 */
import { mutatingTest as test, expect } from "./test-base";

test.use({ viewport: { width: 1600, height: 1000 } });

async function openDemo(page: any, label: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 30_000 });
}

test.describe("learning models: Run inputs and the Inspector", { tag: "@ci" }, () => {
  test("the TD demo's Run tab lists only the cue, and runs", async ({ page }) => {
    await openDemo(page, "TD Learning");
    await page.getByTestId("tab-run").click();
    const panel = page.getByTestId("run-panel");
    await expect(panel.getByTestId("run-input-cue")).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('[data-testid^="run-input-"]')).toHaveCount(1);
    await expect(panel.getByText(/TARGET for value_estimate/)).toHaveCount(0);

    const sent = page.waitForRequest((r: any) => r.url().includes("/api/model/run") && r.method() === "POST");
    await panel.getByRole("button", { name: /Run Model/ }).click();
    const inputs = (await sent).postDataJSON().inputs as Record<string, number[][]>;
    expect(Object.keys(inputs)).toEqual(["cue"]);
    await expect(panel.getByText(/Results \(\d+ trials\)/)).toBeVisible({ timeout: 60_000 });
  });

  test("the Hebbian demo's Inspector shows learning on", async ({ page }) => {
    await openDemo(page, "Hebbian Learning");
    await page.locator(".react-flow__node").getByText("feature_layer", { exact: true }).click();
    await page.getByTestId("tab-inspector").click();
    await expect(page.getByTestId("param-enable_learning")).toHaveValue("true", { timeout: 10_000 });
  });
});
