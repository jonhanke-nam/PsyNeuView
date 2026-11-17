/**
 * Interface nodes (CIMs) appear as soon as the option is ticked (#257).
 *
 * Reported by a PsyNeuLink developer: Advanced Graph View Options ▸ Interface
 * nodes (CIMs) didn't show them until the model was saved, though unticking
 * hid them at once. The existing view-options test only checked that the box
 * flipped and the model reloaded, never that CIM nodes were drawn.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

const cims = (page: Page) => page.locator(".react-flow__node-cimNode");

async function openStroop(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText("Stroop").first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

async function setCims(page: Page, on: boolean) {
  await page.getByTestId("graph-view-options-button").click();
  const box = page.getByTestId("graph-view-option-cims");
  if ((await box.isChecked()) !== on) await box.click();
  await expect(box).toBeChecked({ checked: on });
  await page.keyboard.press("Escape");
}

test.describe("Interface nodes (CIMs) apply at once (#257)", { tag: "@ci" }, () => {
  test("ticking shows them and unticking hides them, with no save", async ({ page }) => {
    await openStroop(page);
    await expect(cims(page)).toHaveCount(0);

    await setCims(page, true);
    await expect(cims(page).first()).toBeVisible({ timeout: 15_000 });

    await setCims(page, false);
    await expect(cims(page)).toHaveCount(0, { timeout: 15_000 });
  });

  test("every load asks for the view on screen, so none switches it", async ({ page }) => {
    // The page's default view is flat and the backend's nested. A load that
    // didn't say which rebuilt the graph nested: that is how a save "fixed"
    // the missing CIMs.
    const views: (boolean | undefined)[] = [];
    page.on("request", (r) => {
      if (/\/api\/model\/(load|preview)$/.test(new URL(r.url()).pathname) && r.method() === "POST") {
        views.push(r.postDataJSON()?.flat);
      }
    });
    await openStroop(page);
    await setCims(page, true);
    await expect(cims(page).first()).toBeVisible({ timeout: 15_000 });
    await setCims(page, false);
    await expect(cims(page)).toHaveCount(0, { timeout: 15_000 });
    expect(views.length).toBeGreaterThan(1);
    expect(views.every((v) => typeof v === "boolean"), JSON.stringify(views)).toBe(true);
    expect(new Set(views).size, JSON.stringify(views)).toBe(1);
  });
});
