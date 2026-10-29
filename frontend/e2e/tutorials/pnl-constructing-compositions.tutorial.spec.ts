/**
 * PsyNeuLink Tutorials, lesson 6: Constructing compositions — lines, a loop,
 * and parallel layers (#9).
 *
 * Driven from `src/walkthroughs/pnl-constructing-compositions.yaml`, the file
 * the app reads, so the walkthrough can't drift from the app. It opens the
 * Constructing Compositions demo and reshapes its one composition into the
 * Tutorial notebook's four: a line of two, a line of three, a loop, and three
 * parallel layers. This asserts the three runs the instructions quote, on
 * the model's own results and logs.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 5, numbered 6.
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

const lesson = loadWalkthrough("pnl-constructing-compositions");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 5 under PsyNeuLink Tutorials, as lesson 6", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`6. ${lesson.title}`));
    expect(at, "lesson 6 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("5. ")), "after lesson 5").toBeLessThan(at);
  });

  test("reshapes one composition into the notebook's four, and runs them", async ({ page }) => {
    const runs: { outputs: number[][]; a: number[][] }[] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok() || !r.url().includes("/api/model/run")) return;
      const body = (await r.json().catch(() => null)) as {
        results?: { output: number[][] }[];
        logs?: Record<string, { values: number[][][] }>;
      } | null;
      if (!body?.results) return;
      const key = Object.keys(body.logs ?? {}).find((k) => k === "hidden_layer_a" || k.startsWith("hidden_layer_a-"));
      runs.push({
        outputs: body.results.map((t) => t.output.flat()),
        a: key ? body.logs![key].values.map((t) => t.flat()) : [],
      });
    });
    await page.goto("/?tour=pnl-constructing-compositions");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-constructing-compositions-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(runs.length, "three runs").toBe(3);
    const [line, loop, parallel] = runs;
    expect(line.outputs, "a line passes the input through").toEqual([[1, 2, 3, 4]]);
    expect(loop.outputs, "the loop takes a trial to come round").toEqual([
      [1, 1, 1, 1],
      [2, 3, 4, 5],
      [2, 3, 4, 5],
    ]);
    expect(loop.a[2], "hidden_layer_a grows").toEqual([3, 5, 7, 9]);
    expect(parallel.outputs, "three layers add up").toEqual([[3, 6, 9, 12]]);
  });
});
