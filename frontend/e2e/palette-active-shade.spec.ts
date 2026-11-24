/**
 * Components panel: the active item is shaded as well as outlined (#387).
 *
 * The strip icon whose menu is open, and a component picked up for placing
 * (in the word list, in a strip menu, or as a strip shortcut), take the
 * selection fill behind them as well as the selection outline, so it is
 * obvious which one is active. Hover is lighter than active, so the two never
 * look the same.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

async function open(page: Page, start: "strip" | "open") {
  await page.addInitScript((start) => localStorage.setItem("psyneuview.components.start", start), start);
  const dir = mkdtempSync(path.join(tmpdir(), "shade387-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, readFileSync(fixturePath("two_mech_projection"), "utf8"));
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("palette-sidebar")).toBeVisible();
}

/** What a colour token resolves to, as a computed background colour. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  }, name);
}

const bg = (el: Locator) => el.evaluate((e) => getComputedStyle(e).backgroundColor);

/** Relative brightness of a computed colour, 0 to 255. A colour-mix()
 *  token computes as `color(srgb r g b)` with channels 0 to 1, not rgb(). */
function brightness(c: string): number {
  const scale = c.startsWith("color(srgb") ? 255 : 1;
  const [r, g, b] = c.replace(/^color\(srgb/, "").match(/[\d.]+/g)!.map((n) => Number(n) * scale);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

test.describe("Components panel shades the active item (#387)", { tag: "@ci" }, () => {
  test("the open category's strip icon and a picked-up flyout row are shaded; others are not", async ({ page }) => {
    await open(page, "strip");
    const fill = await token(page, "--pnv-selection-fill");
    const surface = await token(page, "--pnv-surface");
    const ring = await token(page, "--pnv-selection-border");
    expect(fill).not.toBe(surface);

    const palette = page.getByTestId("palette-sidebar");
    const categories = palette.getByTestId("palette-category");
    await expect(categories).toHaveCount(4);
    await categories.first().click();
    const flyout = page.getByTestId("palette-compact-flyout");
    await expect(flyout).toBeVisible();

    // The active icon: the selection fill and the selection outline.
    expect(await bg(categories.first())).toBe(fill);
    expect(await categories.first().evaluate((e) => getComputedStyle(e).borderTopColor)).toBe(ring);
    // A category whose menu is not open keeps the plain surface.
    expect(await bg(categories.nth(1))).toBe(surface);
    // No size change.
    expect(await categories.first().boundingBox()).toMatchObject({ width: 32, height: 32 });

    // Pick up a component from the menu: its row takes the same fill.
    const row = flyout.getByTestId("palette-item").first();
    await row.click();
    await expect(row).toHaveAttribute("data-armed", "true");
    await page.mouse.move(600, 500);
    expect(await bg(row)).toBe(fill);

    // Hovering another row in the menu tints it, lighter than the active fill.
    const other = flyout.getByTestId("palette-flyout-branch").first();
    await other.hover();
    const hover = await bg(other);
    expect(hover).not.toBe(fill);
    expect(brightness(hover)).toBeGreaterThan(brightness(fill));
    // Hovering the armed row keeps it at the active fill.
    await row.hover();
    expect(await bg(row)).toBe(fill);
  });

  test("a picked-up row in the word list is shaded, and hover is lighter", async ({ page }) => {
    await open(page, "open");
    const fill = await token(page, "--pnv-selection-fill");
    await page.getByPlaceholder("Search components…").fill("DDM");
    const row = page.locator('[data-testid="palette-item"][data-type="DDM"]').first();
    await expect(row).toBeVisible();

    await row.hover();
    const hover = await bg(row);
    expect(brightness(hover)).toBeGreaterThan(brightness(fill));

    await row.click();
    await expect(row).toHaveAttribute("data-armed", "true");
    expect(await bg(row)).toBe(fill);
    await page.mouse.move(600, 500);
    expect(await bg(row)).toBe(fill);
  });
});
