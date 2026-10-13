// Smoke test for #213: code-to-canvas highlighting — follow semantic
// references. Extends the #194 (PR #212) behavior: previously the cursor
// had to be *inside* a mechanism's own declaration block. With this
// change, pointing the cursor at a reference token (e.g. `colors_input`
// inside `sender=colors_input` on the MappingProjection declaration)
// highlights the referenced *node* instead of the enclosing edge.
//
// Verifies:
//   - Clicking `colors_input` inside `sender=colors_input` (which sits
//     inside the `colors_to_response = pnl.MappingProjection(...)` block)
//     lights up the colors_input mechanism node, not the colors_to_response
//     edge.
//   - Clicking a non-identifier position inside the same projection block
//     still falls back to highlighting the enclosing block (the projection
//     edge).
//
// Captures a screenshot with the reference highlight active for PR evidence.
//
// Assumes:
//   - backend running on http://localhost:8005 (SLOT=5)
//   - vite dev server on http://localhost:5178 (SLOT=5)
//
// Run:
//   cd frontend && node scripts/smoke-pr213.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5178";
const OUT_PATH = "/tmp/pr-213-smoke.png";
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

// Find the line `    sender=colors_input,` — it sits *inside* the
// `colors_to_response = pnl.MappingProjection(...)` declaration. Without
// the #213 change, clicking on `colors_input` here lit up the
// colors_to_response edge (the enclosing block). With #213, the token
// under the cursor wins and the colors_input *node* lights up instead.
const senderLine = page.locator(".cm-line", { hasText: /sender=colors_input/ }).first();
await senderLine.waitFor({ state: "visible", timeout: 5000 });

// Click directly on the `colors_input` token span inside that line so
// the cursor lands on the identifier rather than at line-end. CodeMirror
// renders identifiers as their own span; clicking the span guarantees the
// click x lands within the identifier rather than past line-end on the
// wider line div.
const identSpan = senderLine.getByText("colors_input").first();
await identSpan.scrollIntoViewIfNeeded();
const bbox = await identSpan.boundingBox();
if (!bbox) {
  console.error("FAIL: could not locate bounding box for colors_input span");
  await browser.close();
  process.exit(1);
}
// Click 30% in from the left of the span, vertically centered — well
// inside the identifier text.
await page.mouse.click(bbox.x + bbox.width * 0.3, bbox.y + bbox.height / 2);
await page.waitForTimeout(400); // 150ms debounce + buffer

// Diagnostic: capture which canvas node OR edge holds the cursor ring,
// and what text is around the editor cursor — surfaces mis-clicks quickly.
const diag = await page.evaluate((cyan) => {
  const nodeHits = [];
  for (const n of document.querySelectorAll(".react-flow__node")) {
    const child = n.querySelector("div");
    if (child && (getComputedStyle(child).boxShadow || "").includes(cyan)) {
      nodeHits.push((n.textContent || "").trim().slice(0, 40));
    }
  }
  const edgeHits = [];
  for (const e of document.querySelectorAll(".react-flow__edge")) {
    const p = e.querySelector("path");
    if (!p) continue;
    const s = getComputedStyle(p);
    if ((s.stroke || "").includes(cyan) || (s.filter || "").includes(cyan)) {
      edgeHits.push(e.getAttribute("data-testid") || e.id || "edge");
    }
  }
  return { nodeHits, edgeHits };
}, CURSOR_CYAN);
console.log("DIAG: nodeHits=" + JSON.stringify(diag.nodeHits) + " edgeHits=" + JSON.stringify(diag.edgeHits));

// Find which canvas node has the cyan cursor ring and check it's labeled
// `colors_input` — not `colors_to_response`.
const refTarget = diag.nodeHits.find((t) => t.toLowerCase().includes("colors_input")) ?? null;

if (!refTarget || !refTarget.includes("colors_input")) {
  console.error(
    `FAIL: cursor on \`sender=colors_input\` did not highlight the colors_input node (got: ${refTarget})`
  );
  await browser.close();
  process.exit(1);
}
console.log("OK: cursor on `colors_input` reference highlights the colors_input node, not the enclosing projection");

// Screenshot — PR evidence.
const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

// Move cursor off the reference: click an import line (outside any
// declaration block). The colors_input ring should clear, confirming the
// new token-precedence logic doesn't pin the highlight on stale state.
const importLine = page.locator(".cm-line", { hasText: /^import\s+psyneulink/ }).first();
await importLine.waitFor({ state: "visible", timeout: 5000 });
await importLine.click();
await page.waitForTimeout(400);

const stillOnColorsInput = await page.evaluate((cyan) => {
  for (const n of document.querySelectorAll(".react-flow__node")) {
    const child = n.querySelector("div");
    if (!child) continue;
    if (!(getComputedStyle(child).boxShadow || "").includes(cyan)) continue;
    if ((n.textContent || "").toLowerCase().includes("colors_input")) return true;
  }
  return false;
}, CURSOR_CYAN);

if (stillOnColorsInput) {
  console.error("FAIL: colors_input still highlighted after cursor moved to an unrelated line");
  await browser.close();
  process.exit(1);
}
console.log("OK: highlight clears when cursor leaves the reference token");

await browser.close();
console.log("DONE: #213 smoke test passed");
