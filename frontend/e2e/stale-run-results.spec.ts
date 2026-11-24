/**
 * Run results go stale after an edit (#337).
 *
 * Each run is tagged with a hash of the source it ran. Edit the model and the
 * Run panel says the results are from an earlier version, dims them, and the
 * graph's stepping highlights and trace go away. Undo back to the exact source
 * that ran and the results are current again. A fold toggle rebuilds the graph
 * but leaves the source alone, so it never makes results stale.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

const STROOP = "Stroop — Basic";
const WARNING = "These results are from an earlier version of the model. Run again to update them.";

async function runModel(page: Page) {
  const panel = page.getByTestId("run-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Run", exact: true }).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/model/run") && r.ok(), { timeout: 60_000 }),
    panel.getByRole("button", { name: "Run Model" }).click(),
  ]);
  await expect(panel.getByTestId("run-results-body")).toBeVisible({ timeout: 30_000 });
  return panel;
}

test.describe("Run results go stale after an edit (#337)", { tag: "@ci" }, () => {
  test("an edit warns and clears the highlights; Undo makes the results current", async ({ page }) => {
    test.setTimeout(180_000);
    const models = (await (await page.request.get("/api/reference-models")).json()).models;
    const rm = models.find((m: { label: string }) => m.label === STROOP);
    const loaded = await (await page.request.post("/api/reference-models/load", { data: { name: rm.name } })).json();
    const original = loaded.source as string;

    await page.goto("/");
    await closePalette(page);
    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: STROOP, exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

    const panel = await runModel(page);
    await expect(page.getByTestId("trace-next-step")).toBeVisible();
    await expect(panel.getByTestId("stale-results-warning")).toHaveCount(0);
    await expect(panel.getByTestId("run-results-body")).toHaveAttribute("data-stale", "false");

    // Edit a parameter in the code.
    const editor = page.locator(".cm-content");
    expect(original).toContain("gain=1.1");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(original.replace("gain=1.1", "gain=1.7"));

    const warning = panel.getByTestId("stale-results-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(WARNING);
    await expect(warning.getByRole("button", { name: "Run again" })).toBeVisible();
    await expect(panel.getByTestId("run-results-body")).toHaveAttribute("data-stale", "true");
    // The results stay, dimmed: they are not deleted.
    await expect(panel.getByTestId("run-results-body")).toContainText("Per-trial values");
    // The stepping highlights and trace are gone.
    await expect(page.getByTestId("trace-next-step")).toHaveCount(0);

    // Undo back to the source that ran: the results are current again.
    await editor.click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(warning).toHaveCount(0);
    await expect(panel.getByTestId("run-results-body")).toHaveAttribute("data-stale", "false");
  });

  test("a fold toggle doesn't make results stale", async ({ page }) => {
    test.setTimeout(180_000);
    const dir = mkdtempSync(path.join(tmpdir(), "stale337-"));
    const model = path.join(dir, "nested_minimal.py");
    copyFileSync(fixturePath("nested_minimal"), model);

    await page.goto("/");
    await closePalette(page);
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(model);
    await prompt.press("Enter");
    await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

    const panel = await runModel(page);
    const collapse = page.getByTestId("graph-canvas").getByRole("button", { name: /^Collapse composition inner_comp$/ });
    await expect(collapse).toBeVisible({ timeout: 15_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/model/load"), { timeout: 60_000 }),
      collapse.click(),
    ]);
    // Past the staleness check's pause after a source change.
    await page.waitForTimeout(500);
    await expect(panel.getByTestId("stale-results-warning")).toHaveCount(0);
    await expect(panel.getByTestId("run-results-body")).toHaveAttribute("data-stale", "false");
  });
});
