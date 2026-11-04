/**
 * Undo after a composition frame button (#194): Enter, Inset and Collapse.
 *
 * Each press rebuilds the graph in another view and records a History step.
 * Undoing that step has to put the view back as well as the nodes: before,
 * the earlier nodes came back under the later settings, so the breadcrumb,
 * the view menu and the frame buttons said one thing and the canvas another,
 * and after Enter-then-leave there was no breadcrumb and no frame to leave by.
 *
 * Tried on the EGO model's EM composition, as the frame buttons' own tests are.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

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
  await Promise.all([loaded(page), button.click()]);
}

/** Undo or redo one step; the step's view is rebuilt from the file. */
async function step(page: Page, which: "undo" | "redo") {
  const button = page.getByTestId(`${which}-button`);
  await expect(button).toBeEnabled();
  await Promise.all([loaded(page), button.click()]);
}

const frame = (page: Page, label: string) =>
  page.getByTestId("graph-canvas").locator(`.react-flow__node-compositionNode[data-id="${label}"], .react-flow__node-compositionNode[data-id="cluster::${label}"]`);
const canvasText = (page: Page, text: string) => page.getByTestId("graph-canvas").getByText(text, { exact: true });
const crumb = (page: Page) => page.getByRole("button", { name: /Full model/ });
const frameButton = (page: Page, name: RegExp) => page.getByTestId("graph-canvas").getByRole("button", { name });

test.describe("undo after a composition frame button (#194)", { tag: "@ci" }, () => {
  test("Enter, then Undo: the flattened view again, with EM's frame; Redo enters again", async ({ page }) => {
    await openFromPath(page, EGO);
    await expect(frame(page, "EM")).toBeVisible();
    await press(page, /^Enter composition EM$/);
    await expect(crumb(page)).toBeVisible({ timeout: 15_000 });
    await expect(canvasText(page, "PREDICTION")).toHaveCount(0);

    // Undo: out of EM, back in the flattened view, with the frame and its
    // buttons, and no breadcrumb. Before, the breadcrumb stayed and the view
    // menu still said EM.
    await step(page, "undo");
    await expect(canvasText(page, "PREDICTION")).toBeVisible({ timeout: 15_000 });
    await expect(frame(page, "EM")).toBeVisible();
    await expect(frameButton(page, /^Enter composition EM$/)).toBeVisible();
    await expect(crumb(page)).toHaveCount(0);
    await expect(viewMenu(page)).toHaveValue("__flat__");

    // Redo: inside EM again, breadcrumb and all.
    await step(page, "redo");
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible({ timeout: 15_000 });
    await expect(canvasText(page, "PREDICTION")).toHaveCount(0);
    await expect(crumb(page)).toBeVisible();
    await expect(viewMenu(page).locator("option:checked")).toContainText("EM");

    // Leave by the breadcrumb, then undo that: inside EM, with the breadcrumb
    // to leave by. This was the canvas with no way out.
    await Promise.all([loaded(page), crumb(page).click()]);
    await expect(canvasText(page, "PREDICTION")).toBeVisible({ timeout: 15_000 });
    await step(page, "undo");
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible({ timeout: 15_000 });
    await expect(canvasText(page, "PREDICTION")).toHaveCount(0);
    await expect(crumb(page)).toBeVisible();
    // And it still leads back to the flattened view it was entered from.
    await Promise.all([loaded(page), crumb(page).click()]);
    await expect(frame(page, "EM")).toBeVisible({ timeout: 15_000 });
    await expect(viewMenu(page)).toHaveValue("__flat__");
  });

  test("Collapse, then Undo: EM open in the flattened view again; Redo folds it", async ({ page }) => {
    await openFromPath(page, EGO);
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible();
    await press(page, /^Collapse composition EM$/);
    const folded = page.getByTestId("graph-canvas").locator('.react-flow__node-mechanismNode[data-id="EM"]');
    await expect(folded).toBeVisible({ timeout: 15_000 });
    await expect(viewMenu(page)).not.toHaveValue("__flat__");

    // Undo: the flattened view, EM open with its buttons. Before, the nodes
    // came back but the view menu said nested and EM stayed marked folded,
    // so the next rebuild folded it by surprise.
    await step(page, "undo");
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible({ timeout: 15_000 });
    await expect(folded).toHaveCount(0);
    await expect(frame(page, "EM")).toBeVisible();
    await expect(frameButton(page, /^Collapse composition EM$/)).toBeVisible();
    await expect(viewMenu(page)).toHaveValue("__flat__");

    await step(page, "redo");
    await expect(folded).toBeVisible({ timeout: 15_000 });
    await expect(canvasText(page, "COMBINED SCORES")).toHaveCount(0);
    await expect(viewMenu(page)).not.toHaveValue("__flat__");
  });

  test("Inset, then Undo: EM nested and open again; Redo insets it", async ({ page }) => {
    await openFromPath(page, EGO);
    // Inset belongs to the nested view, where EM opens folded (#395).
    const menu = viewMenu(page);
    const nested = await menu.locator("option").filter({ hasText: /^EGO$/ }).first().getAttribute("value");
    await Promise.all([loaded(page), menu.selectOption(nested!)]);
    await press(page, /^Expand composition EM$/);
    const inset = frameButton(page, /^Inset composition EM$/);
    await expect(inset).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    const border = () => frame(page, "EM").locator("> div").first().evaluate((el) => getComputedStyle(el).borderTopStyle);

    await press(page, /^Inset composition EM$/);
    await expect(inset).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    expect(await border()).toBe("solid");

    // Undo: EM open and nested, not inset. Before, the inset press was not a
    // step at all (same code, same node count), so Undo went back to EM
    // folded while the settings still said open and inset.
    await step(page, "undo");
    await expect(inset).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    await expect(frame(page, "EM")).toBeVisible();
    await expect(canvasText(page, "COMBINED SCORES")).toBeVisible();
    expect(await border()).toBe("dashed");

    await step(page, "redo");
    await expect(inset).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    expect(await border()).toBe("solid");
  });
});
