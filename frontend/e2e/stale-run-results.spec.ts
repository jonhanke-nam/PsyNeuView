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
import type { Page, TestInfo } from "@playwright/test";
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
    page.waitForResponse((r) => r.url().endsWith("/api/model/run") && r.ok(), { timeout: 60_000 }),
    panel.getByRole("button", { name: "Run Model" }).click(),
  ]);
  await expect(panel.getByTestId("run-results-body")).toBeVisible({ timeout: 30_000 });
  return panel;
}

interface StalenessState {
  ranHash: string | null;
  ranSource: string | null;
  ranComposition: string | null;
  source: string;
  sourceHash: string;
  activeComposition: string | null;
  stale: boolean;
}

/** Both sides of the staleness check (#366), from the app's test hook. */
function stalenessState(page: Page): Promise<StalenessState> {
  return page.evaluate(() =>
    (window as unknown as { __pnvStalenessTest: { state: () => StalenessState } }).__pnvStalenessTest.state(),
  );
}

/** Where two texts first differ, or -1. */
function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/**
 * Run `check`; if it fails, attach the two texts the staleness check hashed
 * (the source the run was hashed from and the source now in the store), their
 * lengths, where they first differ, and the chosen composition before and
 * after (#366). A failure on CI then shows its cause in the kept report.
 */
async function withStalenessDiagnosis(page: Page, info: TestInfo, before: StalenessState, check: () => Promise<void>) {
  try {
    await check();
  } catch (err) {
    const after = await stalenessState(page).catch(() => null);
    if (after) {
      const ran = after.ranSource ?? "";
      const at = firstDifference(ran, after.source);
      const summary = {
        ranHash: after.ranHash,
        sourceHash: after.sourceHash,
        stale: after.stale,
        ranSourceLength: after.ranSource?.length ?? null,
        sourceLength: after.source.length,
        firstDifference: at,
        ranAround: at < 0 ? null : JSON.stringify(ran.slice(Math.max(0, at - 40), at + 40)),
        sourceAround: at < 0 ? null : JSON.stringify(after.source.slice(Math.max(0, at - 40), at + 40)),
        ranComposition: after.ranComposition,
        activeCompositionBefore: before.activeComposition,
        activeCompositionAfter: after.activeComposition,
      };
      await info.attach("staleness-summary.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
      await info.attach("ran-source.py", { body: ran, contentType: "text/plain" });
      await info.attach("store-source.py", { body: after.source, contentType: "text/plain" });
    }
    throw err;
  }
}

test.describe("Run results go stale after an edit (#337)", { tag: "@ci" }, () => {
  test("an edit warns and clears the highlights", async ({ page }) => {
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
  });

  // #366: Undo right after the edit, before its live preview has rebuilt the
  // model (1.5 s, then the build). The edit was not yet a History step, so
  // Undo said "Nothing to undo"; this failed on the slower CI runner.
  test("Undo back to the source that ran makes the results current (#366)", async ({ page }, info) => {
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
    const warning = panel.getByTestId("stale-results-warning");
    const before = await stalenessState(page);
    expect(before.ranHash).toBe(before.sourceHash);

    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(original.replace("gain=1.1", "gain=1.7"));
    await expect(warning).toBeVisible();

    // One Undo, at once: the edit's preview has not run yet. The test browser
    // reports Windows (Playwright's Desktop Chrome), so the app's Undo is
    // Ctrl+Z on every machine. ControlOrMeta+Z was Cmd+Z on a Mac, which the
    // app left to the code editor's own text undo, so the test passed there
    // without ever using PsyNeuView's Undo.
    await page.keyboard.press("Control+z");
    await withStalenessDiagnosis(page, info, before, async () => {
      await expect(warning).toHaveCount(0, { timeout: 10_000 });
      await expect(panel.getByTestId("run-results-body")).toHaveAttribute("data-stale", "false");
    });

    // Redo brings the edit back, and the warning with it.
    await page.keyboard.press("Control+Shift+z");
    await expect(warning).toBeVisible({ timeout: 10_000 });
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
