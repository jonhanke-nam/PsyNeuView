// Smoke test for #184 (PR #205): port dots — colored input/output/parameter dots
// on mechanism nodes, plus toolbar show/hide toggle.
//
// Verifies:
//   - Loading simple_stroop renders mechanism nodes with visible port dots
//     by default (showPortDots=true).
//   - The toolbar "Ports" toggle is present and reflects the active state.
//   - Toggling it off hides the port dots (verified via toolbar active state
//     and a screenshot).
//
// Captures a screenshot of the canvas with port dots visible for PR evidence.
//
// Assumes:
//   - backend running on http://localhost:8005 (SLOT=5)
//   - vite dev server on http://localhost:5178 (SLOT=5)
//
// Run:
//   cd frontend && node scripts/smoke-pr184.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5178";
const OUT_PATH = "/tmp/pr-184-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();
await page.locator(".react-flow__node").first().waitFor({ state: "visible", timeout: 5000 });
console.log("OK: simple_stroop loaded");

// Toolbar "Ports" toggle should be active by default.
const portsBtn = page.getByRole("button", { name: /^Ports$/ });
await portsBtn.waitFor({ state: "visible", timeout: 5000 });
const initiallyActive = await portsBtn.evaluate((el) => {
  const cs = getComputedStyle(el);
  return cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
});
if (!initiallyActive) {
  console.error("FAIL: Ports toggle should start active (showPortDots=true by default)");
  await browser.close();
  process.exit(1);
}
console.log("OK: Ports toolbar toggle present and active by default");

// Confirm React Flow Handle dots are rendered on mechanism nodes.
const handleCount = await page.locator(".react-flow__handle").count();
if (handleCount === 0) {
  console.error("FAIL: no .react-flow__handle elements rendered — port dots missing");
  await browser.close();
  process.exit(1);
}
console.log(`OK: ${handleCount} port handles rendered with port dots on`);

// Screenshot with port dots visible — PR evidence.
const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

// Toggle ports off, confirm React Flow handle dots become hidden.
await portsBtn.click();
await page.waitForTimeout(150);
const visibleAfter = await page.evaluate(() => {
  const handles = Array.from(document.querySelectorAll(".react-flow__handle"));
  return handles.filter((h) => getComputedStyle(h).visibility !== "hidden").length;
});
if (visibleAfter > 0) {
  console.error(`FAIL: ${visibleAfter} port handles still visible after toggle — expected all hidden`);
  await browser.close();
  process.exit(1);
}
console.log("OK: port handles hidden after toggle");

await browser.close();
console.log("DONE: #184 smoke test passed");
