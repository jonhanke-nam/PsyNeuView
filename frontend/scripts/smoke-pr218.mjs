// Smoke screenshot for PR #218 (issue #218):
// loads simple_stroop demo, opens the inspector for the `response` mechanism,
// asserts the new read-only Parameters section is present (header, at least
// one expected parameter-port name, and the explanatory caption), and
// screenshots the inspector panel.
//
// Default ports: backend 8000, frontend 5173. Override with FRONTEND_URL=
// when running on a non-default slot.

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5173";
const EXPECTED_CAPTION =
  "Parameter ports are auto-derived from the Mechanism Parameters above; edit those rows to change values.";
// `response` is a TransferMechanism with Logistic — its parameter ports
// include the Logistic function's `gain` (one of the visible ones).
const EXPECTED_PARAM_PORT = "gain";
const OUT_PATH = "/tmp/pr-218-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();

await page.locator(".react-flow__node").first().waitFor({ state: "visible" });
await page.locator(".react-flow__node", { hasText: "response" }).first().click();

// Inspector Ports section should now show "Parameters" header.
await page.getByText("Parameters", { exact: true }).waitFor({ state: "visible" });

const caption = page.getByText(EXPECTED_CAPTION, { exact: true });
await caption.waitFor({ state: "visible" });

// The parameter-port name should appear in the Parameters section (not just
// as a parameter row above, which is in a different section).
const portsCol = page
  .locator("div")
  .filter({ has: page.getByText("Ports", { exact: true }) })
  .filter({ has: page.getByText("Parameters", { exact: true }) })
  .first();
const paramPortRow = portsCol.getByText(EXPECTED_PARAM_PORT, { exact: true });
await paramPortRow.waitFor({ state: "visible" });

console.log(`OK: Parameters section visible with ${EXPECTED_PARAM_PORT} row + caption`);

// Scroll the inspector itself so the whole Ports column (Inputs → Outputs
// → Parameters → caption) sits inside the viewport, then clip to that
// region using the caption as the bottom anchor and the "Inputs" label
// inside the inspector as the top anchor.
await caption.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);

const inputsInspector = page
  .getByText("Inputs", { exact: true })
  .filter({ visible: true });
const inputsBox = await (await inputsInspector.first().elementHandle()).boundingBox();
const captionEl = await caption.elementHandle();
const captionBox = await captionEl.boundingBox();
let clip = null;
if (inputsBox && captionBox) {
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  const x = Math.max(0, inputsBox.x - 32);
  const y = Math.max(0, inputsBox.y - 40);
  const right = Math.min(vw, captionBox.x + captionBox.width + 32);
  const bottom = Math.min(vh, captionBox.y + captionBox.height + 32);
  clip = { x, y, width: right - x, height: bottom - y };
}

const png = await page.screenshot(clip ? { clip } : { fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

await browser.close();
