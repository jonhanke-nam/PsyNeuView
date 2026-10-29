/**
 * PsyNeuLink Tutorials, lesson 13: Learning — a network learns XOR by
 * backpropagation (#9).
 *
 * Driven from `src/walkthroughs/pnl-learning.yaml`, the file the app reads,
 * so the walkthrough can't drift from the app. It opens the XOR Learning
 * demo, trains 250 epochs at the default rate, raises the learning rate to 3
 * in the code, and trains 300 epochs. This asserts both trainings' error and
 * final outputs, on the training jobs' own results.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 12, numbered 13.
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

const lesson = loadWalkthrough("pnl-learning");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 12 under PsyNeuLink Tutorials, as lesson 13", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`13. ${lesson.title}`));
    expect(at, "lesson 13 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("12. ")), "after lesson 12").toBeLessThan(at);
  });

  test("hardly learns at the default rate, then learns XOR at rate 3", async ({ page }) => {
    test.setTimeout(240_000);
    const trainings: { loss: number; outputs: number[]; epochs: number }[] = [];
    // Training runs as a job (POST /api/jobs); its finished snapshot,
    // GET /api/jobs/<id>, carries the learn result.
    const seen = new Set<string>();
    page.on("response", async (r) => {
      if (r.request().method() !== "GET" || !r.ok() || !/\/api\/jobs\/[^/]+$/.test(r.url())) return;
      const snap = (await r.json().catch(() => null)) as {
        id?: string;
        status?: string;
        result?: { finalLoss?: number; epochs?: number; results?: ({ output?: number[][] } | number[][])[] };
      } | null;
      const body = snap?.result;
      if (snap?.status !== "done" || typeof body?.finalLoss !== "number" || seen.has(r.url())) return;
      seen.add(r.url());
      const outputs = (body.results ?? []).map((t) => {
        const v = Array.isArray(t) ? t : t.output ?? [];
        return (v as unknown[]).flat(3)[0] as number;
      });
      trainings.push({ loss: body.finalLoss, outputs, epochs: body.epochs ?? 0 });
    });
    await page.goto("/?tour=pnl-learning");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-learning-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(trainings.length, "two trainings").toBe(2);
    const [slow, fast] = trainings;
    expect(slow.epochs).toBe(250);
    expect(slow.loss, "error at target, default rate").toBeCloseTo(0.255, 2);
    for (const o of slow.outputs) expect(o, "every output near one half").toBeCloseTo(0.5, 1);
    expect(fast.epochs).toBe(300);
    expect(fast.loss, "error at target, rate 3").toBeLessThan(0.002);
    const want = [0.035, 0.96, 0.963, 0.044];
    fast.outputs.forEach((o, i) => expect(o, `output ${i + 1}`).toBeCloseTo(want[i], 2));
  });
});
