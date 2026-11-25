/**
 * One standard expand / collapse control (#418, design A).
 *
 * Panel edges are handles: a resize line with an arrow tab. Drag the line to
 * resize; click the tab, or press Enter on the focused line, to collapse or
 * restore. A collapsed pane keeps its handle. Rows and sections show the same
 * arrow, turned, in a button (or summary) with aria-expanded that the
 * keyboard can reach. docs/ui-interaction-conventions.md is the standard;
 * src/disclosureConventions.test.ts is its source check.
 *
 * The shared setup turns the code editor and the bottom panel on and opens
 * the Components panel in full.
 */
import { readOnlyTest as test, mutatingTest, expect } from "./test-base";
import type { Locator, Page } from "@playwright/test";

async function openStroop(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText("Stroop").first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

const width = async (l: Locator) => (await l.boundingBox())?.width ?? 0;
const height = async (l: Locator) => (await l.boundingBox())?.height ?? 0;

/** Press at (x, y), move by (dx, dy) in steps, release. */
async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5);
  await page.mouse.up();
}

/** Every row arrow on the page sits in a button or summary that says whether it is open. */
async function expectArrowsAnnounced(page: Page) {
  const problems = await page.evaluate(() =>
    [...document.querySelectorAll("[data-disclosure-arrow]")].flatMap((arrow) => {
      const host = arrow.closest("button, summary");
      const what = (host ?? arrow.parentElement)?.textContent?.trim().slice(0, 40) ?? "?";
      if (!host) return [`no button around the arrow in "${what}"`];
      const exp = host.getAttribute("aria-expanded");
      if (exp === null) return [`"${what}" has no aria-expanded`];
      if (exp !== arrow.getAttribute("data-open")) return [`"${what}" says ${exp} but its arrow says ${arrow.getAttribute("data-open")}`];
      if ((host as HTMLElement).tabIndex < 0 && !(host as HTMLButtonElement).disabled) return [`"${what}" is not keyboard-reachable`];
      return [];
    }),
  );
  expect(problems).toEqual([]);
}

/** Focus a toggle, press a key, and its aria-expanded flips. */
async function expectKeyToggles(toggle: Locator, key: "Enter" | "Space" = "Enter") {
  const before = await toggle.getAttribute("aria-expanded");
  expect(before === "true" || before === "false").toBe(true);
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await toggle.press(key);
  await expect(toggle).toHaveAttribute("aria-expanded", before === "true" ? "false" : "true");
}

