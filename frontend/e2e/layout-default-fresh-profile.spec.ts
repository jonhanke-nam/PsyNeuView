import { test, expect } from "@playwright/test";
import { readOnlyTest } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

/**
 * #55: a fresh install opens models Like show_graph.
 *
 * A screenshot capture once opened EGO in Layered. The cause was the capture's
 * setup, not the app: the shared e2e setup (`test-base.ts`) stores Layered as
 * the automatic layout, because the suite and its screenshots were written
 * against Layered. A real first run has no stored setting at all.
 *
 * So this spec deliberately does NOT use the shared setup. It starts from
 * Playwright's own empty browser profile, the closest thing to a new user,
 * and opens the same model the capture did. The second test pins the other
 * half of the explanation: the shared setup stores Layered. If someone ever
 * changes that, captures change too, and this says why.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EGO = path.resolve(__dirname, "../../backend/demos/ego_coffee_shop.py");
const KEY = "psyneuview.graph.layoutDefault";

test("an empty browser profile opens EGO Like show_graph @ci", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });
  // Nothing stored: this really is a first run.
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();

  // A first run offers the orientation; put it off.
  const later = page.getByTestId("orientation-offer-later");
  if (await later.isVisible().catch(() => false)) await later.click();

  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(EGO);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 90000 });

  // The toolbar's layout menu says Like show_graph, and show_graph's own edge
  // courses are drawn (they appear only once its layout arrived).
  await expect(page.locator('select:has(option[value="showgraph"])')).toHaveValue("showgraph");
  await expect(page.locator(".react-flow__edge path.pnv-edge-showgraph").first()).toBeVisible({ timeout: 60000 });
  // Opening the model didn't store a layout choice either.
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

readOnlyTest("the shared e2e setup stores Layered, which is why its captures open Layered @ci", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("layered");
});
