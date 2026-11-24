/**
 * The Run and Learn panels call their backend choice "Execution mode" (#329).
 *
 * PsyNeuLink calls it `ExecutionMode`, so PsyNeuView does too: the label reads
 * "Execution mode", the options are PsyNeuLink's mode names (Python, PyTorch,
 * LLVM (compiled)) and none of them says "graph". At the Mac app's default
 * 1200px window the longer label must not wrap anything: the Run label stays
 * one line, level with Run Model, without the panel scrolling sideways, and
 * Start Learning stays on the Learn config row.
 */
import { readOnlyTest as test, expect } from "./test-base";

test.describe("Execution mode label", { tag: "@ci" }, () => {
  test("the Run and Learn panels say Execution mode, and no option says graph", async ({ page }) => {
    test.setTimeout(120_000);
    // The Mac app's default window.
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");
    await page.getByTestId("open-menu").click();
    await page.getByText("Autodiff Feedforward", { exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

    // Run: the label, its options, and the row it sits in.
    await page.getByTestId("tab-run").click();
    const runMode = page.getByTestId("run-backend");
    await expect(runMode).toBeVisible({ timeout: 30_000 });
    expect(await runMode.evaluate((el) => el.firstChild?.textContent?.trim())).toBe("Execution mode");
    const runOptions = await runMode.locator("option").allTextContents();
    expect(runOptions.map((o) => o.split(" — ")[0])).toEqual(["PyTorch", "Python", "LLVM (compiled)"]);
    for (const option of runOptions) expect(option.toLowerCase()).not.toContain("graph");

    // One line, level with Run Model, and the row doesn't overflow.
    const runModel = page.getByRole("button", { name: /Run Model/ });
    const label = (await runMode.boundingBox())!;
    const button = (await runModel.boundingBox())!;
    expect(Math.abs(label.y - button.y), "the label level with Run Model").toBeLessThanOrEqual(1);
    expect(label.height, "the label on one line").toBeLessThanOrEqual(button.height + 2);
    const { scrollWidth, clientWidth } = await page.getByTestId("run-panel").evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth, "the Run panel doesn't scroll sideways").toBeLessThanOrEqual(clientWidth + 1);

    // Learn: the same label and options.
    await page.getByTestId("tab-learn").click();
    const learnMode = page.locator("label:visible", { hasText: /^Execution mode/ });
    await expect(learnMode).toBeVisible({ timeout: 30_000 });
    const learnOptions = await learnMode.locator("option").allTextContents();
    expect(learnOptions.map((o) => o.split(" — ")[0])).toEqual(["PyTorch", "Python", "LLVM (compiled)"]);
    for (const option of learnOptions) expect(option.toLowerCase()).not.toContain("graph");
    // Start Learning stays on the config row beside it.
    const start = (await page.getByRole("button", { name: /Start Learning/i }).boundingBox())!;
    const learnLabel = (await learnMode.boundingBox())!;
    expect(Math.abs(start.y + start.height / 2 - (learnLabel.y + learnLabel.height / 2)), "Start Learning on the same row").toBeLessThanOrEqual(4);
  });
});
