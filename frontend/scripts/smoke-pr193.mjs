// Smoke test for #193: collapse code / graph panes.
// - Loads simple_stroop so both panes have content.
// - Asserts both panes start visible (the localStorage default).
// - Clicks "Hide Code", asserts the CodeMirror editor is gone from the DOM.
// - Clicks "Show Code", asserts it is back. Same dance for graph.
// - Verifies the localStorage keys persist after a reload.
// - Captures a screenshot of the "graph hidden, only code + inspector" state
//   for PR evidence.
//
// Assumes:
//   - backend running on http://localhost:8000
//   - vite dev server on http://localhost:5176 serving the #193 worktree

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5176";
const OUT_PATH = "/tmp/pr-193-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

// Clear localStorage so the defaults (both visible) apply.
await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.removeItem("psynewview_layout_code_visible");
  localStorage.removeItem("psynewview_layout_graph_visible");
});
await page.reload({ waitUntil: "networkidle" });

// Load simple_stroop so both panes have content.
await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();
await page.locator(".react-flow__node").first().waitFor({ state: "visible" });
console.log("OK: simple_stroop loaded");

// Both panes start visible.
const hideCode = page.getByRole("button", { name: /^hide code$/i });
const hideGraph = page.getByRole("button", { name: /^hide graph$/i });
await hideCode.waitFor({ state: "visible", timeout: 5000 });
await hideGraph.waitFor({ state: "visible", timeout: 5000 });
console.log("OK: both 'Hide Code' and 'Hide Graph' buttons visible (panes start open)");

// Allotment hides panes by collapsing the wrapper to 0×0 rather than
// unmounting the children. So "hidden" means the .cm-editor / .react-flow
// element has a bounding rect with zero width or height.
async function paneCollapsed(selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return true;
    const r = el.getBoundingClientRect();
    return r.width === 0 || r.height === 0;
  }, selector);
}

// Hide the code pane.
await hideCode.click();
await page.getByRole("button", { name: /^show code$/i }).waitFor({ state: "visible", timeout: 3000 });
await page.waitForTimeout(200);
if (!(await paneCollapsed(".cm-editor"))) {
  console.error("FAIL: code editor still has non-zero size after Hide Code");
  await browser.close();
  process.exit(1);
}
console.log("OK: code pane collapsed");

// Show the code pane again.
await page.getByRole("button", { name: /^show code$/i }).click();
await page.getByRole("button", { name: /^hide code$/i }).waitFor({ state: "visible", timeout: 3000 });
await page.waitForTimeout(200);
if (await paneCollapsed(".cm-editor")) {
  console.error("FAIL: code editor still collapsed after Show Code");
  await browser.close();
  process.exit(1);
}
console.log("OK: code pane restored");

// Hide the graph pane.
await hideGraph.click();
await page.getByRole("button", { name: /^show graph$/i }).waitFor({ state: "visible", timeout: 3000 });
await page.waitForTimeout(200);
if (!(await paneCollapsed(".react-flow"))) {
  console.error("FAIL: graph canvas still has non-zero size after Hide Graph");
  await browser.close();
  process.exit(1);
}
console.log("OK: graph pane collapsed");

// Screenshot the code-only state for PR evidence.
const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

// Persistence check: reload, graph should stay hidden.
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: /^show graph$/i }).waitFor({ state: "visible", timeout: 5000 });
console.log("OK: graph-hidden state persisted across reload");

// Guard check: with code visible + graph hidden, hiding code should auto-show
// graph so we never end up with both top-panes invisible.
await page.getByRole("button", { name: /^hide code$/i }).click();
await page.getByRole("button", { name: /^hide graph$/i }).waitFor({ state: "visible", timeout: 3000 });
console.log("OK: guard kicked in — hiding the last visible pane re-showed the other");

await browser.close();
console.log("DONE: #193 smoke test passed");
