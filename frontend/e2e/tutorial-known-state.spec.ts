/**
 * A walkthrough and other work don't collide without asking (#172): opening
 * another model during one, and starting one with something in progress.
 */
import { mutatingTest as test, expect, LAYOUT_BOTTOM_VISIBLE_KEY, LAYOUT_CODE_VISIBLE_KEY, showCourse } from "./test-base";
import { BEFORE_WALKTHROUGH_KEY, GRAPH_ONLY, EVERYTHING, PALETTE_OPEN_KEY, expectPanels } from "./panels";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";

const OTHER = "Hopfield Network";

// The Stroop walkthrough is in the course, which is hidden by default (#136).
test.beforeEach(async ({ page }) => showCourse(page));

async function openFromMenu(page: Page, label: string) {
  if (!(await page.getByTestId("open-menu-list").isVisible())) await page.getByTestId("open-menu").click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function startStroop(page: Page) {
  await page.getByTestId("walkthrough-menu").click();
  await page.getByTestId("walkthrough-stroop").click();
}

async function inStroopTutorial(page: Page) {
  await page.goto("/");
  await startStroop(page);
  await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 60_000 });
}


test.describe("Opening a model during a tutorial", { tag: "@ci" }, () => {
  test("Stay here keeps the tutorial and its model", async ({ page }) => {
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    await expect(page.getByTestId("tutorial-choice")).toContainText("Hopfield Network");
    await page.screenshot({ path: process.env.TUTORIAL_SHOTS ? `${process.env.TUTORIAL_SHOTS}/1-opening-another-model.png` : undefined });
    await page.getByTestId("tutorial-choice-stay").click();
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
    await expect(page.getByText("Loaded demo: Hopfield Network")).toHaveCount(0);

    // Escape is Stay here too, and the question hides the tutorial's ring.
    await openFromMenu(page, OTHER);
    await expect(page.getByTestId("tour-highlight")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("Leave ends the tutorial and opens the model here", async ({ page }) => {
    test.setTimeout(120_000);
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    await page.getByTestId("tutorial-choice-here").click();
    await expect(page.getByTestId("tour-bar")).toHaveCount(0);
    await expect(page.getByText("Loaded demo: Hopfield Network")).toBeVisible({ timeout: 60_000 });
  });

  test("A new window opens the model, and the tutorial stays on its step", async ({ page, context }) => {
    test.setTimeout(120_000);
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    const [second] = await Promise.all([context.waitForEvent("page"), page.getByTestId("tutorial-choice-window").click()]);
    await expect(second.getByText("Loaded demo: Hopfield Network")).toBeVisible({ timeout: 60_000 });
    await expect(second.getByTestId("tour-bar")).toHaveCount(0);
    // Off the address, so reloading that window doesn't open it again.
    expect(new URL(second.url()).search).toBe("");
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
  });

  test("New Model is asked about too", async ({ page }) => {
    await inStroopTutorial(page);
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-new-model").click();
    await expect(page.getByTestId("tutorial-choice")).toContainText("a new model");
  });
});

test.describe("Starting a tutorial", { tag: "@ci" }, () => {
  test("Nothing in progress: it starts here without asking", async ({ page }) => {
    await page.goto("/");
    await startStroop(page);
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("A bundled model with no changes doesn't count as in progress", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await openFromMenu(page, OTHER);
    await expect(page.getByText("Loaded demo: Hopfield Network")).toBeVisible({ timeout: 60_000 });
    await startStroop(page);
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("Another tutorial running: a new window keeps it here", async ({ page, context }) => {
    test.setTimeout(120_000);
    await inStroopTutorial(page);
    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-orientation-editing").click();
    await expect(page.getByTestId("tutorial-choice")).toBeVisible();
    await page.screenshot({ path: process.env.TUTORIAL_SHOTS ? `${process.env.TUTORIAL_SHOTS}/2-starting-with-work-in-progress.png` : undefined });
    const [second] = await Promise.all([context.waitForEvent("page"), page.getByTestId("tutorial-choice-window").click()]);
    await expect(second.getByTestId("tour-bar")).toContainText("step 1 of");
    expect(new URL(second.url()).search).toContain("tour=orientation-editing");
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("Replace here starts it in this window; Cancel changes nothing", async ({ page }) => {
    await inStroopTutorial(page);
    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-orientation-editing").click();
    await page.getByTestId("tutorial-choice-cancel").click();
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    await expect(page.getByTestId("tour-bar")).toContainText("Stroop");

    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-orientation-editing").click();
    await page.getByTestId("tutorial-choice-here").click();
    await expect(page.getByTestId("tour-bar")).toContainText("Editing");
  });
});

// The Mac app's web view ignores window.open, so the page uses a bridge
// (PsyNeuView-MacApp#40). These stand in for the app, on either side of it.
test.describe("In the Mac app", { tag: "@ci" }, () => {
  test("with the bridge, the page asks the app for the window", async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.posted = [];
      w.webkit = { messageHandlers: { pnvOpenWindow: { postMessage: (m: unknown) => w.posted.push(m) } } };
      w.open = () => {
        w.posted.push("window.open");
        return null;
      };
    });
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    await page.getByTestId("tutorial-choice-window").click();
    await expect(page.getByTestId("tutorial-choice")).toHaveCount(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posted = await page.evaluate(() => (window as any).posted);
    const origin = new URL(page.url()).origin;
    expect(posted).toEqual([{ url: `${origin}/?openModel=Hopfield%20Network` }]);
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
  });

  test("an app too old to have it hides the choice, and the rest still works", async ({ page }) => {
    await page.addInitScript(() => {
      // An older app: its other bridges are there, this one isn't.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkit = { messageHandlers: { pnvPrefs: { postMessage: () => {} } } };
    });
    await inStroopTutorial(page);
    await openFromMenu(page, OTHER);
    const leave = page.getByTestId("tutorial-choice");
    await expect(leave).toContainText("can't open in a new window");
    await expect(page.getByTestId("tutorial-choice-window")).toHaveCount(0);
    await page.getByTestId("tutorial-choice-stay").click();
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");

    await page.getByTestId("walkthrough-menu").click();
    await page.getByTestId("walkthrough-orientation-editing").click();
    await expect(page.getByTestId("tutorial-choice")).toContainText("can't open a second window");
    await expect(page.getByTestId("tutorial-choice-window")).toHaveCount(0);
    await page.getByTestId("tutorial-choice-here").click();
    await expect(page.getByTestId("tour-bar")).toContainText("Editing");
  });
});

test.describe("A second window", { tag: "@ci" }, () => {
  test("doesn't take the layout a running tutorial will put back", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.addInitScript(
      ([code, bottom, palette, before]) => {
        // The first load only: the second window shares this storage.
        if (sessionStorage.getItem("seeded") || localStorage.getItem(before)) return;
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(code, "false");
        localStorage.setItem(bottom, "false");
        localStorage.setItem(palette, "false");
      },
      [LAYOUT_CODE_VISIBLE_KEY, LAYOUT_BOTTOM_VISIBLE_KEY, PALETTE_OPEN_KEY, BEFORE_WALKTHROUGH_KEY] as const,
    );
    await inStroopTutorial(page);
    await expectPanels(page, EVERYTHING);
    await openFromMenu(page, OTHER);
    const [second] = await Promise.all([context.waitForEvent("page"), page.getByTestId("tutorial-choice-window").click()]);

    // The new window is the learner's, so it has their layout, not the tutorial's.
    await expect(second.getByText("Loaded demo: Hopfield Network")).toBeVisible({ timeout: 60_000 });
    await expectPanels(second, GRAPH_ONLY);
    await second.close();

    await expectPanels(page, EVERYTHING);
    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toHaveCount(0);
    await expectPanels(page, GRAPH_ONLY);
  });
});

// A model file is a program and opening one runs it, so a link from another
// site must not be able to open a file just by naming it in the address.
test.describe("A file path in the address", { tag: "@ci" }, () => {
  test("opens nothing", async ({ page }) => {
    const loads: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/model/load")) loads.push(r.postData() ?? "");
    });
    await page.goto(`/?open=${encodeURIComponent("/tmp/from-a-link.py")}`);
    // A window acts on its request once the catalog lists are in: wait for those.
    await page.getByTestId("open-menu").click();
    await expect(page.getByRole("button", { name: OTHER, exact: true })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    expect(loads).toEqual([]);
  });

  test("a path chosen during a tutorial still opens in the new window", async ({ page, context }) => {
    test.setTimeout(120_000);
    const dir = mkdtempSync(path.join(tmpdir(), "pnv-known-state-"));
    const file = path.join(dir, "another model.py");
    writeFileSync(file, 'import psyneulink as pnl\nm = pnl.ProcessingMechanism(name="only")\nc = pnl.Composition(pathways=[m], name="c")\n');
    await inStroopTutorial(page);
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(file);
    await prompt.press("Enter");
    await expect(page.getByTestId("tutorial-choice")).toContainText("another model.py");
    const [second, load] = await Promise.all([
      context.waitForEvent("page"),
      context.waitForEvent("request", (r) => r.url().includes("/api/model/load"), { timeout: 60_000 }),
      page.getByTestId("tutorial-choice-window").click(),
    ]);
    expect(load.postDataJSON().file_path).toBe(file);
    // Off the address, and used up, so reloading doesn't open it again.
    await expect.poll(() => new URL(second.url()).search).toBe("");
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");
    rmSync(dir, { recursive: true, force: true });
  });
});
