/**
 * A node name with a newline or a quote doesn't crash the app (#1236).
 *
 * Reported against Stroop — Basic: renaming `word_input` to a name ending in
 * `\n` took the app to "Something went wrong" ('... is not a valid selector'),
 * and because a reference model keeps its edited working copy, every reopen
 * crashed again. The name went into a CSS selector unescaped, in React Flow's
 * own node lookup, which runs for every node.
 */
import { mutatingTest as test, expect, canvasNode } from "./test-base";

const LABEL = "Stroop — Basic";
// In the Python source: a newline escape and a double quote inside the name.
const ODD = String.raw`odd\n"name`;

test.describe("Node names with special characters", { tag: "@ci" }, () => {
  test("render without crashing, and the reference model can be reset", async ({ page }) => {
    // Edit the working copy the way the editor would, then open it.
    const models = (await (await page.request.get("/api/reference-models")).json()).models;
    const rm = models.find((m: { label: string }) => m.label === LABEL);
    const loaded = await (await page.request.post("/api/reference-models/load", { data: { name: rm.name } })).json();
    const source: string = loaded.source;
    expect(source).toContain("name='word_input'");
    const saved = await page.request.post("/api/model/save-source", {
      data: { file_path: loaded.file_path, source: source.replace("name='word_input'", `name='${ODD}'`) },
    });
    expect(saved.ok()).toBe(true);

    await page.goto("/");
    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: LABEL, exact: true }).click();

    // The app is still up, and the renamed node is on the canvas.
    await expect(canvasNode(page, "color_hidden")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.locator(".react-flow__node").filter({ hasText: "odd" })).toHaveCount(1);

    // The edited copy can be put back to the bundled version.
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("reference-reset").click();
    await expect(canvasNode(page, "word_input")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("reference-reset")).toHaveCount(0);
  });
});
