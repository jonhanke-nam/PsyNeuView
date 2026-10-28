/**
 * PsyNeuLink Tutorials, lesson 3: Adding projections — the mapping matrix (#9).
 *
 * Driven from `src/walkthroughs/pnl-projections.yaml`, the file the app
 * reads, so the walkthrough can't drift from the app. It builds from New
 * Model: input_node becomes the notebook's Linear(slope=2, intercept=2) unit,
 * output_node its Logistic unit, and the projection between them is looked
 * at (the identity matrix, [[1]]), swept from -3 to 3, written as [[0.5]]
 * under Projection Parameters, and swept again. This asserts every output
 * the instructions quote, on the model's own run results, and that the
 * matrix edit reached the code as the notebook's explicit `matrix=`.
 *
 * Also checks the Tutorials menu lists the lesson third under PsyNeuLink
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

const lesson = loadWalkthrough("pnl-projections");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed third under PsyNeuLink Tutorials", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(rows[2]).toContain(`3. ${lesson.title}`);
  });

  test("joins a Linear unit to a Logistic one, sweeps it, and writes the matrix", async ({ page }) => {
    // Keep every run's outputs, one vector per trial: the canvas's value
    // pill only shows while the trace sits on a trial, so it can't be read
    // back after the walkthrough.
    const runs: number[][][] = [];
    // And the source after every Inspector edit, to see the matrix reach the
    // code: the editor draws only the lines in view, so it can't be read whole.
    let source = "";
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok()) return;
      if (r.url().includes("/api/model/run")) {
        const body = (await r.json().catch(() => null)) as { results?: { output: number[][] }[] } | null;
        if (body?.results) runs.push(body.results.map((t) => t.output.flat()));
      } else if (r.url().includes("/api/model/update-param")) {
        const body = (await r.json().catch(() => null)) as { source?: string } | null;
        if (body?.source) source = body.source;
      }
    });
    await page.goto("/?tour=pnl-projections");
    // No model is opened: the first step creates one.
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-projections-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // The notebook's numbers, measured on the model's own output rather than
    // trusted from the instructions: Logistic(2x + 2) through the identity,
    // then Logistic(0.5 (2x + 2)) = Logistic(x + 1) once the matrix is 0.5.
    expect(runs.length, "two runs").toBe(2);
    const identity = runs[0].flat();
    expect(identity.length, "five trials through the identity").toBe(5);
    expect(identity[0], "Logistic of 2(-3) + 2 = -4").toBeCloseTo(0.018, 3);
    expect(identity[1], "Logistic of 2(-1.5) + 2 = -1").toBeCloseTo(0.2689, 4);
    expect(identity[2], "Logistic of 2(0) + 2 = 2").toBeCloseTo(0.8808, 4);
    expect(identity[3], "Logistic of 2(1.5) + 2 = 5").toBeCloseTo(0.9933, 4);
    expect(identity[4], "Logistic of 2(3) + 2 = 8").toBeCloseTo(0.99966, 5);
    const halved = runs[1].flat();
    expect(halved.length, "five trials through the halving matrix").toBe(5);
    expect(halved[0], "Logistic of 0.5(-4) = -2").toBeCloseTo(0.1192, 4);
    expect(halved[1], "Logistic of 0.5(-1) = -0.5").toBeCloseTo(0.3775, 4);
    expect(halved[2], "Logistic of 0.5(2) = 1").toBeCloseTo(0.7311, 4);
    expect(halved[3], "Logistic of 0.5(5) = 2.5").toBeCloseTo(0.9241, 4);
    expect(halved[4], "Logistic of 0.5(8) = 4").toBeCloseTo(0.9820, 4);

    // The matrix edit is the notebook's explicit MappingProjection: the code
    // now names the matrix, where the starter left it to the identity default.
    expect(source, "the matrix is written into the MappingProjection").toContain("matrix=[[0.5]]");
    expect(source).toContain("sender=input_node");
  });
});
