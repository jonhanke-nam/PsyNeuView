/**
 * PsyNeuLink Tutorials, lesson 1: Creating a mechanism (#9).
 *
 * Driven from `src/walkthroughs/pnl-mechanism.yaml`, the file the app reads,
 * so the walkthrough can't drift from the app. It builds from New Model and
 * runs the notebook's four executions (2 with slope 1; 4 with slope 3; 3 with
 * slope 4 and intercept 5; -2 through a Logistic), and this asserts the
 * outputs the instructions quote: 2, 12, 17 and 0.119.
 *
 * Also checks the Tutorials menu lists the lesson under its own section,
 * between Getting started and the course.
 */
// mutatingTest: the walkthrough creates a model, so it needs a clean slate.
import { mutatingTest as test, expect, showCourse } from "../test-base";
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

const lesson = loadWalkthrough("pnl-mechanism");

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe(`PsyNeuLink Tutorials: ${lesson.title}`, () => {
  test("is listed under PsyNeuLink Tutorials, between Getting started and the course", async ({ page }) => {
    // The course is hidden by default (#136); show it to check the order.
    await showCourse(page);
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const list = page.getByTestId("walkthrough-menu-list");
    await expect(list).toBeVisible();
    const sectionIds = await list
      .locator('[data-testid^="walkthrough-group-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("walkthrough-group-", "")));
    expect(sectionIds).toEqual(["orientation", "general", "psyneulink", "course"]);
    const section = list.getByTestId("walkthrough-group-psyneulink");
    await expect(section).toContainText("PsyNeuLink Tutorials");
    await expect(section.getByTestId("walkthrough-pnl-mechanism")).toContainText(`1. ${lesson.title}`);
    await page.screenshot({ path: shot("pnl-menu.png") });
  });

  test("builds a mechanism, runs the notebook's numbers, and makes it Logistic", async ({ page }) => {
    // Keep every run's output: the canvas's value pill only shows while the
    // trace sits on a trial, so it can't be read back after the walkthrough.
    const outputs: number[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/model/run") && r.request().method() === "POST" && r.ok()) {
        const body = (await r.json().catch(() => null)) as { results?: { output: number[][] }[] } | null;
        const last = body?.results?.at(-1)?.output.flat().at(-1);
        if (typeof last === "number") outputs.push(last);
      }
    });
    await page.goto("/?tour=pnl-mechanism");
    // No model is opened: the first step creates one.
    await runWalkthrough(page, lesson, async (_step, index) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`pnl-mechanism-step-${index + 1}.png`) });
    });
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10000 });

    // The notebook's numbers, measured on the model's own output rather than
    // trusted from the instructions.
    expect(outputs.length, "four runs").toBe(4);
    expect(outputs[0], "slope 1, input 2").toBeCloseTo(2, 6);
    expect(outputs[1], "slope 3, input 4").toBeCloseTo(12, 6);
    expect(outputs[2], "slope 4, intercept 5, input 3").toBeCloseTo(17, 6);
    expect(outputs[3], "Logistic, input -2").toBeCloseTo(0.1192, 4);
  });
});
