/**
 * Advanced Graph View Options ▾ (#123, part of the clean look #109).
 *
 * The graph toolbar's row of view toggles and its More ▾ menu became one
 * persistent panel. It stays open while you flip several options, closes on
 * Escape, a click outside and its ×, and every option in it still does what
 * the toggle it replaced did; the values hold when it is opened again.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function openStroop(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText("Stroop").first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

const menu = (page: Page) => page.getByTestId("graph-view-options-menu");

async function openMenu(page: Page) {
  await page.getByTestId("graph-view-options-button").click();
  await expect(menu(page)).toBeVisible();
}

const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60_000 });

test.describe("Advanced Graph View Options (#123)", { tag: "@ci" }, () => {
  test("opens, stays open across two toggles, and closes on Escape", async ({ page }) => {
    await openStroop(page);
    // The toggles left the toolbar.
    await expect(page.getByRole("button", { name: "Roles", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("graph-more-button")).toHaveCount(0);

    await openMenu(page);
    const names = page.getByTestId("graph-view-option-names");
    const order = page.getByTestId("graph-view-option-order");
    await expect(names).toBeChecked();
    await expect(order).not.toBeChecked();

    // Two toggles in a row; the panel stays open through both.
    await names.click();
    await expect(menu(page)).toBeVisible();
    await order.click();
    await expect(menu(page)).toBeVisible();
    await expect(names).not.toBeChecked();
    await expect(order).toBeChecked();

    // Escape closes it; the choices hold when it opens again.
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await openMenu(page);
    await expect(names).not.toBeChecked();
    await expect(order).toBeChecked();

    // Its × and a click outside close it too.
    await menu(page).getByTestId("dialog-close").click();
    await expect(menu(page)).toHaveCount(0);
    await openMenu(page);
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect(menu(page)).toHaveCount(0);
  });

  test("each option still does its job", async ({ page }) => {
    test.setTimeout(120_000);
    await openStroop(page);
    await openMenu(page);

    // Nodes: names and the run-order badge show and hide on the canvas.
    const nodeNames = page.locator('.react-flow__node [data-testid="node-name"]');
    await expect(nodeNames.first()).toBeVisible();
    await page.getByTestId("graph-view-option-names").click();
    await expect(nodeNames).toHaveCount(0);
    await page.getByTestId("graph-view-option-names").click();
    await expect(nodeNames.first()).toBeVisible();

    const orderBadges = page.locator('[data-testid="node-order-badge"]');
    await expect(orderBadges).toHaveCount(0);
    await page.getByTestId("graph-view-option-order").click();
    await expect(orderBadges.first()).toBeVisible();
    await page.getByTestId("graph-view-option-order").click();
    await expect(orderBadges).toHaveCount(0);

    // Lines: the direction arrows on each line.
    const arrowheads = page.getByTestId("edge-arrowhead");
    const arrows = page.getByTestId("graph-view-option-arrows");
    const arrowsOn = await arrows.isChecked();
    await arrows.click();
    if (arrowsOn) await expect(arrowheads).toHaveCount(0);
    else await expect(arrowheads.first()).toBeAttached();
    await arrows.click();

    // Every other on/off option flips, and flips back.
    for (const id of [
      "graph-view-option-elements",
      "graph-view-option-types",
      "graph-view-option-roles",
      "graph-view-option-dims",
      "toolbar-show-ports",
      "graph-view-option-labels",
      "graph-view-option-bundle-edges",
    ]) {
      const box = page.getByTestId(id);
      const was = await box.isChecked();
      await box.click();
      await expect(box, id).toBeChecked({ checked: !was });
      await box.click();
      await expect(box, id).toBeChecked({ checked: was });
    }

    // The selects: line style, and direction (for the Layered layout).
    const style = page.getByTestId("graph-view-option-edge-style");
    const styleWas = await style.inputValue();
    await style.selectOption(styleWas === "straight" ? "spline" : "straight");
    await expect(style).not.toHaveValue(styleWas);
    await style.selectOption(styleWas);
    const direction = page.getByTestId("graph-view-option-direction");
    if (await direction.isEnabled()) {
      const dirWas = await direction.inputValue();
      await direction.selectOption(dirWas === "TB" ? "LR" : "TB");
      await expect(direction).not.toHaveValue(dirWas);
      await direction.selectOption(dirWas);
    }

    // What the graph shows: each rebuilds the graph, as More ▾ did.
    for (const id of ["graph-view-option-cims", "graph-view-option-inactive"]) {
      const box = page.getByTestId(id);
      const was = await box.isChecked();
      await Promise.all([loaded(page), box.click()]);
      await expect(box, id).toBeChecked({ checked: !was });
      await Promise.all([loaded(page), box.click()]);
      await expect(box, id).toBeChecked({ checked: was });
    }

    // Still open after all of it.
    await expect(menu(page)).toBeVisible();

    // Scheduling arrows have their one control in Settings; the row goes there.
    await page.getByTestId("graph-view-option-scheduling-arrows").click();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByTestId("setting-graph-scheduling-arrows")).toBeVisible();
  });

  test("works from the keyboard", async ({ page }) => {
    await openStroop(page);
    const button = page.getByTestId("graph-view-options-button");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    // The focus moves into the panel: Tab reaches its × and then the first option.
    await page.keyboard.press("Tab");
    await expect(menu(page).getByTestId("dialog-close")).toBeFocused();
    await page.keyboard.press("Tab");
    const names = page.getByTestId("graph-view-option-names");
    await expect(names).toBeFocused();
    await page.keyboard.press("Space");
    await expect(names).not.toBeChecked();
    await expect(menu(page)).toBeVisible();
    // Escape closes it and hands the focus back to its button.
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("fits a small window, above the panel dividers", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 670 });
    await openStroop(page);
    await openMenu(page);
    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1000);
    expect(box.y + box.height).toBeLessThanOrEqual(670);
    // Wherever a vertical divider crosses the panel, the panel is on top.
    const onTop = await page.evaluate(
      ({ b }) => {
        const sashes = [...document.querySelectorAll('[class*="sash-module_sash"]')]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.height > r.width);
        return sashes
          .map((r) => r.x + r.width / 2)
          .filter((x) => x > b.x + 2 && x < b.x + b.width - 2)
          .map((x) => !!document.elementFromPoint(x, b.y + b.height / 2)?.closest('[data-testid="graph-view-options-menu"]'));
      },
      { b: box },
    );
    expect(onTop.every(Boolean)).toBe(true);
  });
});
