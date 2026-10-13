// Smoke test for #460: the run-capture now emits the previously-dropped
// _debugger categories. Drives a real Stroop run on the worktree backend and
// asserts the captured debuggerSnapshots include the newly-restored
// categories, and that the snapshot table renders their filter chips + rows.
//
// Assumes: worktree backend on :8001 (fork PsyNeuLink w/ _debugger hook),
//          vite dev build on http://localhost:5198 (exposes window.__modelStore).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR460_URL || "http://localhost:5198";
const OUT = "/tmp/pr-460-smoke";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "✅" : "❌"} ${m}`); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Load Stroop
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/Stroop — Basic/).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(300);
const tas = page.locator("textarea");
const n = await tas.count();
for (let i = 0; i < n; i++) await tas.nth(i).fill("1,0\n0,1");

// Run
await page.getByRole("button", { name: /Run Model/ }).first().click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
await page.waitForTimeout(500);

// Inspect captured categories (store is authoritative)
const snaps = await page.evaluate(() => window.__modelStore.getState().debuggerSnapshots || []);
const cats = {};
for (const s of snaps) cats[s.category] = (cats[s.category] || 0) + 1;
console.log("category counts:", JSON.stringify(cats));

const restored = ["INPUTS_TO_NODE", "END_OF_EXECUTION_SET", "PARAMETER_SETTING", "BEGINNING_OF_RUN", "END_OF_RUN"];
for (const c of restored) assert((cats[c] || 0) > 0, `captured ${c} snapshots (${cats[c] || 0})`);

// PARAMETER_SETTING must be bounded by its per-category cap (500), so it can't
// starve the low-volume categories within the global budget.
assert((cats.PARAMETER_SETTING || 0) <= 500, `PARAMETER_SETTING bounded by its cap (${cats.PARAMETER_SETTING})`);
// And the low-volume categories trace stepping needs must all survive.
assert((cats.EXECUTION_SET || 0) > 0 && (cats.NODE_EXECUTION || 0) > 0, "EXECUTION_SET + NODE_EXECUTION still captured alongside PARAMETER_SETTING");

// An INPUTS_TO_NODE snapshot should carry a node + output payload
const inp = snaps.find((s) => s.category === "INPUTS_TO_NODE");
assert(inp && typeof inp.node === "string", "INPUTS_TO_NODE snapshot carries a node name");

// Render: open the Debugger snapshots <details> and confirm new chips appear
await page.getByText(/Debugger snapshots/).first().click();
await page.waitForTimeout(400);
const bodyText = await page.evaluate(() => document.body.innerText);
assert(/PARAMETER_SETTING/.test(bodyText), "snapshot table shows a PARAMETER_SETTING chip/row");
assert(/INPUTS_TO_NODE/.test(bodyText), "snapshot table shows an INPUTS_TO_NODE chip/row");
await page.screenshot({ path: `${OUT}/snapshot-table.png`, fullPage: true });

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
