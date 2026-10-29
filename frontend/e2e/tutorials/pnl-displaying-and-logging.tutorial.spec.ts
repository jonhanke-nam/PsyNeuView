/**
 * PsyNeuLink Tutorials, lesson 12: Displaying and logging values — every
 * execution, step by step (#9).
 *
 * Driven from `src/walkthroughs/pnl-displaying-and-logging.yaml`, the file
 * the app reads, so the walkthrough can't drift from the app. It opens the
 * Stroop With Control demo, runs the four trials, steps the trace, and opens
 * Run State. This asserts what the lesson says the log holds: every node of
 * the run logged, TASK ten times a trial and the Conflict Monitor once,
 * read from the run's own logs.
 *
 * Also checks the Tutorials menu lists the lesson after lesson 11, numbered 12.
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

const lesson = loadWalkthrough("pnl-displaying-and-logging");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed after lesson 11 under PsyNeuLink Tutorials, as lesson 12", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const section = page.getByTestId("walkthrough-menu-list").getByTestId("walkthrough-group-psyneulink");
    await expect(section).toBeVisible();
    const rows = await section
      .locator('[data-testid^="walkthrough-pnl-"]')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    const at = rows.findIndex((r) => r.includes(`12. ${lesson.title}`));
    expect(at, "lesson 12 is in the menu").toBeGreaterThan(-1);
    expect(rows.findIndex((r) => r.includes("11. ")), "after lesson 11").toBeLessThan(at);
  });

  test("logs every node, TASK ten times a trial, and steps through it", async ({ page }) => {
    const logs: Record<string, { values: unknown[] }>[] = [];
    page.on("response", async (r) => {
      if (r.request().method() !== "POST" || !r.ok() || !r.url().includes("/api/model/run")) return;
      const body = (await r.json().catch(() => null)) as { logs?: Record<string, { values: unknown[] }> } | null;
      if (body?.logs) logs.push(body.logs);
    });
    await page.goto("/?tour=pnl-displaying-and-logging");
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-displaying-and-logging-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    expect(logs.length, "one run").toBe(1);
    const log = logs[0];
    const count = (name: string) => log[Object.keys(log).find((k) => k === name || k.startsWith(`${name}-`))!]?.values.length;
    for (const node of ["COLOR INPUT", "WORD INPUT", "TASK INPUT", "TASK", "COLOR HIDDEN", "WORD HIDDEN", "OUTPUT", "DECISION", "Conflict Monitor"]) {
      expect(count(node), `${node} is logged`).toBeGreaterThan(0);
    }
    expect(count("TASK"), "TASK: ten executions in each of four trials").toBe(40);
    expect(count("OUTPUT"), "OUTPUT: once a trial").toBe(4);
    expect(count("Conflict Monitor"), "the Conflict Monitor: once a trial").toBe(4);
  });
});
