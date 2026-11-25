/**
 * The Components panel draws each component's icon (#283), in the list and
 * in the folded strip, in light and dark mode, without moving anything.
 *
 * src/utils/componentIcons.test.ts checks every palette item has an icon;
 * this checks they reach the page: each one drawn at its size, in its
 * colour, where the colour dot used to be. The app has no dark theme yet,
 * so the dark run is about the icons still drawing (they are currentColor,
 * and will follow one when it comes), not about a different look.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

// Two favourites, so the folded strip shows item icons as well as the
// category ones: an ordinary one, and the input port, drawn in show_graph's
// input green rather than its type colour.
const FAVOURITES = ["TransferMechanism", "InputPort"];

async function open(page: Page, colorScheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme });
  await page.addInitScript((favs) => {
    localStorage.setItem("psyneuview_palette_favorites", JSON.stringify(favs));
    // #372: the strip shows favourites only with this setting on.
    localStorage.setItem("psyneuview.components.stripShortcuts", "true");
  }, FAVOURITES);
  await page.goto("/");
  const palette = page.getByTestId("palette-sidebar");
  await expect(palette.getByPlaceholder("Search components…")).toBeVisible();
  return palette;
}

/** Unfold every category in the list, so every item it has is on show. */
async function unfoldAll(page: Page) {
  for (let round = 0; round < 6; round++) {
    const clicked = await page.getByTestId("palette-sidebar").evaluate((root) => {
      const folded = Array.from(root.querySelectorAll("button")).filter((b) => {
        const arrow = b.querySelector(":scope > span");
        return arrow?.textContent === "▶" && (arrow as HTMLElement).style.transform === "rotate(0deg)";
      });
      folded.forEach((b) => b.click());
      return folded.length;
    });
    if (!clicked) return;
  }
}

/** Each icon in `scope` is drawn at `size` and in the colour it is given. */
async function expectIconsDrawn(scope: import("@playwright/test").Locator, size: number) {
  const icons = await scope.evaluateAll((els) =>
    els.map((el) => {
      const svg = el.querySelector("svg");
      const box = svg?.getBoundingClientRect();
      const mark = svg?.querySelector("path, circle, rect");
      const cs = mark ? getComputedStyle(mark) : null;
      const colour = getComputedStyle(el).color;
      return {
        file: el.getAttribute("data-icon"),
        w: box?.width ?? 0,
        h: box?.height ?? 0,
        colour,
        // A stroke icon draws in its colour, a filled (MetaCell) one fills with it.
        inColour: !!cs && (cs.stroke === colour || cs.fill === colour),
      };
    }),
  );
  expect(icons.length).toBeGreaterThan(0);
  for (const i of icons) {
    expect(i, `${i.file}`).toMatchObject({ w: size, h: size, inColour: true });
    expect(i.colour, `${i.file}`).not.toBe("rgba(0, 0, 0, 0)");
  }
  return icons;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`Components panel icons, ${scheme} mode (#283)`, { tag: "@ci" }, () => {
    test("the list shows each item's icon where its colour dot was", async ({ page }) => {
      const palette = await open(page, scheme);
      await unfoldAll(page);
      const rows = palette.getByTestId("palette-item");
      expect(await rows.count()).toBeGreaterThan(50);
      // Every row has its icon, and it is drawn.
      expect(await rows.locator("[data-testid=component-icon]").count()).toBe(await rows.count());
      await expectIconsDrawn(rows.locator("[data-testid=component-icon]"), 14);

      // Nothing moved: a row is its label plus 4px above and below, and the
      // icon is centred where the 8px dot was, 8px before the label.
      const layout = await rows.evaluateAll((els) =>
        els.map((row) => {
          const icon = row.querySelector("[data-testid=component-icon]")!.getBoundingClientRect();
          const label = (row.querySelectorAll(":scope > span")[1] as HTMLElement).getBoundingClientRect();
          const r = row.getBoundingClientRect();
          return {
            type: row.getAttribute("data-type"),
            rowH: r.height,
            labelH: label.height,
            iconCentreToLabel: label.left - (icon.left + icon.width / 2),
            iconMiddle: Math.round(icon.top + icon.height / 2 - (label.top + label.height / 2)),
          };
        }),
      );
      for (const l of layout) {
        expect(l, `${l.type}`).toMatchObject({ rowH: l.labelH + 8, iconCentreToLabel: 12, iconMiddle: 0 });
      }

      // The input port keeps show_graph's green, not its type colour.
      const input = palette.locator('[data-testid=palette-item][data-type="InputPort"] [data-testid=component-icon]').first();
      const green = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--pnv-role-input-text)";
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      await expect(input).toHaveCSS("color", green);
    });

    test("the folded strip shows the category icons and the favourites' icons", async ({ page }) => {
      const palette = await open(page, scheme);
      await palette.getByTestId("palette-fold").click();
      const categories = palette.getByTestId("palette-category");
      await expect(categories.first()).toBeVisible();
      // One icon per category, no placeholder letters, and the boxes keep their 32px.
      const n = await categories.count();
      expect(n).toBeGreaterThanOrEqual(4);
      await expect(categories.locator("[data-testid=component-icon]")).toHaveCount(n);
      for (let i = 0; i < n; i++) {
        await expect(categories.nth(i)).toHaveText("");
        const box = await categories.nth(i).boundingBox();
        expect(box).toMatchObject({ width: 32, height: 32 });
      }
      await expectIconsDrawn(categories.locator("[data-testid=component-icon]"), 18);

      const items = palette.getByTestId("palette-item");
      await expect(items).toHaveCount(FAVOURITES.length);
      await expectIconsDrawn(items.locator("[data-testid=component-icon]"), 16);
    });
  });
}
