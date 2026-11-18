/**
 * A tutorial left part-way offers Resume at step N (#173): the step, and the
 * code as it began, in the tutorial's own copy of its model.
 *
 * "Selecting nodes" (two steps on Stroop — Basic, opened on start) is the
 * subject: step 2 is the only place to resume at.
 */
import { mutatingTest as test, expect, canvasNode } from "./test-base";
import type { Page } from "@playwright/test";

const PROGRESS_KEY = "psyneuview.tutorials.progress";

type TourTestState = {
  activeTourId: string | null;
  stepIndex: number;
  modelPath: string | null;
  filePath: string | null;
  source: string;
  savedSource: string;
};

const tourState = (page: Page) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate(() => (window as any).__pnvTourTest.state() as TourTestState);

async function pickSelecting(page: Page) {
  await page.getByTestId("walkthrough-menu").click();
  await page.getByTestId("walkthrough-demo").click();
}

async function modelReady(page: Page) {
  await expect.poll(async () => (await tourState(page)).modelPath, { timeout: 60_000 }).toContain("/tutorials/demo/");
  await expect.poll(async () => {
    const s = await tourState(page);
    return s.filePath === s.modelPath;
  }).toBe(true);
  await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 60_000 });
}

async function selectNode(page: Page, name: string) {
  const fit = page.getByTestId("tour-fit");
  if (await fit.isVisible()) await fit.click();
  await canvasNode(page, name).click();
}

/** Start it, edit and save the code on step 1, finish step 1, and leave on step 2. */
async function leaveOnStep2(page: Page, edit: string) {
  await pickSelecting(page);
  await expect(page.getByTestId("tour-bar")).toContainText("step 1 of 2");
  await modelReady(page);
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(`\n${edit}`);
  await page.getByTestId("toolbar-save").click();
  await expect.poll(async () => {
    const s = await tourState(page);
    return s.source === s.savedSource && s.source.includes(edit);
  }).toBe(true);
  await selectNode(page, "color_hidden");
  await expect(page.getByTestId("tour-bar")).toContainText("step 2 of 2", { timeout: 10_000 });
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), PROGRESS_KEY)).toContain('"step":1');
  await page.getByTestId("tour-dismiss").click();
  await expect(page.getByTestId("tour-bar")).toHaveCount(0);
}

async function expectResumed(page: Page, edit: string) {
  await expect(page.getByTestId("tutorial-choice")).toContainText('Resume "Selecting nodes" at step 2 of 2?');
  await page.getByTestId("tutorial-choice-resume").click();
  await expect(page.getByTestId("tour-bar")).toContainText("step 2 of 2");
  await modelReady(page);
  await expect.poll(async () => (await tourState(page)).savedSource, { timeout: 30_000 }).toContain(edit);
  // And the step carries on from there.
  await selectNode(page, "word_hidden");
  await expect(page.getByTestId("tour-bar")).toContainText("complete", { timeout: 10_000 });
}

test.describe("Resuming a tutorial", { tag: "@ci" }, () => {
  test("leave on a step, and resume there with its code", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await leaveOnStep2(page, "# made on step 1");
    await pickSelecting(page);
    await expectResumed(page, "# made on step 1");
  });

  test("resume after reloading the page", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await leaveOnStep2(page, "# before the reload");
    await page.reload();
    await pickSelecting(page);
    await expectResumed(page, "# before the reload");
  });

  test("Start over begins at step 1 with a fresh model, and forgets the place", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await leaveOnStep2(page, "# to be dropped");
    await pickSelecting(page);
    await page.getByTestId("tutorial-choice-over").click();
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of 2");
    await modelReady(page);
    await expect.poll(async () => (await tourState(page)).source, { timeout: 30_000 }).not.toContain("# to be dropped");
    expect(await page.evaluate((k) => localStorage.getItem(k), PROGRESS_KEY)).toBeNull();
  });

  test("a finished tutorial starts from the beginning next time", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await leaveOnStep2(page, "# finishing");
    await pickSelecting(page);
    await expectResumed(page, "# finishing");
    await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10_000 });
    expect(await page.evaluate((k) => localStorage.getItem(k), PROGRESS_KEY)).toBeNull();

    await pickSelecting(page);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of 2");
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
  });
});

test.describe("A saved place that no longer fits", { tag: "@ci" }, () => {
  test("a step the tutorial no longer has: says so, and starts over", async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          demo: { step: 1, stepId: "a-step-since-removed", steps: "x|a-step-since-removed", code: null, fresh: null, file: null, at: 0 },
        }),
      );
    }, PROGRESS_KEY);
    await page.goto("/");
    await pickSelecting(page);
    await expect(page.getByTestId("tour-notice")).toContainText('"Selecting nodes" changed since you left it');
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of 2");
  });

  test("a model that changed in an update: says so, and starts over", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await leaveOnStep2(page, "# on an older model");
    // As if the bundled model had changed since: its fingerprint no longer matches.
    await page.evaluate((key) => {
      const all = JSON.parse(localStorage.getItem(key)!);
      all.demo.fresh = "00000000";
      localStorage.setItem(key, JSON.stringify(all));
    }, PROGRESS_KEY);
    await pickSelecting(page);
    await page.getByTestId("tutorial-choice-resume").click();
    await expect(page.getByTestId("tour-notice")).toContainText('"Selecting nodes" changed since you left it', { timeout: 60_000 });
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of 2");
    await modelReady(page);
    await expect.poll(async () => (await tourState(page)).source).not.toContain("# on an older model");
  });
});
