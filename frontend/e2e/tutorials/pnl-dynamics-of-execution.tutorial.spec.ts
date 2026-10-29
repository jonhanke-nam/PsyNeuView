/**
 * PsyNeuLink Tutorials, lesson 9: Dynamics of execution — time scales and
 * conditions (#9).
 *
 * Driven from `src/walkthroughs/pnl-dynamics-of-execution.yaml`, the file the
 * app reads, so the walkthrough can't drift from the app. It opens the
 * Dynamics of Execution demo, the Primer's Stroop model with a
 * DriftDiffusionIntegrator for its decision and a trial that ends when the
 * decision is finished; runs the Primer's trial with noise; turns the noise
 * off and runs the incongruent and congruent trials; makes the task an
 * LCAMechanism that the hidden layers wait 10 executions for; and runs the
 * Primer's trial again. This asserts every number the instructions quote, on
 * the model's own run results and logs, and the termination condition on
 * the model the app parsed.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 8, numbered 9.
 */
// mutatingTest: the walkthrough edits the demo's code, so it needs a clean slate.
import { mutatingTest as test, expect } from "../test-base";
import { loadWalkthrough, runWalkthrough } from "../tourDriver";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/tour",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

const lesson = loadWalkthrough("pnl-dynamics-of-execution");

test.use({ viewport: { width: 1600, height: 1000 } });

interface Parsed {
  compositions?: { terminationConditions?: Record<string, { type: string; args?: { positional?: unknown[] } }> }[];
}

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 8 under PsyNeuLink Tutorials, as lesson 9", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`9. ${lesson.title}`));
    expect(at, "lesson 9 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("8. ")), "after lesson 8").toBeLessThan(at);
  });

  test("decides step by step, with and without noise, and with the task settling first", async ({ page }) => {
    // Each run's decision, [where it stopped, how many steps], and the task
    // unit's last value.
    const runs: { decision: number[]; task: number[] }[] = [];
    const parsed: Parsed[] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok()) return;
      const url = r.url();
      if (url.includes("/api/model/run")) {
        const body = (await r.json().catch(() => null)) as {
          results?: { output: number[][] }[];
          logs?: Record<string, { values: number[][][] }>;
        } | null;
        if (!body?.results) return;
        const key = Object.keys(body.logs ?? {}).find((k) => k === "TASK INPUT" || k.startsWith("TASK INPUT-"));
        const task = key ? body.logs![key].values.at(-1)!.flat() : [];
        runs.push({ decision: body.results[0].output.flat(), task });
      } else if (url.includes("/api/demos/reset")) {
        const body = (await r.json().catch(() => null)) as { model?: Parsed } | null;
        if (body?.model?.compositions?.[0]) parsed.push(body.model);
      }
    });
    await page.goto("/?tour=pnl-dynamics-of-execution");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-dynamics-of-execution-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // A trial ends when DECISION is finished (TimeScale.TRIAL's newer name).
    expect(parsed.length, "the model was parsed").toBeGreaterThan(0);
    const trial = parsed[0].compositions![0].terminationConditions?.ENVIRONMENT_STATE_UPDATE;
    expect(trial?.type).toBe("WhenFinished");
    expect(trial?.args?.positional).toEqual([{ _node: "DECISION" }]);

    // The numbers the instructions quote, on the model's own results.
    expect(runs.length, "four runs").toBe(4);
    const [noisy, incongruent, congruent, settled] = runs;
    expect(noisy.decision[0], "with noise, red at the threshold").toBe(20);
    expect(Number.isInteger(noisy.decision[1]) && noisy.decision[1] > 1, "after some number of steps").toBe(true);
    expect(incongruent.decision, "no noise, incongruent").toEqual([20, 59]);
    expect(congruent.decision, "no noise, congruent").toEqual([20, 25]);
    expect(settled.decision, "the task settled first: the word wins").toEqual([-20, 57]);
    expect(settled.task[0], "the color unit").toBeCloseTo(0.61, 2);
    expect(settled.task[1], "the word unit").toBeCloseTo(0.39, 2);
  });
});
