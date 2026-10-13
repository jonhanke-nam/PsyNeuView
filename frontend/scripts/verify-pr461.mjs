// Live verification for #461: element-labeled, structured input authoring.
// Confirms the Run panel now renders per-element labeled numeric cells grouped
// per trial (not a free-form CSV textarea), validates at edit time, supports
// add/remove trial + CSV-paste, and still runs the model end to end.
//
// Assumes worktree backend on :8001 and vite dev build on http://localhost:5198.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR461_URL || "http://localhost:5198";
const OUT = "/tmp/pr-461-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Load Stroop (its input ports carry element_names → labeled slots).
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/Stroop — Basic/).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(400);

// 1) Element labels render as slot headers (Stroop: red_ink / green_ink etc.).
const body = await page.evaluate(() => document.body.innerText);
assert(/red_ink/.test(body) && /green_ink/.test(body), "input slots show element labels (red_ink / green_ink)");

// 2) No free-form textarea for the inputs anymore — cells are <input>s. Count
//    numeric cell inputs (should be numTrials * elements per input node > 0).
const cellCount = await page.locator('input[inputmode="decimal"]').count();
assert(cellCount > 0, `structured numeric cells render (${cellCount} input cells)`);

await page.screenshot({ path: `${OUT}/editor-default.png`, fullPage: true });

// 3) Edit-time validation: type garbage into a cell → Run Model disables.
const firstCell = page.locator('input[inputmode="decimal"]').first();
await firstCell.fill("abc");
await page.waitForTimeout(200);
const runBtn = page.getByRole("button", { name: /Run Model/ });
assert(await runBtn.isDisabled(), "invalid cell disables Run Model");
const afterBad = await page.evaluate(() => document.body.innerText);
assert(/aren't numbers|Not a number|fix the highlighted/i.test(afterBad), "invalid input surfaces a hint");
await page.screenshot({ path: `${OUT}/editor-invalid.png`, fullPage: true });

// Repair the cell → Run re-enables.
await firstCell.fill("1");
await page.waitForTimeout(200);
assert(!(await runBtn.isDisabled()), "fixing the cell re-enables Run Model");

// 4) Add trial increases the cell count by one row's worth.
const before = await page.locator('input[inputmode="decimal"]').count();
await page.getByRole("button", { name: /Add trial/ }).click();
await page.waitForTimeout(200);
const after = await page.locator('input[inputmode="decimal"]').count();
assert(after > before, `Add trial adds a row (${before} → ${after} cells)`);

// 5) CSV paste maps a block into the cells. Open the first node's Paste CSV,
//    apply "5,6\n7,8" (2 trials) into a node and confirm a cell now holds 5.
//    The grid was just bumped to 6 trials by Add trial above, so this also
//    exercises the resync: pasting fewer rows into one node must shrink EVERY
//    node to the pasted count, else the run carries mismatched lengths and
//    PsyNeuLink rejects it.
await page.getByText("Paste CSV", { exact: true }).first().click();
await page.waitForTimeout(150);
const csvTa = page.locator("textarea").first();
await csvTa.fill("5,6\n7,8");
await page.getByRole("button", { name: /Apply to cells/ }).first().click();
await page.waitForTimeout(200);
const firstVal = await page.locator('input[inputmode="decimal"]').first().inputValue();
assert(firstVal === "5", `CSV paste mapped into cells (first cell now "${firstVal}")`);

// All nodes share one trial count: each "Trial N" row label appears once per
// input node, so the visible count must be a multiple of the node count and
// reflect 2 trials (not the pre-paste 6).
const trialRowLabels = await page.getByText(/^Trial \d+$/).count();
const nodeCount = await page.getByText(/\[\d+ elements?\]/).count();
assert(
  nodeCount > 0 && trialRowLabels === 2 * nodeCount,
  `CSV paste resyncs every node to 2 trials (${trialRowLabels} row labels / ${nodeCount} nodes)`,
);

// 6) Still runs end to end with the structured inputs (2 trials after resync).
await runBtn.click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
const trace = await page.evaluate(() => window.__modelStore.getState().executionTrace.length);
assert(trace > 0, `model runs with structured inputs (trace length ${trace})`);
await page.screenshot({ path: `${OUT}/editor-after-run.png`, fullPage: true });

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
