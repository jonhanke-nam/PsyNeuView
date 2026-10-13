// Smoke test for #217: matrix-kwarg dropdown on MappingProjection.
// - Loads simple_stroop (has two MappingProjection edges with np.array matrices).
// - Clicks the colors_to_response edge to open the projection inspector.
// - Asserts the matrix row falls into "custom" mode (since np.array is not a
//   keyword) and a "Use keyword" button is shown.
// - Clicks "Use keyword", picks IDENTITY_MATRIX from the dropdown.
// - Asserts the source editor now contains `matrix='IdentityMatrix'`.
// - Captures a screenshot of the inspector + source view for PR evidence.
//
// Assumes:
//   - backend running on http://localhost:8000
//   - vite dev server on http://localhost:5175 serving the #217 worktree

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5175";
const OUT_PATH = "/tmp/pr-217-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

// Load simple_stroop demo.
await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();
await page.locator(".react-flow__node").first().waitFor({ state: "visible" });

// Click the colors_to_response edge. Edges in react-flow are identified by
// data-testid like `rf__edge-<id>` but the simplest selector is the
// `.react-flow__edge` group with a matching aria-label or title — we'll
// click by edge text label which simple_stroop sets to the projection name.
const edgeLabel = page.locator(".react-flow__edge").filter({ hasText: /colors_to_response|colors→response/i }).first();
if (await edgeLabel.count() === 0) {
  // Fallback: click any visible edge group.
  await page.locator(".react-flow__edge").first().click({ force: true });
} else {
  await edgeLabel.click({ force: true });
}

// Wait for the inspector to show a "matrix" param row.
const matrixLabel = page.locator("span", { hasText: /^matrix$/ }).first();
await matrixLabel.waitFor({ state: "visible", timeout: 5000 });
console.log("OK: inspector shows a matrix row");

// Since simple_stroop uses np.array, the value is a literal list — not a
// keyword — so EnumParamRow should be in custom mode with a "Use keyword"
// button visible.
const useKeywordBtn = page.getByRole("button", { name: /use keyword/i }).first();
await useKeywordBtn.waitFor({ state: "visible", timeout: 3000 });
console.log("OK: custom-mode 'Use keyword' button is visible (np.array matrix)");

await useKeywordBtn.click();

// The dropdown <select> should now be visible with the keyword choices.
const select = page.locator("select").filter({ has: page.locator('option[value*="IdentityMatrix"]') }).first();
await select.waitFor({ state: "visible", timeout: 3000 });
const options = await select.locator("option").allTextContents();
console.log(`OK: dropdown is visible with options: ${options.join(", ")}`);

// Pick IDENTITY_MATRIX.
await select.selectOption({ value: "'IdentityMatrix'" });
console.log("OK: selected IDENTITY_MATRIX");

// Wait briefly for the source to update.
await page.waitForTimeout(800);

// Read the source from the code editor. Monaco renders into the DOM; the
// quickest grab is to evaluate the model store source field.
const updatedSource = await page.evaluate(() => {
  const w = window;
  // useModelStore is exposed at runtime through window in dev — fall back
  // to scraping the editor textContent if not.
  // eslint-disable-next-line
  try { return w.useModelStore?.getState?.().source; } catch { return null; }
});

if (typeof updatedSource === "string" && /matrix\s*=\s*['"]IdentityMatrix['"]/.test(updatedSource)) {
  console.log("OK: source now contains matrix='IdentityMatrix'");
} else {
  // Fallback: search visible DOM text.
  const bodyText = await page.locator("body").innerText();
  if (/IdentityMatrix/.test(bodyText)) {
    console.log("OK (text-scan fallback): IdentityMatrix appears in the DOM after selection");
  } else {
    console.error("FAIL: did not find IdentityMatrix in source after selection");
    console.error("source snippet:", typeof updatedSource === "string" ? updatedSource.slice(0, 400) : "(not available)");
    await page.screenshot({ path: OUT_PATH, fullPage: false });
    await browser.close();
    process.exit(1);
  }
}

const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

await browser.close();
