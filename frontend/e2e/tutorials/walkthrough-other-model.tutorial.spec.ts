/**
 * Starting a walkthrough with a different model open (#1224).
 *
 * The walkthroughs were only ever tested on a fresh app with the right model
 * already loaded. A learner who picked "Selecting nodes" from the menu with
 * another model open got an instruction pointing at a node that wasn't there,
 * and nothing to do. Now the walkthrough opens its model, or, when it can't,
 * says what's missing and offers to open it. Replacing unsaved work offers to
 * save it first (#172).
 */
import { mutatingTest as test, expect, canvasNode } from "../test-base";
import { loadWalkthrough } from "../tourDriver";

const demo = loadWalkthrough("demo");
const OTHER = "Bistable Attractor";

test.use({ viewport: { width: 1600, height: 1000 } });

async function openOther(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByRole("button", { name: OTHER, exact: true }).click();
  await expect(canvasNode(page, "node_attract1")).toBeVisible({ timeout: 30000 });
}

async function startDemo(page: import("@playwright/test").Page) {
  await page.getByTestId("walkthrough-menu").click();
  await page.getByTestId("walkthrough-demo").click();
  await expect(page.getByTestId("tour-bar")).toBeVisible();
}

// With unsaved work open, starting one asks where (#172): replace it here,
// then save the work first or not.
async function startDemoHere(page: import("@playwright/test").Page, unsaved: "save" | "discard") {
  await page.getByTestId("walkthrough-menu").click();
  await page.getByTestId("walkthrough-demo").click();
  await page.getByTestId("tutorial-choice-here").click();
  await expect(page.getByTestId("tutorial-choice")).toContainText("Save your changes first?");
  await page.getByTestId(unsaved === "save" ? "tutorial-choice-save" : "tutorial-choice-discard").click();
  await expect(page.getByTestId("tour-bar")).toBeVisible();
}

test.describe("A walkthrough started with another model open", () => {
  test("opens its own model", async ({ page }) => {
    await openOther(page);
    await startDemo(page);
    // Stroop — Basic, the model the walkthrough was written for.
    // Present, not necessarily on screen: a zoom saved with the model can put
    // it outside the viewport, where React Flow hides it.
    await expect(canvasNode(page, "color_hidden")).toHaveCount(1, { timeout: 30000 });
    // Off-screen, the walkthrough offers to fit the graph instead of drawing
    // its ring, and a learner would take it (as runWalkthrough does).
    const fit = page.getByTestId("tour-fit");
    await expect(page.getByTestId("tour-overlay").or(fit).first()).toBeVisible();
    if (await fit.isVisible()) await fit.click();
    await expect(page.getByTestId("tour-overlay")).toBeVisible();
    await expect(page.getByTestId("tour-missing-anchor")).toHaveCount(0);
  });

  test("with unsaved changes, Replace saves them first when asked", async ({ page }) => {
    await openOther(page);
    // Unsaved changes: typed, not saved.
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type("  # an edit");
    await expect(page.getByTestId("unsaved-dot")).toBeVisible();

    // No "unsaved changes will be lost" prompt follows the save.
    page.on("dialog", (d) => {
      throw new Error(`unexpected prompt: ${d.message()}`);
    });
    await startDemoHere(page, "save");
    await expect(canvasNode(page, "color_hidden")).toHaveCount(1, { timeout: 30000 });
    await expect(page.getByTestId("tour-missing-anchor")).toHaveCount(0);
  });

  test("a slow open isn't overwritten by the old model's pending preview", async ({ page }) => {
    // The typed edit schedules a canvas preview 1.5s later. CI's open takes
    // longer than that, so the preview of the OLD file went out mid-open, and
    // the backend (one worker) answered it after the open — putting the old
    // graph back under the new file's source. Recreate that order for certain:
    // the open answers after 3s, the stale preview after 5s.
    await openOther(page);
    await page.route("**/api/reference-models/load", async (route) => {
      const resp = await route.fetch();
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ response: resp });
    });
    await page.route("**/api/model/preview", async (route) => {
      await new Promise((r) => setTimeout(r, 5000));
      await route.continue().catch(() => {}); // an aborted preview is fine
    });
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type("  # an edit");

    await startDemoHere(page, "discard"); // discard my edit, open the model
    await expect(canvasNode(page, "color_hidden")).toBeVisible({ timeout: 30000 });
    // Past the moment the stale preview would have answered.
    await page.waitForTimeout(5000);
    await expect(canvasNode(page, "color_hidden")).toBeVisible();
    await expect(canvasNode(page, "node_attract1")).toHaveCount(0);
  });

  test("with no model lists to open from, says the model didn't open", async ({ page }) => {
    // What a stopped server looks like to the walkthrough: empty catalog lists.
    // The Open button used to do nothing here, and say nothing.
    await page.route("**/api/reference-models", (r) => r.fulfill({ json: { models: [] } }));
    await page.route("**/api/demos", (r) => r.fulfill({ json: { demos: [] } }));
    await page.goto("/");
    await startDemo(page);

    const missing = page.getByTestId("tour-missing-anchor");
    await expect(missing).toBeVisible();
    await expect(missing).toContainText("color_hidden");
    await expect(missing).toContainText(demo.model!);
    // #1393: shown as a red, boxed warning with a sign, not as more instruction.
    const warning = page.getByTestId("tour-warning");
    await expect(page.getByTestId("tour-warning-icon")).toHaveText("⚠");
    const look = await warning.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderTopStyle, borderColor: cs.borderTopColor, color: cs.color, bg: cs.backgroundColor };
    });
    expect(look.border).toBe("solid");
    expect(look.borderColor).toBe(look.color);
    expect(look.bg).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.getByTestId("tour-open-failed")).toHaveCount(0);
    await page.getByTestId("tour-open-model").click();
    const failed = page.getByTestId("tour-open-failed");
    await expect(failed).toBeVisible();
    await expect(failed).toContainText(demo.model!);
    await expect(failed).toContainText("server is running");
  });
});
