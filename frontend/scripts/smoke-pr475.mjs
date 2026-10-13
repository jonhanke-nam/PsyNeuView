// Smoke test for #475: surface PsyNeuLink feature-compatibility status across
// the three UI surfaces — Settings gear row, run-panel note, trace-view badge.
//
// Asserts:
//   A. SETTINGS ROW (real backend): the gear panel's Environment section shows
//      a "Debugging support" row reflecting /api/settings/info → features. On a
//      hook-enabled fork backend this reads "Full"; on stock it reads "Basic".
//   B. HOOK-LESS RUN (route-intercepted): a real Stroop run whose /api/model/run
//      response is rewritten to debuggerHookAvailable=false renders the
//      run-panel "Basic debugging support" note AND the trace bar "basic" badge.
//   C. FULL RUN (no interception): a real run on the hook backend shows neither
//      the note nor the badge (full support → nothing to warn about).
//
// Assumes:
//   - a backend whose /api/settings/info includes `features` (this worktree's
//     backend) reachable through the vite proxy
//   - vite dev server on http://localhost:5198 (dev build → window.__modelStore)

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR475_URL || "http://localhost:5198";
const OUT = "/tmp/pr-475-smoke";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? "✅" : "❌"} ${msg}`); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Does the TRACE control bar show the hook-less "basic" badge?
async function traceHasBasicBadge() {
  return await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll("span")).find((s) => (s.textContent || "").trim() === "TRACE");
    if (!span) return false;
    const bar = span.parentElement;
    return Array.from(bar.querySelectorAll("span")).some((s) => (s.textContent || "").trim() === "basic");
  });
}

// ── Path A: Settings gear "Debugging support" row ───────────────────────────
await page.getByRole("button", { name: "Settings" }).first().click();
await page.waitForTimeout(500);
const settingsText = await page.evaluate(() => document.body.innerText);
const hasSupportRow = /Debugging support/.test(settingsText);
assert(hasSupportRow, "A: Settings shows a 'Debugging support' row");
const supportFull = /Debugging support[\s\S]*?Full —/.test(settingsText);
const supportBasic = /Debugging support[\s\S]*?Basic —/.test(settingsText);
assert(supportFull || supportBasic, "A: support row states Full or Basic");
console.log(`Path A support level: ${supportFull ? "Full" : supportBasic ? "Basic" : "??"}`);
await page.screenshot({ path: `${OUT}/A-settings-row.png` });
// Close the panel (click backdrop / escape).
await page.keyboard.press("Escape").catch(() => {});
await page.evaluate(() => { const el = document.querySelector('[style*="position: fixed"]'); if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }).catch(() => {});
await page.waitForTimeout(300);

// ── Load Stroop ─────────────────────────────────────────────────────────────
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/Stroop — Basic/).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(300);
const tas = page.locator("textarea");
const n = await tas.count();
for (let i = 0; i < n; i++) await tas.nth(i).fill("1,0\n0,1");

// ── Path B: hook-less run via response interception ─────────────────────────
// Rewrite the run response so debuggerHookAvailable=false — faithfully drives
// the same code path a stock PrincetonUniversity build would, end to end.
await page.route("**/api/model/run", async (route) => {
  const resp = await route.fetch();
  const json = await resp.json();
  json.debuggerHookAvailable = false;
  await route.fulfill({ response: resp, body: JSON.stringify(json) });
});
await page.getByRole("button", { name: /Run Model/ }).first().click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
await page.waitForTimeout(500);
const bHook = await page.evaluate(() => window.__modelStore.getState().debuggerHookAvailable);
assert(bHook === false, "B: store debuggerHookAvailable=false after intercepted run");
const bBodyText = await page.evaluate(() => document.body.innerText);
assert(/Basic debugging support/.test(bBodyText), "B: run panel shows the hook-less support note");
assert(await traceHasBasicBadge(), "B: trace bar shows the 'basic' badge");
await page.screenshot({ path: `${OUT}/B-hookless-run.png` });

// ── Path C: full run (no interception) ──────────────────────────────────────
await page.unroute("**/api/model/run");
await page.evaluate(() => window.__modelStore.getState().clearTrace());
await page.waitForTimeout(200);
await page.getByRole("button", { name: /Run Model/ }).first().click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
await page.waitForTimeout(500);
const cHook = await page.evaluate(() => window.__modelStore.getState().debuggerHookAvailable);
console.log(`Path C debuggerHookAvailable: ${cHook}`);
const cBodyText = await page.evaluate(() => document.body.innerText);
if (cHook === true) {
  assert(!/Basic debugging support/.test(cBodyText), "C: no hook-less note on a full-support run");
  assert(!(await traceHasBasicBadge()), "C: no 'basic' badge on a full-support run");
} else {
  console.log("⚠️  Path C skipped strict checks — backend run reported hook unavailable.");
}
await page.screenshot({ path: `${OUT}/C-full-run.png` });

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
