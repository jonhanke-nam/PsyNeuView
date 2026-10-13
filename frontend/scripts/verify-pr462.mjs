// Live verification for #462/#463: the post-run "Per-trial values" cards.
// Drives a real Stroop run on the isolated worktree backend and confirms:
//   - one card per trial renders, default-visible (no expand needed)
//   - each card shows submitted INputs + every node's OUTput, element-labeled
//   - clicking a card moves the trace stepper (store.traceStep) to that trial
//   - the active trial's card is visually highlighted
//
// Assumes worktree backend on :8001 (jonhanke-dev fork w/ _debugger) and
// vite dev build on http://localhost:5198 (exposes window.__modelStore).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR462_URL || "http://localhost:5198";
const OUT = "/tmp/pr-462-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

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

// Open Run panel
await page.getByRole("button", { name: "Run", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(300);

// Drive 3 trials so we can see multiple cards.
const tas = page.locator("textarea");
const n = await tas.count();
for (let i = 0; i < n; i++) await tas.nth(i).fill("1,0\n0,1\n1,0");

await page.getByRole("button", { name: /Run Model/ }).first().click();
await page.waitForFunction(() => {
  const s = window.__modelStore && window.__modelStore.getState();
  return s && s.executionTrace && s.executionTrace.length > 0;
}, { timeout: 40000 });
await page.waitForTimeout(600);

// The cards section is default-visible (not behind a <details>).
const heading = page.getByText("Per-trial values", { exact: true });
assert(await heading.count() > 0, "'Per-trial values' section renders by default");

const bodyText = await page.evaluate(() => document.body.innerText);
// 3 trial cards
assert(/Trial 1/.test(bodyText) && /Trial 2/.test(bodyText) && /Trial 3/.test(bodyText),
  "shows a card for each of the 3 trials");

// Element-labeled inputs + outputs (Stroop ports carry element_names like
// red/green, so labeled braces should appear rather than bare arrays).
assert(/\{[^}]*:[^}]*\}/.test(bodyText), "values render element-labeled (\"{label:val}\")");

// Stroop input node names appear as IN rows.
assert(/color|word|task/i.test(bodyText), "input node names present in cards");

// Capture state before click.
const before = await page.evaluate(() => window.__modelStore.getState().traceStep);
const boundaries = await page.evaluate(() => window.__modelStore.getState().executionTrialBoundaries);
console.log("boundaries:", JSON.stringify(boundaries), "traceStep before:", before);

// Click the 3rd trial card -> traceStep should jump to boundaries[2].
const card = page.getByText(/^Trial 3$/).first();
await card.click();
await page.waitForTimeout(300);
const after = await page.evaluate(() => window.__modelStore.getState().traceStep);
console.log("traceStep after clicking Trial 3:", after);
assert(boundaries.length >= 3 && after === boundaries[2],
  `clicking Trial 3 set traceStep to its trial boundary (${after} === ${boundaries[2]})`);

await page.screenshot({ path: `${OUT}/cards-trial3-active.png`, fullPage: true });

// Click Trial 1 and screenshot the highlight moving.
await page.getByText(/^Trial 1$/).first().click();
await page.waitForTimeout(300);
const after1 = await page.evaluate(() => window.__modelStore.getState().traceStep);
assert(after1 === boundaries[0], `clicking Trial 1 set traceStep to ${boundaries[0]} (got ${after1})`);
await page.screenshot({ path: `${OUT}/cards-trial1-active.png`, fullPage: true });

// Probe: edit a textarea AFTER the run -> the frozen card inputs must NOT change.
await tas.nth(0).fill("9,9\n9,9\n9,9");
await page.waitForTimeout(200);
const afterEdit = await page.evaluate(() => document.body.innerText);
assert(!/9, ?9/.test(afterEdit.split("Per-trial values")[1] || ""),
  "post-run textarea edit does NOT rewrite frozen card inputs (#463)");

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
