/**
 * PsyNeuLink Tutorials, lesson 10: Control — a model that monitors its own
 * conflict (#9).
 *
 * Driven from `src/walkthroughs/pnl-control.yaml`, the file the app reads, so
 * the walkthrough can't drift from the app. It opens the Stroop With Control
 * demo, the Primer's Stroop model with a Conflict Monitor and a
 * ControlMechanism setting the task layer's gain; runs the script's four
 * incongruent trials; doubles the Energy weight; and runs them again. This
 * asserts every conflict and chance of red the instructions quote, on the
 * model's own run logs, and the controller on the model the app parsed.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 9, numbered 10.
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

const lesson = loadWalkthrough("pnl-control");

test.use({ viewport: { width: 1600, height: 1000 } });

interface Parsed {
  compositions?: { controller?: { mechanism?: { name: string; outputPorts: { name: string }[] } } }[];
}

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 9 under PsyNeuLink Tutorials, as lesson 10", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`10. ${lesson.title}`));
    expect(at, "lesson 10 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("9. ")), "after lesson 9").toBeLessThan(at);
  });

  test("monitors conflict and strengthens the instruction, slowly and then with a doubled weight", async ({ page }) => {
    // Each run's per-trial conflict and chance of red (DECISION's third
    // value, the chance of the upper threshold), from the run's logs.
    const runs: { conflict: number[]; red: number[] }[] = [];
    const parsed: Parsed[] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok()) return;
      const url = r.url();
      if (url.includes("/api/model/run")) {
        const body = (await r.json().catch(() => null)) as {
          logs?: Record<string, { values: number[][][] }>;
        } | null;
        const log = (name: string) => {
          const key = Object.keys(body?.logs ?? {}).find((k) => k === name || k.startsWith(`${name}-`));
          return key ? body!.logs![key].values.map((t) => t.flat()) : [];
        };
        if (!body?.logs) return;
        runs.push({ conflict: log("Conflict Monitor").map((t) => t[0]), red: log("DECISION").map((t) => t[2]) });
      } else if (url.includes("/api/demos/reset")) {
        const body = (await r.json().catch(() => null)) as { model?: Parsed } | null;
        if (body?.model?.compositions?.[0]) parsed.push(body.model);
      }
    });
    await page.goto("/?tour=pnl-control");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-control-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // CONTROL is the composition's controller, and it sets TASK's gain.
    expect(parsed.length, "the model was parsed").toBeGreaterThan(0);
    const controller = parsed[0].compositions![0].controller?.mechanism;
    expect(controller?.name).toBe("CONTROL");
    expect(controller?.outputPorts.map((p) => p.name)).toEqual(["TASK[gain] ControlSignal"]);

    // The numbers the instructions quote, on the model's own logs.
    expect(runs.length, "two runs").toBe(2);
    const close = (got: number[], want: number[], what: string) => {
      expect(got.length, what).toBe(want.length);
      got.forEach((g, i) => expect(g, `${what}, trial ${i + 1}`).toBeCloseTo(want[i], 2));
    };
    const [script, doubled] = runs;
    close(script.conflict, [0.49, 0.523, 0.552, 0.571], "conflict");
    close(script.red, [0.024, 0.038, 0.061, 0.088], "chance of red");
    close(doubled.conflict, [0.979, 1.183, 1.25, 1.239], "conflict, doubled weight");
    close(doubled.red, [0.024, 0.136, 0.462, 0.682], "chance of red, doubled weight");
  });
});
