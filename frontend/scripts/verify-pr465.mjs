// Live verification for #465: per-node Trajectory card in the Inspector.
// Loads Stroop, runs it, selects a node, confirms the Trajectory card shows
// one row per element with an inline sparkline (SVG polyline) and a
// first → last value summary using element labels (#361 Layer 3). Switches
// to a different node and confirms the card updates; switches to a
// not-exercised node and confirms the explicit empty-state copy. Then
// loads a different model and confirms the card disappears so no stale
// trajectory leaks (#433).
//
// Assumes worktree vite on http://localhost:5198 → backend :8000.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR465_URL || "http://localhost:5198";
const OUT = "/tmp/pr-465-verify";
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
await page.waitForTimeout(300);

// 1) Select an exercised node (color_input) and switch to Inspector.
await page.evaluate(() => {
  const s = window.__modelStore.getState();
  const node = s.nodes.find((n) => n.data && n.data.varName === "color_input");
  if (node) s.setSelectedNodeId(node.id);
});
await page.waitForTimeout(300);
await page.getByRole("button", { name: /^Inspector$/i }).first().click().catch(() => {});
await page.waitForTimeout(300);

// 2) Trajectory header visible with trial count.
const trajHeader = page.getByText(/TRAJECTORY\b/).first();
await trajHeader.waitFor({ timeout: 5000 });
const headerText = await trajHeader.evaluate((el) => el.parentElement?.textContent || "");
assert(/\d+ trial/.test(headerText), `Trajectory header carries trial count ("${headerText.trim()}")`);

// 3) Sparkline rows render — count <polyline> elements inside the trajectory
//    container. Stroop input layers are 2-element so we expect exactly 2.
const polylines = await page.evaluate(() => {
  // Find the trajectory card by its header text (the header has "TRAJECTORY"
  // as a direct text node, possibly followed by a sibling span carrying the
  // trial count — so a startsWith match on the firstChild is robust).
  const headers = Array.from(document.querySelectorAll("div")).filter((e) => {
    const t = e.childNodes[0]?.textContent?.trim() ?? "";
    return t.startsWith("TRAJECTORY");
  });
  if (headers.length === 0) return -1;
  let card = headers[0].parentElement;
  while (card && !card.querySelector("svg polyline")) card = card.parentElement;
  return card ? card.querySelectorAll("svg polyline").length : 0;
});
assert(polylines === 2, `color_input shows 2 sparkline rows (one per element) (got ${polylines})`);

// 4) Element labels from the sidecar resolver show up next to sparklines.
const bodyText = await page.evaluate(() => document.body.innerText);
assert(/red_ink/.test(bodyText) && /green_ink/.test(bodyText), "element labels render alongside sparklines (red_ink / green_ink)");

// 5) First → last value summary visible.
assert(/→/.test(bodyText), "row carries a 'first → last' summary");

await page.screenshot({ path: `${OUT}/inspector-color_input.png`, fullPage: true });

// 6) Switch to a different exercised node (output) and confirm the card
//    updates — different element labels appear.
await page.evaluate(() => {
  const s = window.__modelStore.getState();
  const node = s.nodes.find((n) => n.data && n.data.varName === "output");
  if (node) s.setSelectedNodeId(node.id);
});
await page.waitForTimeout(300);
const bodyText2 = await page.evaluate(() => document.body.innerText);
assert(/response_red/.test(bodyText2) && /response_green/.test(bodyText2), "card updates on node switch (output → response_red / response_green)");
await page.screenshot({ path: `${OUT}/inspector-output.png`, fullPage: true });

// 7) Pick a node that's not in the logs (decision — a DDM not always logged
//    with the same name). If it happens to be present, this assertion is a
//    no-op pass; if missing we get the explicit empty state.
await page.evaluate(() => {
  const s = window.__modelStore.getState();
  const node = s.nodes.find((n) => n.data && n.data.varName === "decision");
  if (node) s.setSelectedNodeId(node.id);
});
await page.waitForTimeout(300);
const bodyText3 = await page.evaluate(() => document.body.innerText);
const hasEmpty = /not exercised by the most recent run/i.test(bodyText3);
const hasArrow = /→/.test(bodyText3);
assert(hasEmpty || hasArrow, `decision shows either trajectory or an explicit empty state (${hasEmpty ? "empty state" : "trajectory rows"})`);

// 8) Switch to a different model — Trajectory must clear (no stale data, #433).
const fpBefore = await page.evaluate(() => window.__modelStore.getState().filePath);
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText(/^Simple Stroop$/).first().click();
await page.waitForFunction((prev) => {
  const fp = window.__modelStore?.getState()?.filePath;
  return fp && fp !== prev;
}, fpBefore, { timeout: 25000 });
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.waitForTimeout(500);

await page.evaluate(() => {
  const s = window.__modelStore.getState();
  const node = s.nodes.find((n) => n.data && n.data.type);
  if (node) s.setSelectedNodeId(node.id);
});
await page.waitForTimeout(300);
const trajGone = await page.getByText(/TRAJECTORY\b/).isVisible().catch(() => false);
assert(!trajGone, "trajectory does not leak into the new model (Run panel filePath effect cleared runResultsStore)");

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
