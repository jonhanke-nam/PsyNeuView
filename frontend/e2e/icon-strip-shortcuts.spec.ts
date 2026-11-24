/**
 * The Components icon strip (#372).
 *
 * A fresh strip shows a tiny "Components" heading over the four category
 * menus and no shortcuts. Settings ▸ Appearance ▸ "Show favourite and
 * recently used components in the icon strip" brings the shortcuts back, at
 * the bottom under a tiny "Favourites & recent" heading, favourites first,
 * each once. The fold-out chevron is much smaller than a component icon. In
 * the word list, a row's empty ☆ shows only on hover or keyboard focus; a
 * starred row keeps its ★.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

const FAVOURITES = ["TransferMechanism"];
const RECENTS = ["DDM", "TransferMechanism", "MappingProjection"];

async function seed(page: Page, start: "strip" | "open") {
  await page.addInitScript(
    ({ favs, recents, start }) => {
      localStorage.setItem("psyneuview_palette_favorites", JSON.stringify(favs));
      localStorage.setItem("psyneuview_palette_recents", JSON.stringify(recents));
      localStorage.setItem("psyneuview.components.start", start);
    },
    { favs: FAVOURITES, recents: RECENTS, start },
  );
}

test.describe("Components icon strip (#372)", { tag: "@ci" }, () => {
  test("a fresh strip shows the Components heading, four categories and no shortcuts", async ({ page }) => {
    await seed(page, "strip");
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByTestId("palette-strip-heading-components")).toHaveAccessibleName("Components");
    const categories = palette.getByTestId("palette-category");
    await expect(categories).toHaveCount(4);
    await expect(palette.getByTestId("palette-item")).toHaveCount(0);
    await expect(palette.getByTestId("palette-strip-heading-shortcuts")).toHaveCount(0);

    // The heading sits above the categories.
    const heading = (await palette.getByTestId("palette-strip-heading-components").boundingBox())!;
    const first = (await categories.first().boundingBox())!;
    expect(heading.y + heading.height).toBeLessThanOrEqual(first.y + 1);

    // The fold-out chevron is much smaller than a component icon, and says what it does.
    const chevron = palette.getByTestId("palette-strip-expand");
    await expect(chevron).toHaveAttribute("title", "Show the full Components panel");
    const c = (await chevron.boundingBox())!;
    expect(c.width).toBeLessThan(first.width / 2);
    expect(c.height).toBeLessThan(first.height / 2);
    // The strip keeps its width and the icons their size.
    expect(first).toMatchObject({ width: 32, height: 32 });
    expect((await palette.boundingBox())!.width).toBe(48);
  });

  test("with the setting on, favourites and recents sit below the categories under their heading", async ({ page }) => {
    await seed(page, "strip");
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-appearance").click();
    const box = page.getByTestId("setting-components-strip-shortcuts");
    await expect(box).not.toBeChecked();
    await box.check();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toBeHidden();

    const palette = page.getByTestId("palette-sidebar");
    const heading = palette.getByTestId("palette-strip-heading-shortcuts");
    await expect(heading).toHaveAccessibleName("Favourites & recent");
    const items = palette.getByTestId("palette-item");
    // Favourites first, then recents, each once.
    await expect(items).toHaveCount(3);
    expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-type")))).toEqual([
      "TransferMechanism",
      "DDM",
      "MappingProjection",
    ]);
    await expect(items.first()).toHaveAttribute("data-shortcut", "favourite");
    await expect(items.nth(1)).toHaveAttribute("title", /^Recently used: .*Click, then click the graph to place it$/);

    const lastCategory = (await palette.getByTestId("palette-category").last().boundingBox())!;
    const h = (await heading.boundingBox())!;
    const firstItem = (await items.first().boundingBox())!;
    expect(h.y).toBeGreaterThanOrEqual(lastCategory.y + lastCategory.height - 1);
    expect(firstItem.y).toBeGreaterThanOrEqual(h.y + h.height - 1);

    // The choice is kept.
    await page.reload();
    await expect(palette.getByTestId("palette-strip-heading-shortcuts")).toBeVisible();
  });

  test("a row's empty star shows on hover or focus; a starred row keeps its star", async ({ page }) => {
    await seed(page, "open");
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByPlaceholder("Search components…")).toBeVisible();

    const ddm = palette.locator('[data-testid="palette-item"][data-type="DDM"]').first();
    const ddmStar = ddm.getByTestId("palette-fav-star");
    await expect(ddmStar).toHaveAttribute("data-starred", "false");
    await expect(ddmStar).toHaveCSS("opacity", "0");
    await expect(ddmStar).toHaveAccessibleName(/Add .* to favorites/);

    await ddm.hover();
    await expect(ddmStar).toHaveCSS("opacity", "1");

    // Keyboard: the star is in the tab order and shows when focused.
    await page.mouse.move(0, 0);
    await expect(ddmStar).toHaveCSS("opacity", "0");
    await ddmStar.focus();
    await expect(ddmStar).toHaveCSS("opacity", "1");
    await ddmStar.blur();

    // A starred row shows its ★ without hover.
    const starred = palette.locator('[data-testid="palette-item"][data-type="TransferMechanism"]').first();
    const star = starred.getByTestId("palette-fav-star");
    await expect(star).toHaveAttribute("data-starred", "true");
    await expect(star).toHaveText("★");
    await expect(star).toHaveCSS("opacity", "1");
  });
});
