// Live verification for #468: pinnable, exportable run records.
// Confirms each completed run pins a record in the Recent runs list with
// frozen inputs; Re-run reproduces from those inputs (restoring the form);
// Export downloads a psyneuview-run/v1 JSON sidecar that Import round-trips
// back into the form; malformed imports fail loudly; rows remove and clear.
//
// Assumes worktree vite on http://localhost:5197 pointed at backend :8000.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const FRONTEND = process.env.PR468_URL || "http://localhost:5197";
const OUT = "/tmp/pr-468-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Load Stroop and open the Run panel.
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/Stroop — Basic/).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(400);

// 1) Empty state before any run.
assert(
  await page.getByText(/No runs yet — run the model/).isVisible(),
  "empty state shows before any run",
);

const waitForRun = async () => {
  await page.waitForFunction(() => {
    const s = window.__modelStore && window.__modelStore.getState();
    return s && s.executionTrace && s.executionTrace.length > 0;
  }, { timeout: 40000 });
};

// Wait for the Recent-runs count to reach N. Used after Re-run, where the
// previous run's executionTrace is still present so a trace-length wait
// would return immediately.
const waitForRecordCount = async (n) => {
  await page.waitForFunction((target) => {
    const txt = document.body.innerText;
    return new RegExp(`Recent runs \\(${target}\\)`).test(txt);
  }, n, { timeout: 40000 });
};

// Run-panel file input only (the toolbar has its own model-import file input).
const runFileInput = page.locator('input[type="file"][accept*="application/json"]');

// 2) Run the model → one record pinned with composition + trial count.
const runBtn = page.getByRole("button", { name: /Run Model/ });
await runBtn.click();
await waitForRun();
await page.waitForTimeout(300);
assert(await page.getByText(/Recent runs \(1\)/).isVisible(), "run pins a record (Recent runs (1))");
const row = page.locator('[title^="Saved run"]').first();
const rowText = await row.innerText();
assert(/trials?/.test(rowText), `record row shows trial count ("${rowText.replace(/\n/g, " · ")}")`);
await page.screenshot({ path: `${OUT}/record-pinned.png`, fullPage: true });

// 3) Frozen-inputs probe: mutate a form cell, then Re-run → the record's
//    original inputs are restored into the form and a second record appears.
const firstCell = page.locator('input[inputmode="decimal"]').first();
const originalVal = await firstCell.inputValue();
await firstCell.fill("9");
await page.waitForTimeout(150);
await page.getByRole("button", { name: "Re-run" }).first().click();
await waitForRecordCount(2);
const restoredVal = await page.locator('input[inputmode="decimal"]').first().inputValue();
assert(
  restoredVal === originalVal,
  `Re-run restores the frozen inputs (cell "${restoredVal}" vs original "${originalVal}", not the edited "9")`,
);
assert(await page.getByText(/Recent runs \(2\)/).isVisible(), "Re-run pins a second record");

// 4) Export: capture the download, validate the artifact.
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Export" }).first().click(),
]);
const fname = download.suggestedFilename();
assert(/\.run\..+\.json$/.test(fname), `export filename has .run.<ts>.json shape ("${fname}")`);
const exportPath = `${OUT}/${fname}`;
await download.saveAs(exportPath);
const exported = JSON.parse(readFileSync(exportPath, "utf8"));
assert(exported.format === "psyneuview-run/v1", "exported file declares format psyneuview-run/v1");
assert(
  Array.isArray(exported.inputs) && exported.inputs.every((i) => Array.isArray(i.trials) && i.trials.every((t) => t.every((v) => typeof v === "number"))),
  `exported inputs carry numeric trial vectors (${exported.inputs?.length} nodes, ${exported.numTrials} trials)`,
);
assert(Array.isArray(exported.results?.results), "exported file embeds the run results");

// 5) Import round-trip: scribble the form, import the exported file → cells
//    repopulate to the exported values without auto-running.
await page.locator('input[inputmode="decimal"]').first().fill("7");
const tracesBefore = await page.evaluate(() => window.__modelStore.getState().executionTrace.length);
await runFileInput.setInputFiles(exportPath);
await page.waitForTimeout(300);
const importedVal = await page.locator('input[inputmode="decimal"]').first().inputValue();
const expectedVal = String(exported.inputs[0].trials[0][0]);
assert(importedVal === expectedVal, `import repopulates form cells from the file ("${importedVal}" = exported ${expectedVal})`);
const recCount = await page.getByText(/Recent runs \(\d+\)/).innerText();
assert(/\(2\)/.test(recCount), `import does not auto-run or pin a record (still ${recCount})`);
const tracesAfter = await page.evaluate(() => window.__modelStore.getState().executionTrace.length);
assert(tracesAfter === tracesBefore, "import does not trigger a run (trace untouched)");

// 6) Malformed-import probe: garbage file → loud inline error, no crash.
const badPath = `${OUT}/not-a-run.json`;
writeFileSync(badPath, '{"hello": "world"}');
await runFileInput.setInputFiles(badPath);
await page.waitForTimeout(300);
assert(
  await page.getByText(/Not a PsyNeuView run file/).isVisible(),
  "malformed import surfaces an inline error",
);
await page.screenshot({ path: `${OUT}/import-error.png`, fullPage: true });

// 7) Remove one row (record-row ✕ has title="Remove this run from history",
//    distinct from the trial-remove ✕ in the input editor above), then Clear
//    the rest → back to the empty state.
await page.locator('button[title="Remove this run from history"]').first().click();
await waitForRecordCount(1);
assert(await page.getByText(/Recent runs \(1\)/).isVisible(), "✕ removes one record");
await page.getByRole("button", { name: "Clear", exact: true }).click();
await page.waitForTimeout(200);
assert(
  await page.getByText(/No runs yet — run the model/).isVisible(),
  "Clear empties the history back to the empty state",
);

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
