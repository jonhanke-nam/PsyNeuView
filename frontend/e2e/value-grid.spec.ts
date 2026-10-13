/**
 * A layer's values as a grid (#1387).
 *
 * The Hopfield demo's layer is 25 units, a 5×5 letter. Shown as a grid, the
 * noisy Z's four wrong pixels are visible, stepping the trace redraws the
 * grid (Run State and the value pill), and the choice is kept in the model's
 * layout file, so it is still a grid when the model is opened again.
 *
 * Set VALUE_GRID_SHOTS to a folder to also save screenshots of each stage.
 */
import path from "path";
import type { Locator, Page } from "@playwright/test";
import { mutatingTest as test, expect } from "./test-base";

const SHOTS = process.env.VALUE_GRID_SHOTS;
async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await (target ?? page).screenshot({ path: path.join(SHOTS, name) });
}

/** The notebook's noisy Z, the demo's first trial. */
const CUE = [1, 1, 1, 1, 1, -1, 1, -1, 1, -1, -1, 1, 1, -1, 1, -1, 1, -1, 1, -1, 1, 1, 1, 1, 1];
const Z = [1, 1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1, -1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1, 1];

async function cellValues(grid: Locator): Promise<number[]> {
  return (await grid.locator(".value-grid-cell").evaluateAll((cells) =>
    cells.map((c) => (c as HTMLElement).dataset.value ?? ""),
  )).map(Number);
}

async function runModel(page: Page) {
  await page.getByTestId("tab-run").click();
  await page.getByRole("button", { name: /Run Model/ }).click();
  await expect(page.getByTestId("run-panel").getByText(/^Trial 6$/)).toBeVisible({ timeout: 60_000 });
}

test.describe("a layer's values as a grid (#1387)", { tag: "@ci" }, () => {
  test("the Hopfield letter as a grid: in the results, while stepping, and after reopening", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");

    // Open the demo, and note where its working copy is, to reopen it later.
    await page.getByTestId("open-menu").click();
    const reset = page.waitForResponse((r) => r.url().includes("/api/demos/reset") && r.ok());
    await page.getByRole("button", { name: "Hopfield Network", exact: true }).click();
    const workingPath: string = (await (await reset).json()).file_path;
    expect(workingPath).toMatch(/hopfield_network\.py$/);
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

    await runModel(page);
    const panel = page.getByTestId("run-panel");
    const toggle = page.getByTestId("run-value-view-hopfield");
    await expect(toggle).toBeVisible();
    // A list to start with: 25 numbers, no grid.
    await expect(page.getByTestId("run-trial-1-grid-hopfield")).toHaveCount(0);
    await shot(page, "01-list-mode-25-numbers.png");

    // The value pill at step 1, as numbers: its height is the one the grid keeps.
    const pill = page.getByTestId("value-pill-hopfield");
    await expect(pill).toBeVisible({ timeout: 15_000 });
    const listPillHeight = (await pill.boundingBox())!.height;
    const node = page.locator(".react-flow__node").filter({ has: pill });
    const listNodeBox = (await node.boundingBox())!;

    // Switch to the grid.
    await page.getByTestId("run-value-view-hopfield-grid").click();
    await expect(page.getByTestId("run-value-view-hopfield-grid")).toHaveAttribute("aria-pressed", "true");
    const trial1 = page.getByTestId("run-trial-1-grid-hopfield");
    const trial2 = page.getByTestId("run-trial-2-grid-hopfield");
    await expect(trial1).toBeVisible();
    // A perfect square, 25, is drawn 5 by 5.
    await expect(trial1).toHaveAttribute("data-rows", "5");
    await expect(trial1).toHaveAttribute("data-cols", "5");
    expect(await cellValues(trial1), "trial 1 is the noisy Z").toEqual(CUE);
    expect(await cellValues(trial2), "trial 2 is Z").toEqual(Z);
    // Values go from -1 to +1, so the scale is centred on 0: +1 dark, -1 light.
    await expect(page.getByTestId("run-value-legend-hopfield")).toContainText("-1");
    const shades = await trial2.locator(".value-grid-cell").evaluateAll((cells) =>
      cells.map((c) => getComputedStyle(c).backgroundColor),
    );
    expect(new Set(shades).size, "two shades for ±1").toBe(2);
    // A cell names its unit and value on hover.
    await expect(trial2.locator(".value-grid-cell").nth(6)).toHaveAttribute("title", /hopfield\[6\].*-1$/);
    await shot(page, "02-after-grid-in-run-results.png");

    // The pill draws the grid at its own height, so the node keeps its size.
    await expect(page.getByTestId("value-pill-grid-hopfield")).toBeVisible();
    expect(Math.abs((await pill.boundingBox())!.height - listPillHeight)).toBeLessThan(0.5);
    const gridNodeBox = (await node.boundingBox())!;
    expect(Math.abs(gridNodeBox.height - listNodeBox.height)).toBeLessThan(0.5);
    expect(Math.abs(gridNodeBox.width - listNodeBox.width)).toBeLessThan(0.5);

    // Run State: the same choice, and stepping redraws the grid.
    await page.getByTestId("tab-run-state").click();
    const stateGrid = page.getByTestId("runstate-value-grid-hopfield");
    await expect(stateGrid).toBeVisible();
    await expect(page.getByTestId("runstate-value-view-hopfield-grid")).toHaveAttribute("aria-pressed", "true");
    expect(await cellValues(stateGrid), "step 1: the cue").toEqual(CUE);
    await stateGrid.scrollIntoViewIfNeeded();
    await shot(page, "03-after-grid-in-run-state-step-1.png", page.getByTestId("panel-run-state"));
    await page.getByTestId("trace-next-step").click();
    await expect.poll(() => cellValues(stateGrid), { message: "step 2: Z" }).toEqual(Z);
    await stateGrid.scrollIntoViewIfNeeded();
    await shot(page, "04-after-mid-step-run-state-and-pill.png");
    // Hovering the pill shows the grid larger, with the step's trial.
    await pill.hover();
    if (SHOTS) {
      const b = (await node.boundingBox())!;
      await page.waitForTimeout(250);
      await page.screenshot({
        path: path.join(SHOTS, "05-after-value-pill-hover.png"),
        clip: { x: b.x - 20, y: b.y - 20, width: b.width + 40, height: b.height + 140 },
      });
    }
    await page.mouse.move(5, 5);

    // Width: 10 across makes it 3 rows, and it is kept too.
    const width = page.getByTestId("runstate-value-view-hopfield-width");
    await width.fill("10");
    await expect(stateGrid).toHaveAttribute("data-cols", "10");
    await expect(stateGrid).toHaveAttribute("data-rows", "3");
    await width.fill("5");
    await expect(stateGrid).toHaveAttribute("data-cols", "5");

    // Reopen the working copy: the grid is remembered from its layout file.
    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(workingPath);
    const load = page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok());
    await prompt.press("Enter");
    const loaded = await (await load).json();
    expect(loaded.layout?.valueViews?.hopfield).toEqual({ as: "grid", width: 5 });
    await page
      .getByRole("button", { name: /^Skip$/ })
      .click({ timeout: 3000 })
      .catch(() => {});
    await runModel(page);
    await expect(page.getByTestId("run-trial-2-grid-hopfield")).toBeVisible();
    expect(await cellValues(page.getByTestId("run-trial-2-grid-hopfield"))).toEqual(Z);

    // And back to a list.
    await page.getByTestId("run-value-view-hopfield-list").click();
    await expect(page.getByTestId("run-trial-2-grid-hopfield")).toHaveCount(0);
  });
});
