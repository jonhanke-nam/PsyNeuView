// Live verification for #496: the legacy Run-panel "Trace: ◀ Trial N ▶ Clear"
// stepper (which only drove the orange highlight overlay, decoupled from the
// real traceStep) is removed, leaving a single trial concept driven by
// traceStep — the graph TRACE bar + clickable per-trial cards. Confirms the
// duplicate control is gone, the per-trial cards still drive traceStep, and
// the value pill / "● stepping" highlight still track the active trial.
//
// Default ports: frontend :5173, backend :8000 (must be a _debugger-enabled
// PsyNeuLink build so snapshots carry per-node output). Override with
// FRONTEND_URL= when running on a non-default slot.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5173";
const OUT = "/tmp/pr-496-verify";
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

// 1) The legacy "Trace:" stepper label is gone (the graph bar uses "TRACE",
//    no colon — so an exact "Trace:" match would only be the removed control).
const traceColonCount = await page.getByText("Trace:", { exact: true }).count();
assert(traceColonCount === 0, `legacy Run-panel "Trace:" stepper removed (found ${traceColonCount})`);

// 2) graphSettings no longer exposes the highlight API (dead machinery gone).
const storeShape = await page.evaluate(() => {
  // Reach the graphSettings store via a rendered node if exposed; otherwise
  // just confirm no orange glow is ever applied (checked below). We assert the
  // model store still drives stepping.
  const s = window.__modelStore.getState();
  return { traceLen: s.executionTrace.length, traceStep: s.traceStep, boundaries: s.executionTrialBoundaries };
});
assert(storeShape.traceLen > 0, `trace present (${storeShape.traceLen} steps, ${storeShape.boundaries.length} trial boundaries)`);

// 3) Per-trial cards still render and are clickable to jump traceStep.
const cardCount = await page.getByText(/^Trial \d+$/).count();
assert(cardCount > 0, `per-trial cards render (${cardCount} trial headers)`);

// Click the 3rd trial's card -> traceStep should jump to its boundary and
// that card should show the "● stepping" badge.
const boundaries = storeShape.boundaries;
if (boundaries.length >= 3) {
  await page.getByText("Trial 3", { exact: true }).first().click();
  await page.waitForTimeout(300);
  const stepAfter = await page.evaluate(() => window.__modelStore.getState().traceStep);
  assert(stepAfter === boundaries[2], `clicking Trial 3 card jumps traceStep to its boundary (step ${stepAfter} === ${boundaries[2]})`);

  // The "● stepping" badge should now sit in the Trial 3 card. Find the card
  // div containing "Trial 3" and check it also contains "stepping".
  const trial3Stepping = await page.evaluate(() => {
    const headers = [...document.querySelectorAll("span")].filter((s) => s.textContent.trim() === "Trial 3");
    for (const h of headers) {
      const card = h.closest("div[title]") || h.parentElement?.parentElement;
      if (card && /stepping/.test(card.textContent || "")) return true;
    }
    return false;
  });
  assert(trial3Stepping, `"● stepping" highlight follows to the clicked Trial 3 card`);
  await page.screenshot({ path: `${OUT}/trial3-active.png`, fullPage: true });
}

// 4) Stepping the trace bar still paints the value pill on the active node
//    (regression check that the consolidated stepper drives the pill).
await page.evaluate(() => window.__modelStore.getState().setTraceStep(0));
await page.waitForTimeout(300);
const pillAtStep0 = await page.evaluate(() => {
  for (const el of document.querySelectorAll("div")) {
    if (getComputedStyle(el).backgroundColor === "rgb(230, 244, 230)" && el.textContent.trim()) return el.textContent.trim();
  }
  return null;
});
assert(pillAtStep0 !== null, `value pill still renders on the active node at step 0 (pill="${pillAtStep0}")`);

// 5) No orange highlight glow anywhere (the removed overlay).
const orangeGlow = await page.evaluate(() => {
  for (const node of document.querySelectorAll(".react-flow__node div")) {
    if ((getComputedStyle(node).boxShadow || "").includes("255, 152, 0")) return true;
  }
  return false;
});
assert(!orangeGlow, `no orange per-trial highlight glow remains`);

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
