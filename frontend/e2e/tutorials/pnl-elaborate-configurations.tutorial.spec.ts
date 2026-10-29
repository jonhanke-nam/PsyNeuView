/**
 * PsyNeuLink Tutorials, lesson 8: More elaborate configurations — the Stroop
 * model (#9).
 *
 * Driven from `src/walkthroughs/pnl-elaborate-configurations.yaml`, the file
 * the app reads, so the walkthrough can't drift from the app. It opens the
 * Elaborate Configurations demo, the Basics and Primer's Stroop model made
 * from five pathway lists; looks at the color pathway, the color and word
 * weights, the task input and the decision; runs the Primer's two color
 * naming trials; and reads the word green in red ink. This asserts the
 * matrices on the model the app parsed, and every decision time and chance
 * the instructions quote on the model's own run logs. The DDM's 1 or -1 is
 * drawn at random, so it is not asserted.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 7, numbered 8.
 */
// mutatingTest: the walkthrough runs the demo, so it needs a clean slate.
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

const lesson = loadWalkthrough("pnl-elaborate-configurations");
const edge = (from: string, to: string) => `MappingProjection from ${from}[OutputPort-0] to ${to}[InputPort-0]`;

test.use({ viewport: { width: 1600, height: 1000 } });

interface Projection {
  name: string;
  params: { matrix?: { value: number[][] } };
}
interface Parsed {
  compositions?: { projections: Projection[] }[];
}

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 7 under PsyNeuLink Tutorials, as lesson 8", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`8. ${lesson.title}`));
    expect(at, "lesson 8 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("7. ")), "after lesson 7").toBeLessThan(at);
  });

  test("opens the Primer's Stroop model and runs both tasks", async ({ page }) => {
    // Each run's trials, as [decision time, chance of red] from DECISION's
    // log: its values are the decision, the time, then the chances of the
    // upper (red) and lower thresholds.
    const runs: [number, number][][] = [];
    const parsed: Parsed[] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok()) return;
      const url = r.url();
      if (url.includes("/api/model/run")) {
        const body = (await r.json().catch(() => null)) as {
          logs?: Record<string, { values: number[][][] }>;
        } | null;
        const key = body?.logs && Object.keys(body.logs).find((k) => k === "DECISION" || k.startsWith("DECISION-"));
        if (!key) return;
        runs.push(body!.logs![key].values.map((t) => [t[1].flat()[0], t[2].flat()[0]] as [number, number]));
      } else if (url.includes("/api/demos/reset")) {
        const body = (await r.json().catch(() => null)) as { model?: Parsed } | null;
        if (body?.model?.compositions?.[0]?.projections) parsed.push(body.model);
      }
    });
    await page.goto("/?tour=pnl-elaborate-configurations");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-elaborate-configurations-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // The matrices the pathway lists wrote, as the instructions quote them.
    expect(parsed.length, "the model was parsed").toBeGreaterThan(0);
    const matrix = (name: string) =>
      parsed[0].compositions![0].projections.find((x) => x.name === name)?.params.matrix?.value;
    expect(matrix(edge("COLOR INPUT", "COLOR HIDDEN"))).toEqual([[2, -2], [-2, 2]]);
    expect(matrix(edge("WORD INPUT", "WORD HIDDEN"))).toEqual([[3, -3], [-3, 3]]);
    expect(matrix(edge("TASK INPUT", "COLOR HIDDEN"))).toEqual([[4, 4], [0, 0]]);
    expect(matrix(edge("TASK INPUT", "WORD HIDDEN"))).toEqual([[0, 0], [4, 4]]);

    // The decision times and chances, on the model's own logs.
    expect(runs.length, "two runs").toBe(2);
    const [primer, reading] = runs;
    expect(primer.length, "the Primer's two trials").toBe(2);
    const [congruent, incongruent] = primer;
    expect(congruent[0], "congruent decision time").toBeCloseTo(1.41, 2);
    expect(congruent[1], "congruent chance of red").toBeCloseTo(0.999, 3);
    expect(incongruent[0], "incongruent decision time, slower").toBeCloseTo(2.75, 2);
    expect(incongruent[1], "incongruent chance of red").toBeCloseTo(0.94, 2);
    expect(reading.length).toBe(1);
    expect(reading[0][0], "reading the word green in red ink is quick").toBeCloseTo(1.38, 2);
    expect(reading[0][1], "and answers green").toBeCloseTo(0.001, 3);
  });
});
