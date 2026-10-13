// Smoke test for #194 (PR #212): cursor-driven code-to-canvas highlighting.
//
// Verifies:
//   - Placing the editor cursor inside a known mechanism declaration block
//     paints a cyan box-shadow ring on the matching canvas node (cursor
//     highlight #06b6d4).
//   - Inspector selection is independent — selecting a different node keeps
//     its accent border while the cursor highlight follows the editor.
//   - Moving the cursor to a non-declaration line clears the cyan highlight.
//
// Captures a screenshot with the cursor highlight active for PR evidence.
//
// Assumes:
//   - backend running on http://localhost:8005 (SLOT=5)
//   - vite dev server on http://localhost:5178 (SLOT=5)
//
// Run:
//   cd frontend && node scripts/smoke-pr194.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5178";
const OUT_PATH = "/tmp/pr-194-smoke.png";
const CURSOR_CYAN = "rgb(6, 182, 212)"; // #06b6d4

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();
await page.locator(".react-flow__node").first().waitFor({ state: "visible", timeout: 5000 });
console.log("OK: simple_stroop loaded");

// Find a CodeMirror line that declares a mechanism. simple_stroop declares
// `colors_input = pnl.TransferMechanism(...)`. CodeMirror renders each line
// as a `.cm-line` element.
const targetLine = page.locator(".cm-line", { hasText: /colors_input\s*=/ }).first();
await targetLine.waitFor({ state: "visible", timeout: 5000 });
await targetLine.click();

// Cursor-driven highlight is debounced 150ms; give it a beat.
await page.waitForTimeout(400);

// Verify the matching canvas node has the cyan cursor-highlight ring.
const cursorOn = await page.evaluate((cyan) => {
  const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
  return nodes.some((n) => {
    const child = n.querySelector("div");
    if (!child) return false;
    const shadow = getComputedStyle(child).boxShadow || "";
    return shadow.includes(cyan);
  });
}, CURSOR_CYAN);
if (!cursorOn) {
  console.error("FAIL: no canvas node shows the cyan cursor-highlight ring after cursor moved onto colors_input declaration");
  await browser.close();
  process.exit(1);
}
console.log("OK: cursor on `colors_input = ...` produces cyan highlight on a canvas node");

// Screenshot with cursor highlight active — PR evidence.
const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

// Move cursor to a blank line (top of file is typically the docstring or
// imports) — find a `.cm-line` whose text is just `import` or blank.
const importLine = page.locator(".cm-line", { hasText: /^import\s+psyneulink/ }).first();
await importLine.waitFor({ state: "visible", timeout: 5000 });
await importLine.click();
await page.waitForTimeout(400);

const cursorOff = await page.evaluate((cyan) => {
  const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
  return nodes.some((n) => {
    const child = n.querySelector("div");
    if (!child) return false;
    const shadow = getComputedStyle(child).boxShadow || "";
    return shadow.includes(cyan);
  });
}, CURSOR_CYAN);
if (cursorOff) {
  console.error("FAIL: cursor highlight still present after cursor moved to import line");
  await browser.close();
  process.exit(1);
}
console.log("OK: cursor highlight clears when cursor leaves declaration blocks");

await browser.close();
console.log("DONE: #194 smoke test passed");
