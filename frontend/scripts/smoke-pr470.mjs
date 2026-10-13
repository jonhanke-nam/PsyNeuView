// Smoke test for #470: trial-nav fallback when the PsyNeuLink build lacks the
// `_debugger` hook.
//
// Standing dual-source check for run stepping / debugging. Asserts:
//   A. HOOK PATH (real run on a debugger-enabled backend): a multi-trial Stroop
//      run yields >1 trial boundary and the trace stepper shows trial nav
//      (⏮/⏭ + run/trial toggle).
//   B. FALLBACK PATH (simulated hook-less response, driven through the store):
//      a run that returns boundaries=[0] but numTrials=2 derives even
//      boundaries so trial nav still renders — instead of silently vanishing.
//   C. SINGLE-TRIAL: boundaries=[0], numTrials=1 → no trial nav (correct).
//
// Assumes:
//   - backend on http://localhost:8000 (debugger-enabled fork → covers path A)
//   - vite dev server for the #470 worktree on http://localhost:5199
//   - dev build (window.__modelStore exposed)

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR470_URL || "http://localhost:5199";
const OUT = "/tmp/pr-470-smoke";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? "✅" : "❌"} ${msg}`); };
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Probe the TRACE control bar's trial-nav affordances.
async function traceBar() {
  return await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll("span")).find((s) => (s.textContent || "").trim() === "TRACE");
    if (!span) return { found: false };
    const bar = span.parentElement;
    const buttons = Array.from(bar.querySelectorAll("button")).map((b) => (b.textContent || "").trim());
    return {
      found: true,
      hasTrialToggle: buttons.includes("run") && buttons.includes("trial"),
      hasTrialArrows: buttons.includes("⏮") || buttons.includes("⏭"),
    };
  });
}

// ── Path A: real run on the (debugger-enabled) backend ──────────────────────
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/Stroop — Basic/).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(300);
const tas = page.locator("textarea");
const n = await tas.count();
for (let i = 0; i < n; i++) await tas.nth(i).fill("1,0\n0,1");
await page.getByRole("button", { name: /Run Model/ }).first().click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
await page.waitForTimeout(500);

const aState = await page.evaluate(() => {
  const s = window.__modelStore.getState();
  return { boundaries: s.executionTrialBoundaries, snaps: s.debuggerSnapshots.length };
});
console.log("Path A store:", JSON.stringify(aState));
const aBar = await traceBar();
if (aState.snaps > 0) {
  assert(aState.boundaries.length > 1, "A: hook run yields >1 trial boundary");
  assert(aBar.hasTrialToggle && aBar.hasTrialArrows, "A: trial nav (toggle + arrows) renders on hook build");
} else {
  console.log("⚠️  Path A skipped — backend returned 0 snapshots (not a debugger build). Paths B/C still cover the fallback.");
}
await page.screenshot({ path: `${OUT}/A-hook-run.png` });

// ── Path B: simulated hook-less multi-trial response via the store ──────────
const TRACE8 = [["a"],["b"],["c"],["d"],["a"],["b"],["c"],["d"]];
await page.evaluate((trace) => window.__modelStore.getState().setExecutionTrace(trace, {}, [0], 2), TRACE8);
await page.waitForTimeout(300);
const bBoundaries = await page.evaluate(() => window.__modelStore.getState().executionTrialBoundaries);
console.log("Path B boundaries:", JSON.stringify(bBoundaries));
assert(eqArr(bBoundaries, [0, 4]), "B: boundaries=[0],numTrials=2,8 steps → derived [0,4]");
const bBar = await traceBar();
assert(bBar.hasTrialToggle && bBar.hasTrialArrows, "B: trial nav renders on hook-less build via fallback");
await page.screenshot({ path: `${OUT}/B-fallback.png` });

// ── Path C: single-trial → no fabricated nav ────────────────────────────────
await page.evaluate((trace) => window.__modelStore.getState().setExecutionTrace(trace, {}, [0], 1), TRACE8);
await page.waitForTimeout(300);
const cBoundaries = await page.evaluate(() => window.__modelStore.getState().executionTrialBoundaries);
console.log("Path C boundaries:", JSON.stringify(cBoundaries));
assert(eqArr(cBoundaries, [0]), "C: numTrials=1 → boundaries stay [0] (no trial nav)");
const cBar = await traceBar();
assert(!cBar.hasTrialToggle && !cBar.hasTrialArrows, "C: trial nav hidden for single-trial run");

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
