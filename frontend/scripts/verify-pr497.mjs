// Live verification for #497: per-trial value cards stack vertically (one
// full-width card per trial instead of a wrapping two-up row), keep every
// trial visible, and the active "● stepping" card follows the trace stepper
// into view. Drives the real UI and reads card geometry off the DOM.
//
// Default ports: frontend :5173, backend :8000 (_debugger-enabled build).
// Override with FRONTEND_URL= for a non-default slot.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5173";
const OUT = "/tmp/pr-497-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Load Stroop Basic and run it.
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText("Stroop Basic", { exact: true }).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: /Run Model/ }).click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
await page.waitForTimeout(500);

const cards = page.locator('[title^="Jump trace to trial"]');
const n = await cards.count();
assert(n > 1, `multiple per-trial cards render (${n})`);

// Geometry: cards should stack vertically (each below the previous, same left
// edge) rather than wrap into a row.
const boxes = [];
for (let i = 0; i < n; i++) boxes.push(await cards.nth(i).boundingBox());
let stacked = true;
let sameColumn = true;
for (let i = 1; i < boxes.length; i++) {
  if (!(boxes[i].y > boxes[i - 1].y + boxes[i - 1].height - 4)) stacked = false; // strictly below
  if (Math.abs(boxes[i].x - boxes[0].x) > 2) sameColumn = false; // same left edge
}
assert(stacked, `cards are stacked top-to-bottom (ys: ${boxes.map((b) => Math.round(b.y)).join(", ")})`);
assert(sameColumn, `cards share one column (xs: ${boxes.map((b) => Math.round(b.x)).join(", ")})`);

// Full-width: the old layout capped cards at maxWidth 320. A stacked card in
// this panel should be comfortably wider than that.
assert(boxes[0].width > 340, `cards are full-width, not capped at 320 (width ${Math.round(boxes[0].width)})`);

await page.screenshot({ path: `${OUT}/cards-stacked.png`, fullPage: true });

// Active card follows the trace. Step to the last trial's boundary and confirm
// the "● stepping" badge moves to that card and the card is in the viewport.
const boundaries = await page.evaluate(() => window.__modelStore.getState().executionTrialBoundaries);
const lastTrial = boundaries.length - 1;
await page.evaluate((s) => window.__modelStore.getState().setTraceStep(s), boundaries[lastTrial]);
await page.waitForTimeout(1200);

const steppingTrial = await page.evaluate(() => {
  const badges = [...document.querySelectorAll("span")].filter((s) => s.textContent.trim() === "● stepping");
  if (badges.length !== 1) return { count: badges.length };
  const card = badges[0].closest('[title^="Jump trace to trial"]');
  const headerSpan = card?.querySelector("span");
  return { count: 1, header: headerSpan?.textContent?.trim() ?? null };
});
assert(steppingTrial.count === 1, `exactly one card shows "● stepping" (${steppingTrial.count})`);
assert(steppingTrial.header === `Trial ${lastTrial + 1}`, `"● stepping" is on the last trial card (got "${steppingTrial.header}")`);

// "In view" means visible within the panel's own scroll container, not the
// window — the panel's scroll viewport can extend past the window bottom.
const view = await page.evaluate(() => {
  const badge = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "● stepping");
  const card = badge?.closest('[title^="Jump trace to trial"]');
  if (!card) return null;
  let sc = card.parentElement;
  while (sc && sc !== document.body) {
    const oy = getComputedStyle(sc).overflowY;
    if ((oy === "auto" || oy === "scroll") && sc.scrollHeight > sc.clientHeight + 1) break;
    sc = sc.parentElement;
  }
  const cr = card.getBoundingClientRect();
  const kr = sc && sc !== document.body ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  return {
    cardTop: Math.round(cr.top), cardBottom: Math.round(cr.bottom),
    contTop: Math.round(kr.top), contBottom: Math.round(kr.bottom),
  };
});
console.log("active-card vs container:", JSON.stringify(view));
// Visible if the card overlaps the container's visible band and its top is at/below the container top.
const inView = view && view.cardTop >= view.contTop - 1 && view.cardTop < view.contBottom;
assert(inView, `active card is scrolled into the panel's view (${JSON.stringify(view)})`);
await page.screenshot({ path: `${OUT}/last-trial-active.png`, fullPage: true });

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
