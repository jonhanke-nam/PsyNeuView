/**
 * The walkthroughs are discoverable (#1181).
 *
 * Until the menu existed, `?tour=<id>` was the only way in — which meant
 * nobody found a walkthrough without being told the parameter. This drives the
 * route an actual user takes: open the app, open the menu, pick one.
 *
 * Deliberately starts with **no** query parameter, because that is the whole
 * claim being tested.
 */
import { readOnlyTest as test, expect, showCourse } from "../test-base";
import { loadWalkthrough } from "../tourDriver";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/tour",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

const demo = loadWalkthrough("demo");

test.use({ viewport: { width: 1600, height: 1000 } });

// The course is hidden by default (#136); this spec needs it in the menu.
test.beforeEach(async ({ page }) => showCourse(page));

test.describe("Guided walkthroughs are discoverable", () => {
  test("the Tutorials menu lists them and starts one", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("open-menu").click();
    await page.getByText(demo.model!).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });

    // Nothing running yet — no parameter was passed.
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);

    await page.getByTestId("walkthrough-menu").click();
    const list = page.getByTestId("walkthrough-menu-list");
    await expect(list).toBeVisible();
    await page.screenshot({ path: shot("menu.png") });

    // Two sections: the general walkthroughs, then the course's in the
    // course's own lesson order (0.1 Vectors ... 8.1 ISC-CI), read off the
    // screen in the order they're drawn.
    const general = list.getByTestId("walkthrough-group-general");
    for (const id of ["demo", "build", "run"]) {
      await expect(general.getByTestId(`walkthrough-${id}`)).toBeVisible();
    }
    const course = list.getByTestId("walkthrough-group-course");
    await expect(course).toContainText("Cognitive Neuroscience Course");
    const courseIds = await course
      .locator('[data-testid^="walkthrough-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("walkthrough-", "")));
    expect(courseIds).toEqual([
      "vectors", "logistic", "perceptron", "hebbian", "hopfield", "dynamics", "ddm", "td", "semantic", "memory",
      "ego", "stroop", "conflict", "iscci",
    ]);
    await expect(course.getByTestId("walkthrough-perceptron")).toContainText("0.3");

    // The canvas height before a walkthrough is running.
    const canvas = page.getByTestId("graph-canvas-viewport");
    const heightBefore = (await canvas.boundingBox())!.height;

    await list.getByTestId("walkthrough-demo").click();
    await expect(page.getByTestId("tour-instruction")).toHaveText(demo.steps[0].instruct, {
      timeout: 15000,
    });

    // The bar RESERVES space rather than covering the app (#1181): the canvas
    // gets shorter, so nothing the learner needs is hidden behind the
    // instruction they are trying to follow. This is the whole claim of the
    // reserved region, and the thing most likely to regress into an overlay.
    await expect(page.getByTestId("tour-bar")).toBeVisible();
    await page.waitForTimeout(300);
    const heightDuring = (await canvas.boundingBox())!.height;
    expect(
      heightBefore - heightDuring,
      "the canvas should shrink to make room for the walkthrough bar",
    ).toBeGreaterThan(8);
    await page.screenshot({ path: shot("reserved-region.png") });

    // A learner who started one by accident can leave without reloading.
    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toHaveCount(0);
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);

    // ...the space comes back...
    await page.waitForTimeout(300);
    expect((await canvas.boundingBox())!.height).toBeCloseTo(heightBefore, 0);

    // ...and the model they were working on is still there.
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
  });
});
