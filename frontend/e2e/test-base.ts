/**
 * Custom Playwright test fixtures for the PsyNeuView E2E suite (#147).
 *
 * Two flavors — pick at the import site:
 *   - `readOnlyTest`: no per-test reset. Use for tests that only read
 *     backend state (the app-shell smoke is the canonical example).
 *   - `mutatingTest`: POSTs /api/test/reset before each test, which
 *     clears PSYNEWVIEW_WORKING_DIR and restarts the warm worker. Use
 *     when a test loads a demo, edits source, runs a model, etc.
 *
 * `mutatingTest` is markedly slower because the warm worker re-imports
 * PsyNeuLink on every restart (~1.7s). Don't reach for it unless the
 * test actually mutates state.
 */

import { test as base, expect } from "@playwright/test";

/**
 * Key holding the Open menu's folded sections (#845, #1135).
 * Kept as a literal rather than imported from src — the e2e suite drives the
 * built app from outside, and shouldn't compile app modules into the tests.
 */
const COLLAPSED_SECTIONS_KEY = "psyneuview.openMenu.collapsedSections";
const SHOWN_DEV_SECTIONS_KEY = "psyneuview.openMenu.shownDevSections";
const DEV_SECTIONS = ["examples", "references", "demos"];
/**
 * Key holding the answer to the first-launch orientation offer (#1310). The
 * harness answers it ("never") so no spec meets the dialog by surprise; a
 * spec about the offer removes the key in its own `addInitScript`.
 */
const ORIENTATION_OFFER_KEY = "psyneuview.orientation.offer";
/** Folded Tutorials-menu sections (#8). Kept literal, like the keys above. */
const TUTORIALS_FOLDED_KEY = "psyneuview.tutorials.foldedSections";
/**
 * Automatic layout (#24). Models now open "Like show_graph"; the suite was
 * written against Layered (positions, the tutorials' screenshots), so it keeps
 * Layered unless a spec asks otherwise. A spec about the default clears the key
 * in its own `addInitScript`.
 */
const LAYOUT_DEFAULT_KEY = "psyneuview.graph.layoutDefault";

/**
 * Start with the Open menu's catalog sections expanded.
 *
 * The menu now opens with every section folded (#1135), which is right for
 * someone opening the app and wrong for a test that just wants to reach a
 * model: a spec that clicks Open and then clicks a model label would hang on
 * a label that isn't rendered. Fifteen specs broke exactly that way.
 *
 * Seeding here rather than in each spec keeps the fold state out of tests that
 * aren't about folding, and means a new spec doesn't have to know about it.
 *
 * Two details that matter:
 *  - It writes only when the key is *unset*, so a spec that folds something
 *    and reloads still sees its own state. Unconditional seeding would
 *    overwrite on every navigation and quietly break the persistence check.
 *  - An empty array is what the app reads as "expanded everything on purpose",
 *    which is precisely the state these tests want.
 *
 * A spec that needs the real first-run default can clear the key in its own
 * `addInitScript` — those run after this one.
 */
async function expandOpenMenuSections(page: import("@playwright/test").Page) {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, "[]");
  }, COLLAPSED_SECTIONS_KEY);
  // #1228: catalogs under development are hidden outside developer mode, and
  // specs open reference and demo models from them. Switch them on the way a
  // user can in Settings — same "only when unset" rule, so a spec about the
  // hiding clears the key in its own init script.
  await page.addInitScript(
    ([key, ids]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(ids));
    },
    [SHOWN_DEV_SECTIONS_KEY, [...DEV_SECTIONS]] as const,
  );
  // #8: the Tutorials menu's sections all open, so specs that pick a
  // walkthrough from it needn't unfold one first. A spec about folding clears
  // the key in its own init script.
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, "[]");
  }, TUTORIALS_FOLDED_KEY);
  // #1310: the orientation offer is for a person's first launch, never a test's.
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, "never");
  }, ORIENTATION_OFFER_KEY);
  // #24: the suite's layouts are Layered unless a spec chooses (see above).
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, "layered");
  }, LAYOUT_DEFAULT_KEY);
}

export const readOnlyTest = base.extend({
  page: async ({ page }, use) => {
    await expandOpenMenuSections(page);
    await use(page);
  },
});

export const mutatingTest = base.extend({
  page: async ({ page, request }, use) => {
    // 30s (vs the 20s action default) — the reset can be slow when the CI
    // backend is briefly busy, and a timeout here fails the whole test in the
    // fixture, unrelated to what it's testing (#160).
    const resp = await request.post("/api/test/reset", { timeout: 30_000 });
    if (!resp.ok()) {
      throw new Error(
        `mutatingTest beforeEach: /api/test/reset returned ${resp.status()} — ` +
          `is the backend running with PSYNEWVIEW_TEST_MODE=1?`,
      );
    }
    await expandOpenMenuSections(page);
    await use(page);
  },
});

