/**
 * PsyNeuLink Tutorials, lesson 5: The pre-trained Stroop model — Cohen, Dunbar
 * and McClelland (1990) (#9).
 *
 * Driven from `src/walkthroughs/pnl-pretrained-stroop.yaml`, the file the app
 * reads, so the walkthrough can't drift from the app. It opens the Pretrained
 * Stroop demo, the Tutorial notebook's model with its learned weights, runs
 * the notebook's input, and runs all eight combinations. This asserts every
 * output the instructions quote, on the model's own results.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 4, numbered 5.
 */
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

const lesson = loadWalkthrough("pnl-pretrained-stroop");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 4 under PsyNeuLink Tutorials, as lesson 5", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`5. ${lesson.title}`));
    expect(at, "lesson 5 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("4. ")), "after lesson 4").toBeLessThan(at);
  });

  test("runs the notebook's input and all eight combinations", async ({ page }) => {
    const runs: number[][][] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok() || !r.url().includes("/api/model/run")) return;
      const body = (await r.json().catch(() => null)) as { results?: { output: number[][] }[] } | null;
      if (body?.results) runs.push(body.results.map((t) => t.output.flat()));
    });
    await page.goto("/?tour=pnl-pretrained-stroop");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-pretrained-stroop-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(runs.length, "two runs").toBe(2);
    const [notebook, eight] = runs;
    expect(notebook[0][0], "red, weakly").toBeCloseTo(0.55, 2);
    expect(notebook[0][1]).toBeCloseTo(-0.55, 2);
    const red = eight.map((o) => o[0]);
    const want = [1.532, -0.55, 0.55, -1.532, 2.336, 1.973, -1.973, -2.336];
    expect(red.length).toBe(8);
    red.forEach((v, i) => expect(v, `trial ${i + 1}`).toBeCloseTo(want[i], 2));
  });
});
