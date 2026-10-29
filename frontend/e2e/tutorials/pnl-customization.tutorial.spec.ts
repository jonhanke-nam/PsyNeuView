/**
 * PsyNeuLink Tutorials, lesson 14: Customization — a Python function as a
 * mechanism's function (#9).
 *
 * Driven from `src/walkthroughs/pnl-customization.yaml`, the file the app
 * reads, so the walkthrough can't drift from the app. It opens the
 * Customization demo, the Primer's my_sinusoidal_fct as a ProcessingMechanism's
 * function, runs three points of the wave, sets the amplitude to 2 in the
 * code, and runs again. This asserts both runs on the model's own results.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 13, numbered 14.
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

const lesson = loadWalkthrough("pnl-customization");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 13 under PsyNeuLink Tutorials, as lesson 14", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`14. ${lesson.title}`));
    expect(at, "lesson 14 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("13. ")), "after lesson 13").toBeLessThan(at);
  });

  test("runs the Primer's sine function, then doubles its amplitude", async ({ page }) => {
    const runs: number[][] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok() || !r.url().includes("/api/model/run")) return;
      const body = (await r.json().catch(() => null)) as { results?: { output: number[][] }[] } | null;
      if (body?.results) runs.push(body.results.map((t) => t.output.flat()[0]));
    });
    await page.goto("/?tour=pnl-customization");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-customization-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(runs.length, "two runs").toBe(2);
    const close = (got: number[], want: number[], what: string) =>
      got.forEach((g, i) => expect(g, `${what} [${i}]`).toBeCloseTo(want[i], 6));
    close(runs[0], [1, 0, -1], "the wave");
    close(runs[1], [2, 0, -2], "amplitude 2");
  });
});