test.describe("panel-edge handles (#418)", { tag: "@ci" }, () => {
  test("the code pane: drag resizes, the tab collapses and restores, and its handle stays", async ({ page }) => {
    await openStroop(page);
    const pane = page.getByTestId("code-editor-pane");
    const handle = page.getByTestId("code-pane-handle");
    const line = handle.getByRole("separator", { name: "Resize the code editor" });
    const tab = page.getByTestId("code-pane-toggle");
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(tab).toHaveAttribute("aria-controls", "pnv-pane-code");
    await expect(tab).toHaveAccessibleName("Collapse the code editor");
    // The tab sits at the top of the vertical edge, and is at least 24px across where it is pressed.
    const lineBox = (await line.boundingBox())!;
    const tabBox = (await tab.boundingBox())!;
    expect(tabBox.y - lineBox.y).toBeLessThan(20);
    expect(tabBox.height).toBeGreaterThanOrEqual(24);

    // Drag the line: the pane follows, and nothing collapses.
    const w0 = await width(pane);
    await drag(page, lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2, 60, 0);
    await expect.poll(() => width(pane)).toBeGreaterThan(w0 + 55);
    expect(await width(pane)).toBeLessThan(w0 + 65);
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    // The new split is stored, as Allotment's was.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("psyneuview_layout_outer_sizes") ?? "null"));
    expect(Math.abs(stored[0] - (w0 + 60))).toBeLessThanOrEqual(2);

    // A drag that starts on the tab is a drag too, not a click.
    const w1 = await width(pane);
    const t = (await tab.boundingBox())!;
    await drag(page, t.x + t.width / 2, t.y + t.height / 2, -40, 0);
    await expect.poll(() => width(pane)).toBeLessThan(w1 - 35);
    await expect(tab).toHaveAttribute("aria-expanded", "true");

    // A click on the tab collapses; the handle stays, its arrow turned round.
    const w2 = await width(pane);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    await expect(pane).toBeHidden();
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAccessibleName("Show the code editor");
    await expect(tab.locator("svg")).toHaveAttribute("data-direction", "right");
    const collapsedBox = (await tab.boundingBox())!;
    expect(collapsedBox.x).toBeGreaterThanOrEqual(0);
    // ...and restores to the width it had.
    await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => width(pane)).toBeCloseTo(w2, -1);
    await expect(tab.locator("svg")).toHaveAttribute("data-direction", "left");
  });

  test("the code pane from the keyboard: arrows resize, Enter collapses and restores, focus shows", async ({ page }) => {
    await openStroop(page);
    const pane = page.getByTestId("code-editor-pane");
    const line = page.getByTestId("code-pane-handle").getByRole("separator");
    const tab = page.getByTestId("code-pane-toggle");
    await line.focus();
    await expect(line).toBeFocused();
    const v0 = Number(await line.getAttribute("aria-valuenow"));
    expect(v0).toBeGreaterThan(0);

    const w0 = await width(pane);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => width(pane)).toBeCloseTo(w0 + 10, 0);
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(() => width(pane)).toBeCloseTo(w0 - 40, 0);
    await expect.poll(async () => Number(await line.getAttribute("aria-valuenow"))).toBeLessThan(v0);
    // Arrows across the axis leave it alone.
    await page.keyboard.press("ArrowDown");
    expect(await width(pane)).toBeCloseTo(w0 - 40, 0);

    // Enter collapses; the separator keeps focus, and Enter brings the pane back.
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    await expect(pane).toBeHidden();
    await expect(line).toBeFocused();
    await expect(line).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => width(pane)).toBeCloseTo(w0 - 40, 0);

    // Focus is visible: the line draws primary, and Tab moves on to the tab button, which gets a 2px ring.
    await page.keyboard.press("Tab");
    await expect(tab).toBeFocused();
    await expect(tab).toHaveCSS("outline-width", "2px");
    await expect(tab).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Space");
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-expanded", "true");
  });

  test("the bottom panel: its tab is at the right end, and it can never vanish without a handle", async ({ page }) => {
    await openStroop(page);
    const tabs = page.getByTestId("tab-inspector");
    const line = page.getByTestId("bottom-panel-handle").getByRole("separator", { name: "Resize the Inspector panel" });
    const tab = page.getByTestId("bottom-panel-collapse");
    const panel = page.getByTestId("panel-inspector");
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    const lineBox = (await line.boundingBox())!;
    const tabBox = (await tab.boundingBox())!;
    expect(lineBox.x + lineBox.width - (tabBox.x + tabBox.width)).toBeLessThan(40);
    expect(tabBox.width).toBeGreaterThanOrEqual(24);
    await expect(tab.locator("svg")).toHaveAttribute("data-direction", "down");

    // Drag the line up: the panel grows.
    const h0 = await height(panel);
    await drag(page, lineBox.x + lineBox.width / 3, lineBox.y + lineBox.height / 2, 0, -50);
    await expect.poll(() => height(panel)).toBeGreaterThan(h0 + 45);
    await expect(tab).toHaveAttribute("aria-expanded", "true");

    // Collapse: the tab stays on the window's bottom edge, pointing up.
    await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    await expect(tabs).toBeHidden();
    await expect(tab).toBeVisible();
    await expect(tab.locator("svg")).toHaveAttribute("data-direction", "up");
    const vp = page.viewportSize()!;
    const collapsed = (await tab.boundingBox())!;
    expect(collapsed.y + collapsed.height).toBeLessThanOrEqual(vp.height + 0.5);
    // A press on the bare line does nothing while collapsed.
    await page.mouse.click(collapsed.x - 100, collapsed.y + collapsed.height - 2);
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    // Restore from the keyboard.
    await line.focus();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(tabs).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => height(panel)).toBeGreaterThan(h0 + 55);
  });

  test("the Components panel folds to the strip from its edge tab, and back", async ({ page }) => {
    await openStroop(page);
    const palette = page.getByTestId("palette-sidebar");
    const fold = palette.getByTestId("palette-fold");
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(fold).toHaveAttribute("aria-controls", "pnv-palette-body");
    // On the panel's right edge, not in its column of buttons.
    const p = (await palette.boundingBox())!;
    const f = (await fold.boundingBox())!;
    expect(Math.abs(f.x + f.width / 2 - (p.x + p.width))).toBeLessThan(3);
    // The panel doesn't resize, so the line itself is no separator.
    await expect(page.getByTestId("palette-handle").getByRole("separator")).toHaveCount(0);

    await fold.click();
    await expect.poll(() => width(palette)).toBe(48);
    const expand = palette.getByTestId("palette-strip-expand");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    // From the keyboard: the same button, so focus stays on it as it turns.
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => width(palette)).toBe(260);
    await expect(palette.getByTestId("palette-fold")).toBeFocused();
    await expect(palette.getByTestId("palette-fold")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect.poll(() => width(palette)).toBe(48);
    await expect(palette.getByTestId("palette-strip-expand")).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("rows and sections share the arrow (#418)", { tag: "@ci" }, () => {
  test("each listed fold says whether it is open and works from the keyboard", async ({ page }) => {
    await openStroop(page);

    // The Components tree.
    const treeRow = page.getByTestId("palette-sidebar").locator("button[aria-expanded]").filter({ hasText: /mechanisms/i }).first();
    await expectKeyToggles(treeRow);
    await expectArrowsAnnounced(page);

    // The Model Diagnostics bar, a div before #418.
    const diag = page.getByTestId("diagnostics-toggle");
    await expect(diag).toHaveAttribute("aria-expanded", "false");
    await diag.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("diagnostics-toggle")).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("diagnostics-toggle").press("Enter");
    await expect(page.getByTestId("diagnostics-toggle")).toHaveAttribute("aria-expanded", "false");

    // Composition − / + keep their symbols but say whether the composition is open.
    for (const b of await page.getByTestId("composition-collapse").all()) await expect(b).toHaveAttribute("aria-expanded", "true");
    for (const b of await page.getByTestId("composition-expand").all()) await expect(b).toHaveAttribute("aria-expanded", "false");

    // The Run panel: Paste CSV, a <details> with our arrow and aria-expanded on its summary.
    await page.getByTestId("tab-run").click();
    const byNode = page.getByTestId("run-grouping").getByRole("button", { name: "By node" });
    if ((await byNode.getAttribute("aria-pressed")) !== "true") await byNode.click();
    const paste = page.getByTestId("run-panel").locator("summary").filter({ hasText: "Paste CSV" }).first();
    await expect(paste).toHaveAttribute("aria-expanded", "false");
    await expectKeyToggles(paste);
    await expectArrowsAnnounced(page);

    // The Open menu: section headings.
    await page.getByTestId("open-menu").click();
    const section = page.locator('[data-testid^="open-menu-section-"] button[aria-expanded]').first();
    await expectKeyToggles(section);
    await expectArrowsAnnounced(page);
    await page.keyboard.press("Escape");

    // The Tutorials menu: its groups.
    await page.getByTestId("walkthrough-menu").click();
    const group = page.locator('[data-testid^="tutorials-section-"]').first();
    await expectKeyToggles(group);
    await expectArrowsAnnounced(page);
    await page.keyboard.press("Escape");

    // Settings: a section's heading.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-appearance").click();
    const heading = page.locator('[data-testid^="settings-group-"] > button[aria-expanded]').first();
    await expectKeyToggles(heading);
    await expectArrowsAnnounced(page);
  });

  // An edit is recorded through the automation hook (utils/history.ts), as
  // undo-notices.spec.ts does; it changes the model, hence a mutating test.
  mutatingTest("History steps are buttons that fold open", async ({ page }) => {
    await openStroop(page);
    await expect(page.getByTestId("undo-button")).toBeDisabled({ timeout: 10_000 });
    await page.evaluate(() => {
      const hook = (window as any).__pnvUndoTest;
      hook.recordCodeEdit(hook.source() + "# an edit\n", "An edit");
    });
    await page.getByTestId("history-button").click();
    const step = page.getByTestId("history-step").filter({ hasText: "An edit" }).first();
    await expect(step).toHaveAttribute("aria-expanded", "false");
    await expectKeyToggles(step);
    await expectArrowsAnnounced(page);
  });
});
