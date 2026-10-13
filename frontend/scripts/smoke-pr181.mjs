// Smoke test for #181: auto-name on click-to-add from palette.
// - Loads simple_stroop demo via the toolbar.
// - Clicks a TransferMechanism palette item once, asserts no prompt fired
//   and a new node with name `New_TransferMechanism_1` appears.
// - Clicks again, asserts the second add produces `New_TransferMechanism_2`
//   (no collision, increment works).
// - Captures a screenshot of the resulting canvas + palette.
//
// Assumes:
//   - backend running on http://localhost:8000
//   - vite dev server on http://localhost:5175

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5175";
const OUT_PATH = "/tmp/pr-181-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

let promptDialogFired = false;
page.on("dialog", async (dialog) => {
  promptDialogFired = true;
  console.error(`[FAIL] dialog fired: ${dialog.type()} — ${dialog.message()}`);
  await dialog.dismiss();
});
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

// Load simple_stroop demo via the toolbar.
await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();
await page.locator(".react-flow__node").first().waitFor({ state: "visible" });

// Snapshot baseline node count + names.
const baselineNodes = await page.locator(".react-flow__node").count();
console.log(`baseline node count: ${baselineNodes}`);

// TransferMechanism lives under collapsed `mechanisms > processing > Transfer`.
// Use the palette search input to filter it into view — matches user behavior
// for finding a component by name.
const search = page.getByPlaceholder(/search components/i);
await search.waitFor({ state: "visible", timeout: 5000 });
await search.fill("TransferMechanism");

const transferMechItem = page.locator('[title^="TransferMechanism"]').first();
await transferMechItem.waitFor({ state: "visible", timeout: 5000 });

// First click → expect New_TransferMechanism_1.
await transferMechItem.click();

// Wait for the canvas to grow by one node.
await page.waitForFunction(
  (expected) => document.querySelectorAll(".react-flow__node").length === expected,
  baselineNodes + 1,
  { timeout: 5000 },
);

let nodeTexts = await page.locator(".react-flow__node").allTextContents();
if (!nodeTexts.some((t) => t.includes("New_TransferMechanism_1"))) {
  console.error("FAIL: New_TransferMechanism_1 not found in nodes:", nodeTexts);
  await browser.close();
  process.exit(1);
}
console.log("OK: first add produced New_TransferMechanism_1");

// Second click → expect New_TransferMechanism_2.
await transferMechItem.click();
await page.waitForFunction(
  (expected) => document.querySelectorAll(".react-flow__node").length === expected,
  baselineNodes + 2,
  { timeout: 5000 },
);

nodeTexts = await page.locator(".react-flow__node").allTextContents();
if (!nodeTexts.some((t) => t.includes("New_TransferMechanism_2"))) {
  console.error("FAIL: New_TransferMechanism_2 not found in nodes:", nodeTexts);
  await browser.close();
  process.exit(1);
}
console.log("OK: second add produced New_TransferMechanism_2");

if (promptDialogFired) {
  console.error("FAIL: a prompt/dialog fired during creation — expected silent auto-name");
  await browser.close();
  process.exit(1);
}
console.log("OK: no prompt dialog fired");

// Screenshot the canvas region for PR evidence.
const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

await browser.close();
