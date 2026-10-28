/**
 * PsyNeuLink Tutorials, lesson 2: From nodes to graphs — a composition (#9).
 *
 * Driven from `src/walkthroughs/pnl-composition.yaml`, the file the app
 * reads, so the walkthrough can't drift from the app. It builds from New
 * Model and runs the notebook's compositions: 4 through two Linear nodes; a
 * five-trial sweep from -3 to 3; a two-unit Logistic fed x and 3x; and the
 * step mechanism (gain 100, midpoint 1) with [0.9, 1.1]. This asserts every
 * output the instructions quote, on the model's own run results.
 *
 * Also checks the Tutorials menu lists the lesson second under PsyNeuLink
 * Tutorials.
 */
// mutatingTest: the walkthrough creates a model, so it needs a clean slate.
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

const lesson = loadWalkthrough("pnl-composition");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed second under PsyNeuLink Tutorials", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(rows[1]).toContain(`2. ${lesson.title}`);
  });

  test("builds a composition, gives it two units, and runs the notebook's numbers", async ({ page }) => {
    // Keep every run's outputs, one vector per trial: the canvas's value
    // pill only shows while the trace sits on a trial, so it can't be read
    // back after the walkthrough.
    const runs: number[][][] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const body = (await r.json().catch(() => null)) as { results?: { output: number[][] }[] } | null;
        if (body?.results) runs.push(body.results.map((t) => t.output.flat()));
      }
    });
    await page.goto("/?tour=pnl-composition");
    // No model is opened: the first step creates one.
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-composition-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // The notebook's numbers, measured on the model's own output rather than
    // trusted from the instructions.
    expect(runs.length, "four runs").toBe(4);
    expect(runs[0], "4 through two Linear nodes").toEqual([[4]]);
    expect(runs[1].flat(), "the sweep: each output equals its input").toEqual([-3, -1.5, 0, 1.5, 3]);
    const logistic = runs[2];
    expect(logistic.length, "two trials of two units").toBe(2);
    expect(logistic[0][0], "Logistic of -1").toBeCloseTo(0.2689, 4);
    expect(logistic[0][1], "Logistic of -3").toBeCloseTo(0.0474, 4);
    expect(logistic[1][0], "Logistic of 1").toBeCloseTo(0.7311, 4);
    expect(logistic[1][1], "Logistic of 3").toBeCloseTo(0.9526, 4);
    const step = runs[3];
    expect(step.length, "one trial of two units").toBe(1);
    expect(step[0][0], "just below the step").toBeCloseTo(0.0000454, 6);
    expect(step[0][1], "just above the step").toBeCloseTo(0.99995, 4);
  });
});
