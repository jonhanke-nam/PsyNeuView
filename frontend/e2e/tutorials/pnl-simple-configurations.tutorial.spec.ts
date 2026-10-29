/**
 * PsyNeuLink Tutorials, lesson 7: Simple configurations — a network from a
 * pathway (#9).
 *
 * Driven from `src/walkthroughs/pnl-simple-configurations.yaml`, the file the
 * app reads, so the walkthrough can't drift from the app. It opens the Simple
 * Configurations demo, the Basics and Primer's 5-2-5 network made from a
 * pathway list with no projection written; looks at the layers and at the
 * projection PsyNeuLink made (five rows of [1, 1]); runs the Primer's input
 * and all zeros; writes a matrix into the pathway list; and runs the Primer's
 * input again. This asserts every number the instructions quote, on the
 * model's own run results and logs, and the matrices on the model the app
 * parsed.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 3, numbered 7.
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

const lesson = loadWalkthrough("pnl-simple-configurations");
const FIRST = "MappingProjection from Input[OutputPort-0] to hidden[InputPort-0]";
const SECOND = "MappingProjection from hidden[OutputPort-0] to output[InputPort-0]";

test.use({ viewport: { width: 1600, height: 1000 } });

interface Projection {
  name: string;
  params: { matrix?: { value: number[][] } };
}
interface Parsed {
  compositions?: { nodes: { name: string; inputPorts: { shape: number[] }[] }[]; projections: Projection[] }[];
}

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 3 under PsyNeuLink Tutorials, as lesson 7", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`7. ${lesson.title}`));
    expect(at, "lesson 7 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("3. ")), "after lesson 3").toBeLessThan(at);
  });

  test("opens the Primer's 5-2-5 network, runs it, and writes a matrix into the pathway", async ({ page }) => {
    // Every run's hidden and output values, read from the run's logs (the
    // canvas's value pill shows only while the trace sits on a trial).
    const runs: { hidden: number[]; output: number[] }[] = [];
    // And every parse of the model, to read the projections' matrices.
    const parsed: Parsed[] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok()) return;
      const url = r.url();
      if (url.includes("/api/model/run")) {
        const body = (await r.json().catch(() => null)) as {
          results?: { output: number[][] }[];
          logs?: Record<string, { values: number[][][] }>;
        } | null;
        if (!body?.results || !body.logs) return;
        const log = (name: string) => {
          const key = Object.keys(body.logs!).find((k) => k === name || k.startsWith(`${name}-`));
          return key ? body.logs![key].values[0].flat() : [];
        };
        runs.push({ hidden: log("hidden"), output: body.results[0].output.flat() });
      } else if (url.includes("/api/demos/reset") || url.includes("/api/model/")) {
        // /demos/reset when the demo opens, /model/preview after the code edit.
        const body = (await r.json().catch(() => null)) as { model?: Parsed } | null;
        if (body?.model?.compositions?.[0]?.projections) parsed.push(body.model);
      }
    });
    await page.goto("/?tour=pnl-simple-configurations");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-simple-configurations-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // The demo as opened: layers of 5, 2 and 5, and two projections nobody
    // wrote, each full of 1s.
    expect(parsed.length, "the model was parsed").toBeGreaterThan(0);
    const first = parsed[0].compositions![0];
    expect(Object.fromEntries(first.nodes.map((n) => [n.name, n.inputPorts[0].shape]))).toEqual({
      Input: [5],
      hidden: [2],
      output: [5],
    });
    const matrix = (p: Parsed, name: string) =>
      p.compositions![0].projections.find((x) => x.name === name)?.params.matrix?.value;
    expect(matrix(parsed[0], FIRST), "Input to hidden: five rows of [1, 1]").toEqual(Array(5).fill([1, 1]));
    expect(matrix(parsed[0], SECOND), "hidden to output: two rows of five 1s").toEqual(Array(2).fill([1, 1, 1, 1, 1]));
    // After the edit, the matrix written into the pathway list.
    expect(matrix(parsed[parsed.length - 1], FIRST), "the pathway's matrix").toEqual([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0, 0],
    ]);

    // The numbers the instructions quote, on the model's own results.
    expect(runs.length, "three runs").toBe(3);
    const [primer, zeros, withMatrix] = runs;
    expect(primer.hidden.length).toBe(2);
    for (const h of primer.hidden) expect(h, "Logistic(16.9) is about 1").toBeCloseTo(1, 6);
    expect(primer.output.length).toBe(5);
    for (const o of primer.output) expect(o, "Logistic(2), as the Primer prints").toBeCloseTo(0.8808, 4);
    for (const h of zeros.hidden) expect(h, "Logistic(0)").toBeCloseTo(0.5, 6);
    for (const o of zeros.output) expect(o, "Logistic(0.5 + 0.5)").toBeCloseTo(0.7311, 4);
    expect(withMatrix.hidden[0], "Logistic(1 - 4.7)").toBeCloseTo(0.0241, 4);
    expect(withMatrix.hidden[1], "Logistic(3.2 - 6)").toBeCloseTo(0.0573, 4);
    for (const o of withMatrix.output) expect(o, "Logistic(0.024 + 0.057)").toBeCloseTo(0.5204, 4);
  });
});
