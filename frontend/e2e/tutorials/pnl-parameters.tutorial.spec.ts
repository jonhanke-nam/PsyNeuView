/**
 * PsyNeuLink Tutorials, lesson 11: Parameters — a mechanism's, its
 * function's, and modulated ones (#9).
 *
 * Driven from `src/walkthroughs/pnl-parameters.yaml`, the file the app reads,
 * so the walkthrough can't drift from the app. It opens lesson 10's Stroop
 * With Control demo, runs the four trials, sets OUTPUT's Logistic gain to 2
 * in the Inspector, and runs them again. This asserts the per-trial OUTPUT,
 * conflict and chance of red the instructions quote, on the model's own run
 * logs, and the gain written into the code.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 10, numbered 11.
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

const lesson = loadWalkthrough("pnl-parameters");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 10 under PsyNeuLink Tutorials, as lesson 11", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`11. ${lesson.title}`));
    expect(at, "lesson 11 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("10. ")), "after lesson 10").toBeLessThan(at);
  });

  test("sets a function parameter and sees control do less", async ({ page }) => {
    const runs: { output: number[][]; conflict: number[]; red: number[] }[] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok() || !r.url().includes("/api/model/run")) return;
      const body = (await r.json().catch(() => null)) as { logs?: Record<string, { values: number[][][] }> } | null;
      if (!body?.logs) return;
      const log = (name: string) => {
        const key = Object.keys(body.logs!).find((k) => k === name || k.startsWith(`${name}-`));
        return key ? body.logs![key].values.map((t) => t.flat()) : [];
      };
      runs.push({
        output: log("OUTPUT"),
        conflict: log("Conflict Monitor").map((t) => t[0]),
        red: log("DECISION").map((t) => t[2]),
      });
    });
    await page.goto("/?tour=pnl-parameters");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-parameters-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // The gain went into the code.
    await expect(page.getByTestId("code-editor-pane")).toContainText("gain=2");

    expect(runs.length, "two runs").toBe(2);
    const close = (got: number[], want: number[], what: string) => {
      expect(got.length, what).toBe(want.length);
      got.forEach((g, i) => expect(g, `${what} [${i}]`).toBeCloseTo(want[i], 2));
    };
    const [plain, steep] = runs;
    close(plain.output[0], [0.267, 0.733], "OUTPUT, first trial");
    close(plain.output[3], [0.354, 0.646], "OUTPUT, last trial");
    close(plain.conflict, [0.49, 0.523, 0.552, 0.571], "conflict");
    close(steep.output[0], [0.118, 0.882], "OUTPUT with gain 2, first trial");
    close(steep.conflict, [0.259, 0.251, 0.268, 0.287], "conflict with gain 2");
    close(steep.red, [0.002, 0.002, 0.002, 0.003], "chance of red with gain 2");
  });
});
