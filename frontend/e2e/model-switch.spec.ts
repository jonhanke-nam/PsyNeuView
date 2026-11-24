/**
 * Switching models always replaces what is shown (#386).
 *
 * Seen first after opening Cohen & Huston (1994): choosing another model left
 * the previous one on screen. Two causes. A model that failed to build kept the
 * previous model's graph, title and Inspector up, under a note that it was "the
 * last version that built" — a hold meant only for the same file mid-edit
 * (#1030). And opens were applied in whatever order their answers arrived, so a
 * slower earlier open could land after a newer one.
 *
 * Each switch here checks the graph's nodes, the code and the title all belong
 * to the model just chosen, through Open from path, the PsyNeuLink Library,
 * the Recent list, and a quick second switch whose first answer is held back
 * until the second has been shown.
 */
import { mutatingTest as test, expect } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { fixturePath } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", "..", "backend", "reference_models");
const model = (file: string) => path.join(MODELS_DIR, file);

interface Expected {
  /** Text the title (the model name in the toolbar) shows. */
  title: string;
  /** Nodes the graph must draw. */
  nodes: string[];
  /** Nodes of an earlier model that must be gone. */
  gone?: string[];
  /** Text the code editor holds. */
  code: string;
}

const COHEN_HUSTON: Expected = {
  title: "Bidirectional Stroop Model",
  nodes: ["TASK DEMAND", "COLOR HIDDEN"],
  code: "Cohen_Huston1994.py",
};
// Same nodes and arrows as Cohen & Huston: only the title and code tell them apart.
const CONFLICT_MONITORING: Expected = {
  title: "CONFLICT MONITORING_SYSTEM",
  nodes: ["TASK DEMAND", "COLOR HIDDEN"],
  // Opened from the PsyNeuLink Library: the upstream file, no vendored header.
  code: "Conflict monitoring and cognitive control",
};
const GILZENRAT: Expected = {
  title: "Composition",
  nodes: ["LC", "DECISION LAYER"],
  gone: ["TASK DEMAND"],
  code: "GilzenratModel.py",
};
const STROOP: Expected = {
  title: "stroop_model",
  nodes: ["color_input", "decision"],
  gone: ["TASK DEMAND", "LC"],
  code: "Model: stroop_basic",
};

function openMenu(page: Page) {
  return page.getByTestId("open-menu").click();
}

async function openFromPath(page: Page, file: string) {
  await openMenu(page);
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
}

async function expectShowing(page: Page, want: Expected) {
  const canvas = page.getByTestId("graph-canvas");
  await expect(page.getByTestId("model-name")).toContainText(want.title, { timeout: 60_000 });
  for (const id of want.nodes) {
    await expect(canvas.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
  }
  for (const id of want.gone ?? []) {
    await expect(canvas.locator(`.react-flow__node[data-id="${id}"]`)).toHaveCount(0);
  }
  await expect(page.locator(".cm-content")).toContainText(want.code);
}

test.describe("switching models (#386)", () => {
  test("every switch replaces the graph, the code and the title", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");

    await openFromPath(page, model("Cohen_Huston1994.py"));
    await expectShowing(page, COHEN_HUSTON);

    // The PsyNeuLink Library section of the Open menu.
    await openMenu(page);
    await page
      .getByTestId("open-menu-list")
      .locator('button[title$="library/models/Botvinick_conflict_monitoring_model.py"]')
      .first()
      .click();
    await expectShowing(page, CONFLICT_MONITORING);

    await openFromPath(page, model("GilzenratModel.py"));
    await expectShowing(page, GILZENRAT);

    // Recent files: the History zone closes the menu, so it is the last entry
    // titled with this path (the bundled catalog lists the same file higher up).
    await openMenu(page);
    await expect(page.getByTestId("open-menu-section-recent")).toBeVisible();
    await page.getByTestId("open-menu-list").locator(`button[title="${model("Cohen_Huston1994.py")}"]`).last().click();
    await expectShowing(page, { ...COHEN_HUSTON, gone: ["LC"] });

    // A quick second switch, with the first one's answer held back until the
    // second has been shown: the older answer arriving last must be dropped.
    let release: () => void = () => {};
    const released = new Promise<void>((r) => { release = r; });
    let heldDone: () => void = () => {};
    const heldAnswered = new Promise<void>((r) => { heldDone = r; });
    await page.route("**/api/model/load", async (route) => {
      if (!(route.request().postData() ?? "").includes("Nieuwenhuis2005Model.py")) return route.continue();
      const answer = await route.fetch();
      await released;
      await route.fulfill({ response: answer });
      heldDone();
    });
    await openFromPath(page, model("Nieuwenhuis2005Model.py"));
    await openFromPath(page, model("stroop_reference_basic.py"));
    await expectShowing(page, STROOP);
    release();
    await heldAnswered;
    // Give the late answer every chance to be (wrongly) applied.
    await page.waitForTimeout(1000);
    await expectShowing(page, STROOP);
  });

  test("a model that fails to build, or a file that won't open, never leaves the old model looking current", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await openFromPath(page, model("Cohen_Huston1994.py"));
    await expectShowing(page, COHEN_HUSTON);

    // Opens, but does not build: the old graph and title go; its error shows.
    await openFromPath(page, fixturePath("does_not_build"));
    const canvas = page.getByTestId("graph-canvas");
    await expect(page.getByTestId("model-name")).toContainText("does_not_build.py", { timeout: 60_000 });
    await expect(page.getByTestId("model-name")).not.toContainText(COHEN_HUSTON.title);
    await expect(canvas.locator(".react-flow__node")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText('raise RuntimeError("this model does not build")');
    await expect(page.getByText("this model does not build").first()).toBeVisible();
    await expect(page.getByText("Showing the last version that built")).toHaveCount(0);

    // A file that can't be opened at all: nothing new is open, and the banner
    // over the graph says which model still is (#401).
    await openFromPath(page, model("GilzenratModel.py"));
    await expectShowing(page, GILZENRAT);
    await openFromPath(page, model("no_such_model.py"));
    await expect(page.getByTestId("failed-open-message")).toContainText(
      /Couldn't open no_such_model\.py: .*Still showing GilzenratModel\.py\./,
    );
    await expectShowing(page, GILZENRAT);
  });
});
