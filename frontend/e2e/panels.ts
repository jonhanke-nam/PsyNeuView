/**
 * Which of the four panels are showing (#189, #191), asked two ways.
 *
 * A hidden Allotment pane keeps its contents mounted at zero size, so
 * Playwright's `isVisible` still says yes to a tab button nobody can see.
 * So each panel is hit-tested at its centre (is the element what's really
 * there?), and the app's own diagnostics snapshot says what its layout store
 * believes. The two must agree, which is itself a check.
 */
import { expect, type Page } from "@playwright/test";

export interface Panels {
  code: boolean;
  graph: boolean;
  bottom: boolean;
  palette: boolean;
}

export const GRAPH_ONLY: Panels = { code: false, graph: true, bottom: false, palette: false };
export const EVERYTHING: Panels = { code: true, graph: true, bottom: true, palette: true };

/** Storage keys, kept literal: the suite drives the built app from outside. */
export const GRAPH_VISIBLE_KEY = "psynewview_layout_graph_visible";
export const PALETTE_OPEN_KEY = "psynewview_palette_open";
export const BEFORE_WALKTHROUGH_KEY = "psynewview_layout_before_walkthrough";

const ANCHORS: Record<keyof Panels, string> = {
  code: "code-editor-pane",
  graph: "graph-canvas",
  bottom: "tab-inspector",
  palette: "palette-sidebar",
};

/** Whether the element with this test id is really on screen at its centre. */
async function onScreen(page: Page, testid: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // The element itself, or something inside it. An ancestor does not
    // count: that is what a clipped element in a zero-size pane produces.
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  }, testid);
}

/** What the app's layout store says is showing. */
async function storeSays(page: Page): Promise<Panels> {
  await page.waitForFunction(() => typeof (window as any).__pnvDiagnostics === "function");
  const panes: string[] = await page.evaluate(async () => {
    const snap = await (window as any).__pnvDiagnostics();
    return snap.state.ui.layout.visiblePanes;
  });
  return {
    code: panes.includes("code"),
    graph: panes.includes("graph"),
    bottom: panes.includes("bottom"),
    palette: panes.includes("palette"),
  };
}

/** Assert which panels are showing, on screen and in the store, waiting for both to settle. */
export async function expectPanels(page: Page, want: Panels) {
  await expect
    .poll(
      async () => {
        const store = await storeSays(page);
        const graph = await onScreen(page, ANCHORS.graph);
        const seen: Panels = {
          code: await onScreen(page, ANCHORS.code),
          graph,
          bottom: await onScreen(page, ANCHORS.bottom),
          // The Components panel is drawn over the graph, so with the graph
          // hidden it is off screen whatever the store says; only the store
          // can answer then.
          palette: graph ? await onScreen(page, ANCHORS.palette) : store.palette,
        };
        return { seen, store };
      },
      { timeout: 10_000 },
    )
    .toEqual({ seen: want, store: want });
}
