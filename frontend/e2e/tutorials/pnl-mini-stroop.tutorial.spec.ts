/**
 * PsyNeuLink Tutorials, lesson 4: The mini Stroop model (#9).
 *
 * Driven from `src/walkthroughs/pnl-mini-stroop.yaml`, the file the app
 * reads, so the walkthrough can't drift from the app. It builds from New
 * Model: input_node plays the notebook's Colors and output_node its
 * Response, both given two units, output_node made Logistic; a third
 * TransferMechanism is added from the palette, named words, given two units
 * and slope 1.5, and dragged into output_node as the second pathway. Then
 * the notebook's congruent and incongruent trials. This asserts every
 * output the instructions quote, on the model's own run results, and that
 * the drag wrote a second MappingProjection into the code.
 *
 * Also checks the Tutorials menu lists the lesson fourth under PsyNeuLink
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

const lesson = loadWalkthrough("pnl-mini-stroop");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed fourth under PsyNeuLink Tutorials", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(rows[3]).toContain(`4. ${lesson.title}`);
  });

  test("builds two inputs converging on a Logistic response, and runs both trials", async ({ page }) => {
    // Keep every run's outputs, one vector per trial: the canvas's value
    // pill only shows while the trace sits on a trial, so it can't be read
    // back after the walkthrough.
    const runs: number[][][] = [];
    // And the source after every edit, to see the projection reach the code:
    // the editor draws only the lines in view, so it can't be read whole.
    let source = "";
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok()) return;
      if (r.url().includes("/api/model/run")) {
        const body = (await r.json().catch(() => null)) as { results?: { output: number[][] }[] } | null;
        if (body?.results) runs.push(body.results.map((t) => t.output.flat()));
      } else if (/\/api\/model\/(update-param|structural-change|rename-node)/.test(r.url())) {
        const body = (await r.json().catch(() => null)) as { source?: string } | null;
        if (body?.source) source = body.source;
      }
    });
    await page.goto("/?tour=pnl-mini-stroop");
    // No model is opened: the first step creates one.
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-mini-stroop-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // The notebook's numbers, measured on the model's own output rather than
    // trusted from the instructions: Response = Logistic(colors + 1.5 words).
    expect(runs.length, "two runs").toBe(2);
    const congruent = runs[0];
    expect(congruent.length, "one trial of two units").toBe(1);
    expect(congruent[0][0], "red: Logistic of 0").toBeCloseTo(0.5, 4);
    expect(congruent[0][1], "blue: Logistic of 1 + 1.5").toBeCloseTo(0.9241, 4);
    const incongruent = runs[1];
    expect(incongruent.length, "one trial of two units").toBe(1);
    expect(incongruent[0][0], "red: Logistic of 1").toBeCloseTo(0.7311, 4);
    expect(incongruent[0][1], "blue: Logistic of 1.5").toBeCloseTo(0.8176, 4);

    // The drag wrote the notebook's second pathway: a MappingProjection into
    // output_node from the renamed mechanism, which has slope 1.5.
    expect(source, "the third mechanism is named words").toContain("name='words'");
    expect(source, "with slope 1.5").toMatch(/slope=1\.5/);
    expect(source, "a second projection into output_node").toMatch(
      /pnl\.MappingProjection\(\s*sender=New_TransferMechanism_1,\s*receiver=output_node/,
    );
  });
});
