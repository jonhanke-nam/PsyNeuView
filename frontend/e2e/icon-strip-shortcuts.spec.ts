/**
 * The Components icon strip (#372, #395).
 *
 * A fresh strip shows the four category menus, no shortcuts and no heading
 * words. Settings ▸ Appearance ▸ "Show favourite and recently used components
 * in the icon strip" brings the shortcuts back, at the bottom under a thin
 * divider, favourites first, each once. "Show headings in the icon strip"
 * adds a tiny "Components" over the categories and "Recent" over the
 * shortcuts, each on one line within the strip at every Text size. The fold-out chevron is much smaller than a component icon. In
 * the word list, a row's empty ☆ shows only on hover or keyboard focus; a
 * starred row keeps its ★.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

const FAVOURITES = ["TransferMechanism"];
const RECENTS = ["DDM", "TransferMechanism", "MappingProjection"];

async function seed(
  page: Page,
  start: "strip" | "open",
  extra: Record<string, string> = {},
) {
  await page.addInitScript(
    ({ favs, recents, start, extra }) => {
      localStorage.setItem("psyneuview_palette_favorites", JSON.stringify(favs));
      localStorage.setItem("psyneuview_palette_recents", JSON.stringify(recents));
      localStorage.setItem("psyneuview.components.start", start);
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    },
    { favs: FAVOURITES, recents: RECENTS, start, extra },
  );
}

async function openAppearance(page: Page) {
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();
}

test.describe("Components icon strip (#372, #395)", { tag: "@ci" }, () => {
  test("a fresh strip shows four categories, no shortcuts and no heading words", async ({ page }) => {
    await seed(page, "strip");
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    const categories = palette.getByTestId("palette-category");
    await expect(categories).toHaveCount(4);
    await expect(palette.getByTestId("palette-item")).toHaveCount(0);
    await expect(palette.getByRole("heading")).toHaveCount(0);
    await expect(palette.getByTestId("palette-strip-divider")).toHaveCount(0);
    for (const word of ["Components", "All", "Recent"]) {
      await expect(palette.getByText(word, { exact: true })).toHaveCount(0);
    }
    const first = (await categories.first().boundingBox())!;

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

  test("with shortcuts on and headings off, a divider with no words sets them below the categories", async ({ page }) => {
    await seed(page, "strip");
    await page.goto("/");
    await openAppearance(page);
    const box = page.getByTestId("setting-components-strip-shortcuts");
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(page.getByTestId("setting-components-strip-headings")).not.toBeChecked();
    await closeSettings(page);

    const palette = page.getByTestId("palette-sidebar");
    const divider = palette.getByTestId("palette-strip-divider");
    await expect(divider).toBeVisible();
    await expect(divider).toHaveText("");
    await expect(palette.getByRole("heading")).toHaveCount(0);
    await expect(palette.getByText("Recent", { exact: true })).toHaveCount(0);
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
    const h = (await divider.boundingBox())!;
    const firstItem = (await items.first().boundingBox())!;
    expect(h.y).toBeGreaterThanOrEqual(lastCategory.y + lastCategory.height - 1);
    expect(firstItem.y).toBeGreaterThanOrEqual(h.y + h.height - 1);

    // The choice is kept.
    await page.reload();
    await expect(palette.getByTestId("palette-strip-divider")).toBeVisible();
  });

  test("with the headings setting on, Components and Recent show above their groups", async ({ page }) => {
    await seed(page, "strip", { "psyneuview.components.stripShortcuts": "true" });
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette.getByTestId("palette-strip-divider")).toBeVisible();
    const before = (await palette.getByTestId("palette-category").first().boundingBox())!;

    await openAppearance(page);
    const box = page.getByTestId("setting-components-strip-headings");
    await expect(box).not.toBeChecked();
    await box.check();
    await closeSettings(page);

    const all = palette.getByTestId("palette-strip-heading-components");
    const recent = palette.getByTestId("palette-strip-heading-shortcuts");
    await expect(all).toHaveAccessibleName("All components");
    await expect(all.getByTestId("palette-strip-heading-components-text")).toHaveText("Components");
    await expect(recent).toHaveAccessibleName("Recent and favourite components");
    await expect(recent.getByTestId("palette-strip-heading-shortcuts-text")).toHaveText("Recent");
    await expect(palette.getByTestId("palette-strip-divider")).toHaveCount(0);

    const first = (await palette.getByTestId("palette-category").first().boundingBox())!;
    const h = (await all.boundingBox())!;
    expect(h.y + h.height).toBeLessThanOrEqual(first.y + 1);
    // Only the heading rows appear: the strip and its icons keep their size.
    expect({ width: first.width, height: first.height }).toEqual({ width: before.width, height: before.height });
    expect((await palette.boundingBox())!.width).toBe(48);

    // The choice is kept.
    await page.reload();
    await expect(palette.getByTestId("palette-strip-heading-components")).toBeVisible();
  });

  for (const [size, scale] of [["small", "1"], ["default", "1.1"], ["large", "1.2"]] as const) {
    test(`at Text size ${scale}, each heading sits on one line within the strip`, async ({ page }) => {
      await seed(page, "strip", {
        "psyneuview.components.stripShortcuts": "true",
        "psyneuview.components.stripHeadings": "true",
        "psyneuview.appearance.textSize": size,
      });
      await page.goto("/");
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pnv-text-scale").trim()))
        .toBe(scale);
      const palette = page.getByTestId("palette-sidebar");
      const strip = (await palette.boundingBox())!;
      for (const id of ["palette-strip-heading-components", "palette-strip-heading-shortcuts"]) {
        const text = palette.getByTestId(`${id}-text`);
        await expect(text).toBeVisible();
        // Wait for the fit to settle (it runs as the layout is measured).
        await expect
          .poll(() => text.evaluate((el) => el.getBoundingClientRect().width))
          .toBeLessThanOrEqual(strip.width - 9);
        const m = await text.evaluate((el) => {
          const lines = el.getClientRects();
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const fontPx = parseFloat(cs.fontSize);
          // One line box: a single client rect no taller than ~1.5 × the font.
          return {
            lines: lines.length,
            height: r.height,
            fontPx,
            left: r.left,
            right: r.right,
            scrollW: el.scrollWidth,
            textContent: el.textContent,
            hyphens: cs.hyphens,
            overflow: cs.textOverflow,
          };
        });
        expect(m.textContent).not.toContain("\u00AD");
        expect(m.lines).toBe(1);
        expect(m.height).toBeLessThanOrEqual(m.fontPx * 1.5);
        expect(m.fontPx).toBeGreaterThanOrEqual(5);
        // Within the icons' column: the strip less its 4px padding (the panel's
        // resize handle lies over the left 4px) and its 1px border.
        expect(m.left).toBeGreaterThanOrEqual(strip.x + 4);
        expect(m.right).toBeLessThanOrEqual(strip.x + strip.width - 5);
        expect(m.overflow).not.toBe("ellipsis");
      }
    });
  }

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
