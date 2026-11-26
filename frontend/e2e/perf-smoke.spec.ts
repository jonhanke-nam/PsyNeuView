/**
 * Performance smoke check (#406): a few key timings, held to generous budgets
 * so a large slowdown fails and ordinary noise does not.
 *
 * Measures, once each (about 25 s in all):
 *   - opening Stroop — Basic (after a small model, untimed, has warmed the
 *     backend up), and EGO (the heaviest), to the graph settled;
 *   - running Stroop — Basic's default inputs, to the first trial's results;
 *   - stepping through its trace (frame after each Next step, median);
 *   - typing in the code editor with the live preview on (p95 key → frame),
 *     last, as an unsaved edit stops another model opening without asking.
 *
 * The budgets are `ciBudgets` in docs/testing-coverage/perf-baseline.json, set
 * well above this machine's baseline because CI runners are slower and share
 * their cores. Every measurement is printed, so CI's log shows the real
 * numbers to tighten the budgets against (aim for about twice CI's own
 * median). See docs/performance.md.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  clickTimed,
  frameAfter,
  installProbes,
  toEndOfFile,
  median,
  openTimed,
  percentile,
  startKeyLatency,
  stopKeyLatency,
  waitSelector,
} from "./perf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(
  readFileSync(path.resolve(__dirname, "..", "..", "docs", "testing-coverage", "perf-baseline.json"), "utf8"),
);
const BUDGETS: Record<string, number> = BASELINE.ciBudgets;

test.describe("performance smoke (#406)", { tag: "@ci" }, () => {
  test("key timings stay inside their budgets", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await installProbes(page);
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });

    // The harness has just restarted the backend's model worker; open a small
    // model first, untimed, so the first timing isn't the worker warming up.
    await openTimed(page, "TD Learning / dopamine (Montague, Dayan & Sejnowski 1996)");

    const seen: Record<string, number | null> = {};
    seen.stroopOpenSettled = (await openTimed(page, "Stroop — Basic")).settled;
    await closePalette(page);

    await page.getByTestId("tab-run").click();
    const runButton = page.getByRole("button", { name: /Run Model/ });
    await expect(runButton).toBeEnabled({ timeout: 30_000 });
    await clickTimed(runButton);
    seen.stroopRunToResults = await waitSelector(page, '[data-testid="run-trial-card-1"]');

    const next = page.getByTestId("trace-next-step");
    await expect(next).toBeVisible({ timeout: 15_000 });
    const frames: number[] = [];
    for (let i = 0; i < 8 && (await next.isEnabled()); i++) frames.push(await frameAfter(next));
    seen.stroopStepFrame = median(frames);

    seen.egoOpenSettled = (await openTimed(page, "EGO — Giallanza et al. 2024 (Study 2)")).settled;

    await page.locator(".cm-content").first().click();
    await toEndOfFile(page);
    await page.keyboard.press("Enter");
    await startKeyLatency(page);
    await page.keyboard.type("# typing latency probe", { delay: 60 });
    seen.typeLatencyP95 = percentile(await stopKeyLatency(page), 95);

    const report = Object.entries(seen).map(([k, v]) => `${k}=${v == null ? "–" : Math.round(v)}ms (budget ${BUDGETS[k]}ms)`);
    console.log(`[perf-smoke] ${report.join(", ")}`);
    test.info().annotations.push({ type: "perf", description: report.join(", ") });

    for (const [k, v] of Object.entries(seen)) {
      expect(BUDGETS[k], `a budget for ${k} in perf-baseline.json`).toBeGreaterThan(0);
      expect(v, `${k} was measured`).not.toBeNull();
      expect(v!, `${k}: ${Math.round(v!)} ms, over its budget of ${BUDGETS[k]} ms`).toBeLessThanOrEqual(BUDGETS[k]);
    }
  });
});
