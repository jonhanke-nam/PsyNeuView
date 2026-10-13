/**
 * A shape mismatch says where and why, on the graph and on Run (#1235).
 *
 * Reported on Stroop — Basic: change `color_hidden` from input_shapes=2 to 3.
 * The connection into it just vanished, and Run said only "Composition
 * 'stroop_model' not found", whichever node was changed. Now the connection is
 * drawn broken with PsyNeuLink's reason, the validation panel names it, and Run
 * says which line stopped the model and why.
 */
import { mutatingTest as test, expect, canvasNode } from "./test-base";

const LABEL = "Stroop — Basic";

test.describe("A shape mismatch is explained", { tag: "@ci" }, () => {
  test("the broken connection is drawn, named, and Run gives the reason", async ({ page }) => {
    const models = (await (await page.request.get("/api/reference-models")).json()).models;
    const rm = models.find((m: { label: string }) => m.label === LABEL);
    const loaded = await (await page.request.post("/api/reference-models/load", { data: { name: rm.name } })).json();
    const edited = (loaded.source as string).replace(
      /(color_hidden = pnl\.\w+\(\s*input_shapes=)2/,
      "$13",
    );
    expect(edited).not.toBe(loaded.source);
    const saved = await page.request.post("/api/model/save-source", {
      data: { file_path: loaded.file_path, source: edited },
    });
    expect(saved.ok()).toBe(true);

    await page.goto("/");
    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: LABEL, exact: true }).click();
    await expect(canvasNode(page, "color_hidden")).toBeVisible({ timeout: 30000 });

    // On the graph: drawn, broken, between the nodes it meant to join.
    await expect(page.locator('.react-flow__edge[data-id="__broken__color_input_to_hidden"]')).toHaveCount(1);
    const item = page.getByTestId("broken-connection").filter({ hasText: "color_input_to_hidden" });
    await expect(item).toBeVisible();
    await expect(item).toContainText("color_input → color_hidden");
    await expect(page.getByTestId("validation-summary")).toContainText("broken connection");

    // On Run: which line stopped it, and PsyNeuLink's reason.
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const panel = page.getByTestId("run-panel");
    await panel.getByRole("button", { name: "Run Model" }).click();
    await expect(panel).toContainText("stopped at line", { timeout: 30000 });
    await expect(panel).toContainText("color_input_to_hidden");
    await expect(panel).not.toContainText("not found");
  });
});
