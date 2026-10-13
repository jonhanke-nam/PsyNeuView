// Smoke test for #77: extend palette to cover CompositionFunctionApproximator
// + RegressionCFA, and resolve the PE icon collision between
// ParameterEstimationComposition and PredictionErrorMechanism.
//
// - Uses the palette search box to find the two newly-added types and asserts
//   their palette tiles render.
// - Asserts both PredictionErrorMechanism and ParameterEstimationComposition
//   resolve to distinct entries in the palette (i.e. both are searchable).
// - Screenshots the palette for PR evidence.
//
// The PE icon-string distinction itself ("PE" vs "Pe") is statically verifiable
// in `pnlTypes.ts` — the search-results list renders labels, not the compact
// icon glyph, so we don't try to scrape it from the DOM here.
//
// Assumes:
//   - backend running on http://localhost:8000
//   - vite dev server on http://localhost:5177 serving the #77 worktree

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5177";
const OUT_PATH = "/tmp/pr-77-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

const search = page.getByPlaceholder(/search components/i);
await search.waitFor({ state: "visible", timeout: 5000 });

// CompositionFunctionApproximator should now appear in the palette.
await search.fill("FunctionApproximator");
const cfaTile = page.locator('[title^="CompositionFunctionApproximator"]').first();
await cfaTile.waitFor({ state: "visible", timeout: 5000 });
console.log("OK: CompositionFunctionApproximator palette tile rendered");

await search.fill("RegressionCFA");
const regressTile = page.locator('[title^="RegressionCFA"]').first();
await regressTile.waitFor({ state: "visible", timeout: 5000 });
console.log("OK: RegressionCFA palette tile rendered");

// Both PE-named types are searchable as distinct palette entries.
await search.fill("PredictionError");
await page.locator('[title^="PredictionErrorMechanism"]').first().waitFor({ state: "visible", timeout: 5000 });
console.log("OK: PredictionErrorMechanism searchable");

await search.fill("ParameterEstimation");
await page.locator('[title^="ParameterEstimationComposition"]').first().waitFor({ state: "visible", timeout: 5000 });
console.log("OK: ParameterEstimationComposition searchable");

// Screenshot: leave the palette open with a broad search showing the new types.
await search.fill("Compos");
await page.waitForTimeout(300);
const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

await browser.close();
console.log("DONE: #77 smoke test passed");
