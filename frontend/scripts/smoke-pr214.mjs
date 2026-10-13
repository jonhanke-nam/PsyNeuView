// Smoke screenshot for PR #214 (issue #210):
// loads simple_stroop demo, opens the inspector for the `response` mechanism,
// asserts the new output-port read-only tooltip text, and screenshots the
// inspector panel.
//
// Assumes:
//   - backend running on http://localhost:8000
//   - vite dev server (with this worktree's frontend) on http://localhost:5174

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5174";
const EXPECTED_TOOLTIP =
  "Output port shape is fixed by the mechanism's function (it indexes into owner.value) — not editable independently.";
const OUT_PATH = "/tmp/pr-214-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

// Use the toolbar's "Load Model" dropdown to pick simple_stroop.
await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();

// Wait for the graph to render — at least one React Flow node visible.
await page.locator(".react-flow__node").first().waitFor({ state: "visible" });

// Click the `response` mechanism (has a single output port with shape [2]).
await page.locator(".react-flow__node", { hasText: "response" }).first().click();

// Inspector should now show the output-port row. Wait for the "Outputs" label.
await page.getByText("Outputs", { exact: true }).waitFor({ state: "visible" });

// The shape span has the new title. Locate by exact text in the Ports section.
const shapeSpan = page.locator('span[title]').filter({ hasText: /^\[2\]$/ }).first();
await shapeSpan.waitFor({ state: "visible" });

const actualTitle = await shapeSpan.getAttribute("title");
if (actualTitle !== EXPECTED_TOOLTIP) {
  console.error("FAIL: tooltip mismatch");
  console.error("  expected:", JSON.stringify(EXPECTED_TOOLTIP));
  console.error("  actual:  ", JSON.stringify(actualTitle));
  await browser.close();
  process.exit(1);
}
console.log("OK: tooltip title matches expected text");

// Hover so a real native tooltip *might* render (best effort; Playwright
// can't reliably capture native title tooltips, so we also screenshot the
// inspector itself as visual context).
await shapeSpan.hover();
await page.waitForTimeout(1500);

// Inject a synthetic tooltip rendering so the screenshot includes the text
// as visible evidence (native title attributes are unreliable in screenshots).
// Larger font + leader line + outline ring so it reads well in a PR comment.
await page.evaluate(({ text }) => {
  const span = Array.from(document.querySelectorAll("span[title]")).find(
    (el) => el.getAttribute("title") === text,
  );
  if (!span) return;
  const r = span.getBoundingClientRect();

  // Outline ring around the [shape] span so the reader sees what's being annotated.
  const ring = document.createElement("div");
  Object.assign(ring.style, {
    position: "fixed",
    left: `${r.left - 4}px`,
    top: `${r.top - 4}px`,
    width: `${r.width + 8}px`,
    height: `${r.height + 8}px`,
    border: "2px solid #d93025",
    borderRadius: "4px",
    zIndex: "999998",
    pointerEvents: "none",
  });
  ring.setAttribute("data-pw-smoke-ring", "1");
  document.body.appendChild(ring);

  // Tooltip itself — bigger, higher contrast, positioned just under the ring.
  const tip = document.createElement("div");
  tip.textContent = text;
  const tipLeft = Math.max(16, Math.min(window.innerWidth - 480, r.left - 100));
  Object.assign(tip.style, {
    position: "fixed",
    left: `${tipLeft}px`,
    top: `${r.bottom + 12}px`,
    maxWidth: "460px",
    padding: "10px 14px",
    background: "#1f1f1f",
    color: "#fff",
    font: "14px -apple-system, BlinkMacSystemFont, sans-serif",
    borderRadius: "6px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
    zIndex: "999999",
    pointerEvents: "none",
    whiteSpace: "normal",
    lineHeight: "1.45",
    border: "2px solid #d93025",
  });
  tip.setAttribute("data-pw-smoke-tooltip", "1");
  document.body.appendChild(tip);
}, { text: EXPECTED_TOOLTIP });

await page.waitForTimeout(200);

// Crop to a region around the inspector + tooltip overlay so the screenshot
// reads well in a PR comment. We anchor on the shape span and expand outward.
const clip = await page.evaluate(() => {
  const span = Array.from(document.querySelectorAll("span[title]")).find(
    (el) => el.textContent?.trim() === "[2]",
  );
  const tip = document.querySelector('[data-pw-smoke-tooltip="1"]');
  if (!span || !tip) return null;
  const sr = span.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  const left = Math.max(0, Math.min(sr.left, tr.left) - 32);
  const top = Math.max(0, sr.top - 220);
  const right = Math.min(window.innerWidth, Math.max(sr.right, tr.right) + 32);
  const bottom = Math.min(window.innerHeight, tr.bottom + 32);
  return { x: left, y: top, width: right - left, height: bottom - top };
});

const png = await page.screenshot(clip ? { clip } : { fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

await browser.close();
