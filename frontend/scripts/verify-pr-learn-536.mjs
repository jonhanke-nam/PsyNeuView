// Live verification for #534/#536: the Learn tab trains a model via the async
// job layer (#535) with streaming per-epoch loss.
//
// Path 1 (autodiff): loads the Autodiff Feedforward demo, opens Learn, checks
//   the inputs/targets grids derive from node roles, starts a short training
//   job, watches progress stream in (status line + Plotly chart), and asserts
//   the done state reports a final loss.
// Path 2 (cancel): starts a long job and cancels it mid-flight.
// Path 3 (non-autodiff): loads a regular composition demo and confirms the
//   Learn tab shows the not-learnable empty state.
//
// Assumes worktree vite on http://localhost:5198 → backend :8201.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.PR536_URL || "http://localhost:5198";
const OUT = "/tmp/pr-536-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });

async function loadDemo(labelRe) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByText(labelRe).first().click();
  await page.waitForSelector(".react-flow__node", { timeout: 25000 });
  await page.waitForTimeout(500);
}

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// ---- Path 1: train the autodiff demo --------------------------------------
await loadDemo(/Autodiff Feedforward/);
await page.getByRole("button", { name: "Learn", exact: true }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/01-learn-tab.png` });

assert(await page.getByText("Training inputs").isVisible(), "Learn tab shows Training inputs section");
assert(await page.getByText(/Targets \(desired outputs\)/).isVisible(), "Learn tab shows Targets section");
assert(await page.getByText("input_layer").first().isVisible(), "input_layer derived as input node");
assert(await page.getByText("output_layer").first().isVisible(), "output_layer derived as target node");

// Short run: 8 epochs at lr 0.05.
const epochsBox = page.locator("label", { hasText: "Epochs" }).locator("input");
await epochsBox.fill("8");
const startBtn = page.getByRole("button", { name: "Start Learning" });
assert(await startBtn.isEnabled(), "Start Learning enabled with valid default cells");
await startBtn.click();

// Progress streams in: the status line counts epochs up.
await page.getByText(/Training… epoch/).waitFor({ timeout: 20000 });
assert(true, "running status line appeared");
await page.screenshot({ path: `${OUT}/02-running.png` });

// Done state with a final loss.
await page.getByText(/Training complete — final loss/).waitFor({ timeout: 90000 });
const doneText = await page.getByText(/Training complete — final loss/).innerText();
assert(/final loss 0?\.\d+/.test(doneText), `done line reports a numeric final loss (${doneText.trim()})`);
assert(/after 8 epochs/.test(doneText), "done line reports the epoch count");

// The Plotly loss chart rendered with the full epoch series.
const chart = page.locator(".js-plotly-plot").first();
assert(await chart.isVisible(), "loss chart rendered");
const pointCount = await page.evaluate(() => {
  const gd = document.querySelector(".js-plotly-plot");
  return gd && gd.data && gd.data[0] ? gd.data[0].x.length : 0;
});
assert(pointCount === 8, `loss chart has one point per epoch (got ${pointCount})`);
await page.screenshot({ path: `${OUT}/03-done.png` });

// ---- Path 2: cancel a long job ---------------------------------------------
await epochsBox.fill("3000");
await page.getByRole("button", { name: "Start Learning" }).click();
await page.getByText(/Training… epoch/).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByText("Training canceled.").waitFor({ timeout: 20000 });
assert(true, "cancel mid-training lands in canceled state");
await page.screenshot({ path: `${OUT}/04-canceled.png` });

// Slot freed: a fresh short job runs to completion after the cancel.
await epochsBox.fill("3");
await page.getByRole("button", { name: "Start Learning" }).click();
await page.getByText(/Training complete — final loss/).waitFor({ timeout: 60000 });
assert(true, "new job after cancel completes (slot freed)");

// ---- Path 3: non-autodiff model shows the empty state ----------------------
await loadDemo(/Stroop — Basic|Simple Stroop$/);
await page.getByRole("button", { name: "Learn", exact: true }).first().click();
await page.waitForTimeout(300);
assert(
  await page.getByText(/No learning-capable composition/).isVisible(),
  "non-autodiff model shows the not-learnable empty state",
);
await page.screenshot({ path: `${OUT}/05-not-learnable.png` });

assert(pageErrors.length === 0, `no page errors (${pageErrors.length ? pageErrors.join(" | ") : "clean"})`);

await browser.close();
console.log(fails.length === 0 ? "\nALL CHECKS PASSED" : `\n${fails.length} FAILURES:\n- ${fails.join("\n- ")}`);
process.exit(fails.length === 0 ? 0 : 1);
