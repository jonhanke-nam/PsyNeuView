// Live verification for #466: trial-to-trial diff in the Run panel.
// Loads Stroop, runs the default 5-trial alternating-one-hot inputs (so
// consecutive trials genuinely differ), and confirms each per-trial output
// card carries a "Δ from previous trial" annotation: the first trial shows
// none (no predecessor), later trials show a signed per-element delta, and
// the delta names resolved element labels. Then collapses the run to a
// single trial and confirms no diff scaffolding renders (trivial case).
//
// Assumes worktree vite on http://localhost:5198 → backend :8000.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR466_URL || "http://localhost:5198";
const OUT = "/tmp/pr-466-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Load Stroop and run (default 5 trials, alternating one-hot inputs).
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
await page.waitForTimeout(400);

// 1) Per-trial section renders.
const header = page.getByText(/Per-trial values/).first();
await header.waitFor({ timeout: 5000 });
assert(true, "Per-trial values section renders after a run");

// Map each output trial card to its text, scoped to the "Per-trial values"
// cards column (the header's next sibling). Scoping matters: the input editor
// above also renders "Trial N" labels that would otherwise pollute the query.
const readCards = () =>
  page.evaluate(() => {
    const hdr = Array.from(document.querySelectorAll("div")).find(
      (d) =>
        d.childNodes[0]?.nodeType === 3 &&
        (d.childNodes[0].textContent || "").trim() === "Per-trial values",
    );
    const col = hdr?.nextElementSibling;
    if (!col) return {};
    const out = {};
    for (const card of Array.from(col.children)) {
      const m = (card.textContent || "").match(/Trial (\d+)/);
      if (m) out[Number(m[1])] = card.innerText;
    }
    return out;
  });
const cardTexts = await readCards();
const trialNums = Object.keys(cardTexts).map(Number).sort((a, b) => a - b);
assert(trialNums.length >= 3, `multiple trial cards present (${trialNums.length})`);

// 2) First trial has no Δ (no predecessor to diff against).
const firstText = cardTexts[trialNums[0]] || "";
assert(!/Δ/.test(firstText), `first trial card shows no Δ scaffolding (trial ${trialNums[0]})`);

// 3) At least one later trial shows a Δ annotation.
const laterWithDelta = trialNums.slice(1).filter((n) => /Δ/.test(cardTexts[n] || ""));
assert(laterWithDelta.length > 0, `a later trial card shows a Δ annotation (trials with Δ: ${laterWithDelta.join(",") || "none"})`);

// 4) The Δ line carries a signed per-element delta. Stroop's hidden/output
//    layers have no sidecar element labels (the value rows themselves render
//    as bare `[[..]]`), so the Δ mirrors that with positional `[i]` names —
//    naming is consistent with the value row above it.
const allText = trialNums.map((n) => cardTexts[n]).join("\n");
assert(/Δ\s+\S+\s+[+-]\d/.test(allText), "Δ line carries a signed per-element delta (e.g. 'Δ [0] +0.04')");

// 5) Δ element naming mirrors the value row's: an unlabeled row diffs by
//    index, never inventing a label. (No labeled output layer exists in
//    Stroop Basic to exercise the labeled path here; covered by unit-level
//    formatDelta + the labeled per-trial rows in #463.)
assert(!/Δ[^\n]*undefined/.test(allText), "Δ never renders an 'undefined' element name");

await page.screenshot({ path: `${OUT}/per-trial-deltas.png`, fullPage: true });

// 6) Collapse to a single trial → no diff scaffolding (trivial case).
//    Each input node renders its own per-trial remove ✕, disabled once that
//    node is down to one trial. Click the first *enabled* one until none
//    remain (a single trial left across all nodes), then re-run.
for (let i = 0; i < 12; i++) {
  const enabled = page.locator('button[title="Remove this trial"]:not([disabled])');
  if ((await enabled.count()) === 0) break;
  await enabled.first().click();
  await page.waitForTimeout(120);
}
await page.getByRole("button", { name: /Run Model/ }).click();
// The prior run's executionTrace is still populated, so poll the cards column
// directly until it settles to the single card rather than waiting on store
// trace length.
let oneTrialCards = {};
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(300);
  oneTrialCards = await readCards();
  if (Object.keys(oneTrialCards).length === 1) break;
}
const oneTrialNums = Object.keys(oneTrialCards);
assert(oneTrialNums.length === 1, `collapsed to a single trial card (${oneTrialNums.length})`);
assert(!/Δ/.test(Object.values(oneTrialCards).join("\n")), "single-trial run shows no Δ scaffolding");
await page.screenshot({ path: `${OUT}/single-trial-no-delta.png`, fullPage: true });

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
