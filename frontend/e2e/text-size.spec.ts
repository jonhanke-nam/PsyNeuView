/**
 * A bigger font by default, and Settings ▸ Appearance ▸ Text size (#111).
 * Default puts body text at about 15 px (1.1 × the original 14 px); Small is
 * the original size, Large 1.2 ×. The choice applies at once, without a
 * reload, and is remembered.
 */
import { mutatingTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;
const bodyPx = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
const settingsTitlePx = (page: Page) =>
  page.getByTestId("settings-section-appearance").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

test("text size: larger by default, adjustable in Settings, remembered", { tag: "@ci" }, async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => bodyPx(page)).toBeCloseTo(15.4, 1);

  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-text-size")).toHaveValue("default");
  const atDefault = await settingsTitlePx(page);

  // Small: the original sizes, applied at once.
  await page.getByTestId("setting-text-size").selectOption("small");
  await expect.poll(() => bodyPx(page)).toBeCloseTo(14, 1);
  expect(await settingsTitlePx(page)).toBeLessThan(atDefault);

  // Large, remembered across a reload.
  await page.getByTestId("setting-text-size").selectOption("large");
  await expect.poll(() => bodyPx(page)).toBeCloseTo(16.8, 1);
  await page.reload();
  await expect.poll(() => bodyPx(page)).toBeCloseTo(16.8, 1);
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-text-size")).toHaveValue("large");
});