/**
 * Scheduling-condition arrows start hidden (#123). A spec about those arrows,
 * their badges or the legend that explains them shows them the way a user
 * would choose to in Settings ▸ Appearance — only when unset, so a spec that
 * hides them and reloads still sees its own choice.
 */
const SCHEDULING_ARROWS_KEY = "psyneuview.graph.schedulingArrows";
export async function showSchedulingArrows(page: import("@playwright/test").Page) {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, "shown");
  }, SCHEDULING_ARROWS_KEY);
}

/**
 * The test ids of the graph's view options that used to be More ▾ rows, by the
 * name the More menu gave them. They live in Advanced Graph View Options now
 * (#123): open it with `graph-view-options-button`, then click the checkbox.
 */
export const VIEW_OPTION_IDS: Record<string, string> = {
  Controller: "graph-view-option-controller",
  Learning: "graph-view-option-learning",
  CIMs: "graph-view-option-cims",
  Inactive: "graph-view-option-inactive",
};

/** Exported so a spec about folding can opt out of the seeding above. */
export { COLLAPSED_SECTIONS_KEY, SHOWN_DEV_SECTIONS_KEY, ORIENTATION_OFFER_KEY, TUTORIALS_FOLDED_KEY };

/**
 * Dismiss the Components palette, if it's showing.
 *
 * The palette defaults to open (`isOpen: loadBool(LS_OPEN, true)`) and is an
 * overlay on the canvas, so depending on how the loaded layout zooms the graph
 * it can land directly on top of a node a test wants to click. Playwright then
 * reports the node as "visible, enabled and stable" while the palette div
 * intercepts every pointer event, and the click burns its whole actionTimeout
 * (#160). Closing unmounts it entirely (`if (!isOpen) return null`).
 *
 * Call this in any spec that clicks canvas nodes and doesn't need the palette.
 */
export async function closePalette(page: import("@playwright/test").Page) {
  const palette = page.getByTestId("palette-sidebar");
  if (!(await palette.isVisible().catch(() => false))) return;
  await page.getByTitle("Close palette").click();
  await expect(palette).toBeHidden({ timeout: 5000 });
}

/**
 * Locate a canvas node by the name the model gives it.
 *
 * React Flow sets `data-id` from the node id, but an id can pick up a
 * session-counter suffix once several models have loaded in one run
 * ("STATE-7", "input_node-10"). So match the exact name **or** name + "-<n>" —
 * deliberately not a bare `^=` prefix, which would also catch a sibling like
 * "LC_objective" when you asked for "LC".
 *
 * This pattern was written correctly in two specs and loosely in two others;
 * it lives here now so there is one answer to "how do I address a node".
 */
export function canvasNode(page: import("@playwright/test").Page, name: string) {
  return page.locator(
    `.react-flow__node[data-id="${name}"], .react-flow__node[data-id^="${name}-"]`,
  );
}

/**
 * Fit the graph into the canvas, and wait for the transform to settle.
 */
export async function fitGraph(page: import("@playwright/test").Page) {
  const fitView = page.locator(".react-flow__controls-fitview");
  await expect(fitView).toBeVisible({ timeout: 10_000 });
  await fitView.click();
  await page.waitForTimeout(300);
}

/**
 * Select a canvas node — with the two guards #999 taught us to need.
 *
 * Clicking a React Flow node is geometry-dependent in ways that bite only on
 * some runners, which is why #999 read as a flake for three weeks:
 *
 *  1. **The palette overlays the canvas.** It can sit on top of the target,
 *     which stays "visible, enabled and stable" while the palette swallows
 *     every pointer event, burning the full actionTimeout (#160).
 *  2. **A node outside the viewport keeps its bounding box.** React Flow clips
 *     it visually, but Playwright still judges it visible and aims at a point
 *     the graph toolbar owns — the click is then intercepted by "Reset Custom
 *     Layout" until the action times out. Fitting first is what a user would
 *     do, and it makes the target depend on the graph rather than on how tall
 *     the results panel happens to be.
 *
 * The visibility assertion runs first so a missing node fails with "never
 * rendered" instead of a bare click timeout. If the click is intercepted
 * anyway, Playwright's call log names the intercepting element — read the
 * uploaded CI artifact, not just the Actions summary line.
 */
export async function clickCanvasNode(page: import("@playwright/test").Page, name: string) {
  const node = canvasNode(page, name).first();
  await expect(node, `canvas node "${name}" never rendered`).toBeVisible({ timeout: 30_000 });
  await closePalette(page);
  await fitGraph(page);
  await node.click();
  return node;
}

export { expect };
