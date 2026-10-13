// Live verification for #433: a new model wipes the Run panel.
// Loads model A, runs it (so results + trace populate), switches to model B,
// confirms the Run panel is empty (no results table, no trace stepper, no
// per-node active value pills on the canvas).
//
// Assumes worktree vite on http://localhost:5198 pointed at backend :8000.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR433_URL || "http://localhost:5198";
const OUT = "/tmp/pr-433-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// 1) Load model A (Stroop — Basic) and run.
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/Stroop — Basic/).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(400);
await page.getByRole("button", { name: /Run Model/ }).click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
await page.waitForTimeout(300);

const filePathA = await page.evaluate(() => window.__modelStore.getState().filePath);
const traceLenA = await page.evaluate(() => window.__modelStore.getState().executionTrace.length);
assert(traceLenA > 0, `model A ran (trace ${traceLenA} steps, filePath ${filePathA.split("/").pop()})`);
assert(await page.getByText(/Results \(\d+ trials?\)/).isVisible(), "model A shows Results header");
await page.screenshot({ path: `${OUT}/A-after-run.png`, fullPage: true });

// 2) Switch to a different model (any other demo). Use Simple Stroop.
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/^Simple Stroop$/).first().click();
await page.waitForFunction((prev) => {
  const fp = window.__modelStore?.getState()?.filePath;
  return fp && fp !== prev;
}, filePathA, { timeout: 25000 });
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.waitForTimeout(500);

// 3) Run panel should be empty on model B. Open it.
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(300);

const traceLenB = await page.evaluate(() => window.__modelStore.getState().executionTrace.length);
const traceStepB = await page.evaluate(() => window.__modelStore.getState().traceStep);
const stepValsB = await page.evaluate(() => window.__modelStore.getState().traceStepValues.size);
const snapsB = await page.evaluate(() => window.__modelStore.getState().debuggerSnapshots.length);
assert(traceLenB === 0, `executionTrace cleared on new model (length ${traceLenB})`);
assert(traceStepB === null, `traceStep cleared on new model (step ${traceStepB})`);
assert(stepValsB === 0, `traceStepValues cleared on new model (size ${stepValsB})`);
assert(snapsB === 0, `debuggerSnapshots cleared on new model (length ${snapsB})`);

// No "Results (N trials)" header on the panel — chart + table gone.
const hasResultsHdr = await page.getByText(/Results \(\d+ trials?\)/).isVisible().catch(() => false);
assert(!hasResultsHdr, "Run panel no longer shows the previous model's Results header");

// No green active-step pills on the canvas (those are gated on traceStep).
const greenPills = await page.evaluate(() => {
  const divs = Array.from(document.querySelectorAll(".react-flow__node div"));
  return divs.filter((d) => getComputedStyle(d).backgroundColor === "rgb(230, 244, 230)").length;
});
assert(greenPills === 0, `no leftover active-step pills on canvas (${greenPills})`);
await page.screenshot({ path: `${OUT}/B-clean.png`, fullPage: true });

// 4) Sanity probe: run model B → fresh results appear from a clean slate.
await page.getByRole("button", { name: /Run Model/ }).click();
await page.waitForFunction(() => {
  const s = window.__modelStore.getState();
  return s.executionTrace.length > 0;
}, { timeout: 40000 });
const traceLenB2 = await page.evaluate(() => window.__modelStore.getState().executionTrace.length);
assert(traceLenB2 > 0, `model B can run after the switch (trace ${traceLenB2} steps)`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
