// Live verification for #533: the Run State Consideration queue is foldable.
// Loads Stroop, runs it (so the queue + per-phase status populate), opens
// Run State, confirms the queue renders as a <details> with a phase count
// in its <summary>, toggles it closed and back open, and confirms the
// summary updates with "phase N firing now" while stepping the trace.
//
// Assumes worktree vite on http://localhost:5198 → backend :8000.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR533_URL || "http://localhost:5198";
const OUT = "/tmp/pr-533-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Load Stroop and run.
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

// Open the Run State tab.
await page.getByRole("button", { name: /Run State/ }).first().click().catch(() => {});
await page.waitForTimeout(300);

// 1) The queue renders as a <details> with a "Consideration queue (N phases)" summary.
const queueDetails = page.locator("details", { has: page.getByText(/Consideration queue \(\d+ phase/) }).first();
await queueDetails.waitFor({ timeout: 5000 });
const initiallyOpen = await queueDetails.evaluate((el) => (el).open);
assert(initiallyOpen === true, `queue defaults to open (open=${initiallyOpen})`);

const sumText0 = await queueDetails.locator("summary").innerText();
assert(/Consideration queue \(\d+ phase/i.test(sumText0), `summary shows phase count ("${sumText0}")`);
await page.screenshot({ path: `${OUT}/queue-open.png`, fullPage: true });

// Phase rows visible while open.
const phaseRowsBefore = await queueDetails.locator("text=/^#\\d+$/").count();
assert(phaseRowsBefore > 0, `phase rows visible when open (${phaseRowsBefore})`);

// 2) Click the summary to collapse → details.open === false, phase rows gone.
await queueDetails.locator("summary").click();
await page.waitForTimeout(150);
const collapsedOpen = await queueDetails.evaluate((el) => (el).open);
assert(collapsedOpen === false, `queue collapses on click (open=${collapsedOpen})`);
// <details> keeps children in the DOM but hides them — check visibility, not count.
const firstRowVisibleCollapsed = await queueDetails.locator("text=/^#\\d+$/").first().isVisible();
assert(firstRowVisibleCollapsed === false, `phase rows visually hidden when collapsed (firstVisible=${firstRowVisibleCollapsed})`);

// Summary still informative when collapsed (same phase count text).
const sumTextCollapsed = await queueDetails.locator("summary").innerText();
assert(/Consideration queue \(\d+ phase/i.test(sumTextCollapsed), `collapsed summary still conveys phase count ("${sumTextCollapsed}")`);
await page.screenshot({ path: `${OUT}/queue-collapsed.png`, fullPage: true });

// 3) Click summary again → reopens, rows return.
await queueDetails.locator("summary").click();
await page.waitForTimeout(150);
const reopenedOpen = await queueDetails.evaluate((el) => (el).open);
assert(reopenedOpen === true, `queue reopens on second click (open=${reopenedOpen})`);
const phaseRowsReopened = await queueDetails.locator("text=/^#\\d+$/").count();
assert(phaseRowsReopened === phaseRowsBefore, `reopened phase rows match initial count (${phaseRowsReopened} = ${phaseRowsBefore})`);

// 4) Step the trace → the summary picks up "phase X firing now" while stepping.
await page.evaluate(() => window.__modelStore.getState().setTraceStep(0));
await page.waitForTimeout(200);
const sumStep0 = await queueDetails.locator("summary").innerText();
assert(/phase \d+ firing now/i.test(sumStep0), `summary shows active phase at step 0 ("${sumStep0}")`);

await page.evaluate(() => window.__modelStore.getState().setTraceStep(2));
await page.waitForTimeout(200);
const sumStep2 = await queueDetails.locator("summary").innerText();
const m0 = sumStep0.match(/phase (\d+) firing now/i);
const m2 = sumStep2.match(/phase (\d+) firing now/i);
assert(!!m2, `summary shows active phase at step 2 ("${sumStep2}")`);
assert(m0 && m2 && m0[1] !== m2[1], `active-phase label changes across trace steps (step 0: phase ${m0?.[1]}, step 2: phase ${m2?.[1]})`);

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
