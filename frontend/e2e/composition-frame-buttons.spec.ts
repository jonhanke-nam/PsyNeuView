/**
 * The three buttons on a composition frame (#194): Enter, Inset, Collapse.
 *
 * Each is tried once on the EGO model's EM composition, the box that prompted
 * the issue; the failure case uses the small nested fixture to stay quick.
 *
 *  - Enter shows only what is inside EM, and the breadcrumb leads back out to
 *    the view that was showing before (the default flattened one).
 *  - Collapse folds EM to a single node; Expand opens it again.
 *  - Inset frames EM as a sub-graph of its own, and a second press undoes it.
 *  - A rebuild that fails says so, shows the busy wheel while it runs, and
 *    leaves both the graph and the settings as they were. Before, it showed
 *    nothing and left the setting changed, so the next unrelated rebuild
 *    applied it by surprise.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { fixturePath } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EGO = path.resolve(__dirname, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py");

const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load"), { timeout: 60_000 });

async function openFromPath(page: Page, file: string) {
  await page.goto("/");
  await closePalette(page);
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await Promise.all([loaded(page), prompt.press("Enter")]);
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

/** The view menu: Flatten (all compositions), the compositions, PyTorch. */
const viewMenu = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();

/** Press a frame button by its aria-label and wait for the rebuild it starts. */
async function press(page: Page, name: RegExp) {
  const button = page.getByTestId("graph-canvas").getByRole("button", { name }).first();
  await expect(button).toBeVisible({ timeout: 15_000 });
  const [resp] = await Promise.all([loaded(page), button.click()]);
  return resp;
}

const frame = (page: Page, label: string) =>
  page.getByTestId("graph-canvas").locator(`.react-flow__node-compositionNode[data-id="${label}"], .react-flow__node-compositionNode[data-id="cluster::${label}"]`);
const canvasText = (page: Page, text: string) => page.getByTestId("graph-canvas").getByText(text, { exact: true });

test.describe("composition frame buttons (#194)", { tag: "@ci" }, () => {
  test("Enter shows only EM's members; the breadcrumb leads back out", async ({ page }) => {
    await openFromPath(page, EGO);
    await expect(frame(page, "EM")).toBeVisible();
    await expect(canvasText(page, "PREDICTION")).toBeVisible();

    await press(page, /^Enter composition EM$/);
    // Inside EM, and nothing of the rest of the model.
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible({ timeout: 15_000 });
    await expect(canvasText(page, "PREDICTION")).toHaveCount(0);
    await expect(frame(page, "EM")).toHaveCount(0);
    const crumb = page.getByRole("button", { name: /Full model/ });
    await expect(crumb).toBeVisible();
    await expect(crumb.locator("xpath=..")).toContainText("EM");
    // The view menu says where we are.
    await expect(viewMenu(page).locator("option:checked")).toContainText("EM");

    // Out again, to the flattened view that was showing before.
    await Promise.all([loaded(page), crumb.click()]);
    await expect(canvasText(page, "PREDICTION")).toBeVisible({ timeout: 15_000 });
    await expect(frame(page, "EM")).toBeVisible();
    await expect(crumb).toHaveCount(0);
    await expect(viewMenu(page)).toHaveValue("__flat__");
  });

  test("Collapse folds EM to a single node; Expand opens it again", async ({ page }) => {
    await openFromPath(page, EGO);
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible();

    await press(page, /^Collapse composition EM$/);
    const folded = page.getByTestId("graph-canvas").locator('.react-flow__node-mechanismNode[data-id="EM"]');
    await expect(folded).toBeVisible({ timeout: 15_000 });
    await expect(canvasText(page, "COMBINED SCORES")).toHaveCount(0);
    // The rest of the model is still there.
    await expect(canvasText(page, "PREDICTION")).toBeVisible();
    // Folding has no meaning in the flattened view, so the model is now nested
    // and the view menu says so.
    await expect(viewMenu(page)).not.toHaveValue("__flat__");

    await press(page, /^Expand composition EM$/);
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible({ timeout: 15_000 });
    await expect(folded).toHaveCount(0);
    await expect(frame(page, "EM")).toBeVisible();
  });

  test("Inset frames EM as a sub-graph of its own, and a second press undoes it", async ({ page }) => {
    await openFromPath(page, EGO);
    // Inset belongs to the nested view (a flattened view insets everything),
    // so show the model nested; EM opens folded there (#395).
    const menu = viewMenu(page);
    const nested = await menu.locator("option").filter({ hasText: /^EGO$/ }).first().getAttribute("value");
    await Promise.all([loaded(page), menu.selectOption(nested!)]);
    await press(page, /^Expand composition EM$/);

    const inset = page.getByTestId("graph-canvas").getByRole("button", { name: /^Inset composition EM$/ });
    await expect(inset).toBeVisible({ timeout: 15_000 });
    await expect(inset).toHaveAttribute("aria-pressed", "false");
    const border = () => frame(page, "EM").locator("> div").first().evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(await border()).toBe("dashed");

    await press(page, /^Inset composition EM$/);
    await expect(inset).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    expect(await border()).toBe("solid");
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible();

    await press(page, /^Inset composition EM$/);
    await expect(inset).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    expect(await border()).toBe("dashed");
  });

  test("a rebuild that fails says so and leaves the graph and the settings as they were", async ({ page }) => {
    await openFromPath(page, fixturePath("nested_minimal"));
    await expect(frame(page, "inner_comp")).toBeVisible();
    await expect(viewMenu(page)).toHaveValue("__flat__");

    // The next rebuild takes a moment, then fails.
    let failed = false;
    await page.route("**/api/model/load", async (route) => {
      if (failed) return route.continue();
      failed = true;
      await new Promise((r) => setTimeout(r, 700));
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "no can do" }) });
    });
    const wheel = page.locator("[data-testid=busy-indicator][data-visible=true]");
    const button = page.getByTestId("graph-canvas").getByRole("button", { name: /^Collapse composition inner_comp$/ });
    const done = loaded(page);
    await button.click();
    await expect(wheel).toBeVisible({ timeout: 5_000 });
    await done;

    await expect(page.getByText("Collapsing inner_comp failed: no can do. The graph is as it was.")).toBeVisible({ timeout: 10_000 });
    await expect(wheel).toBeHidden({ timeout: 5_000 });
    // The graph as it was: the frame is still open, with its buttons.
    await expect(frame(page, "inner_comp")).toBeVisible();
    await expect(canvasText(page, "inner_a")).toBeVisible();
    await expect(button).toBeVisible();
    // The settings as they were: still the flattened view (folding leaves it
    // only once the rebuild has succeeded).
    await expect(viewMenu(page)).toHaveValue("__flat__");

    // And the same press works once the server is back.
    await press(page, /^Collapse composition inner_comp$/);
    await expect(page.getByTestId("graph-canvas").locator('.react-flow__node-mechanismNode[data-id="inner_comp"]')).toBeVisible({ timeout: 15_000 });
    await expect(canvasText(page, "inner_a")).toHaveCount(0);
  });
});
