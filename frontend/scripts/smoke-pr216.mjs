// Smoke test for #216: surface PsyNeuLink's PyTorch show_graph view inside PsyNeuView.
//
// Verifies:
//   - Loading an AutodiffComposition fixture exposes the "PyTorch View"
//     checkbox in the show_graph tab.
//   - Toggling the checkbox triggers a fresh /api/model/show-graph fetch
//     and renders a different SVG body than the off state.
//   - Loading a non-Autodiff composition (simple Stroop) does NOT show the
//     "PyTorch View" checkbox (gating prevents PNL CompositionError).
//   - A screenshot of the PyTorch view rendered for the autodiff fixture is
//     saved for PR evidence.
//
// Environment preconditions:
//   - backend running on http://localhost:8000 with the #216 introspector
//     changes loaded (canonical PsyNeuView backend, with this branch checked
//     out OR with the worktree-local introspector swapped in). The smoke
//     relies on the backend emitting `isAutodiff` per composition.
//   - vite dev server on http://localhost:5178 serving the #216 worktree.
//   - autodiff_feedforward.py demo present in backend/demos/ (added by this
//     branch). If running against a backend that doesn't have the demo,
//     swap to any AutodiffComposition file accessible via the load picker.
//
// Run:
//   cd frontend && node scripts/smoke-pr216.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FRONTEND = "http://localhost:5178";
const OUT_PATH = "/tmp/pr-216-smoke.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(FRONTEND, { waitUntil: "networkidle" });

// --- Part 1: autodiff fixture → PyTorch checkbox present, toggles SVG ---

await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^autodiff feedforward$/i }).click();
await page.locator(".react-flow__node").first().waitFor({ state: "visible", timeout: 5000 });
console.log("OK: autodiff_feedforward loaded");

// Switch to show_graph tab.
await page.getByRole("button", { name: /^show_graph$/i }).click();

// PyTorch checkbox should appear once the model+tab settle.
const pytorchLabel = page.locator("label", { hasText: /^PyTorch View$/ });
await pytorchLabel.waitFor({ state: "visible", timeout: 5000 });
console.log("OK: 'PyTorch View' checkbox present on autodiff composition");

// The page has *two* SVGs: React Flow's canvas and show_graph's output.
// We only care about the show_graph one — pick the SVG that is NOT inside
// a .react-flow container.
function showGraphSvgPick() {
  const all = Array.from(document.querySelectorAll("svg"));
  const sg = all.find((s) => !s.closest(".react-flow"));
  return sg ? sg.outerHTML.length : 0;
}

async function getShowGraphSvgLen() {
  return await page.evaluate(showGraphSvgPick);
}

// Wait until the show_graph SVG is rendered initially.
await page.waitForFunction(
  () =>
    Array.from(document.querySelectorAll("svg")).some((s) => !s.closest(".react-flow")),
  null,
  { timeout: 8000 }
);
const lenOff = await getShowGraphSvgLen();
console.log("OK: show_graph SVG rendered with show_pytorch=false, length =", lenOff);

// Toggle PyTorch View on (clicking the input directly triggers onChange).
await pytorchLabel.locator("input[type=checkbox]").click();

// Wait for the show_graph SVG to update.
await page.waitForFunction(
  (oldLen) => {
    const all = Array.from(document.querySelectorAll("svg"));
    const sg = all.find((s) => !s.closest(".react-flow"));
    return sg && sg.outerHTML.length !== oldLen;
  },
  lenOff,
  { timeout: 10000 }
);
const lenOn = await getShowGraphSvgLen();
console.log("OK: show_graph SVG re-rendered after show_pytorch=true, length =", lenOn);

if (lenOn === lenOff) {
  console.error("FAIL: SVG body did not change when show_pytorch was toggled");
  await browser.close();
  process.exit(1);
}
console.log("OK: PyTorch view SVG differs from standard view");

// Screenshot the PyTorch view for PR evidence.
const png = await page.screenshot({ fullPage: false });
writeFileSync(OUT_PATH, png);
console.log("Screenshot saved to", OUT_PATH);

// --- Part 2: non-autodiff fixture → PyTorch checkbox absent ---

await page.getByRole("button", { name: /load model/i }).click();
await page.getByRole("button", { name: /^simple stroop$/i }).click();
await page.locator(".react-flow__node").first().waitFor({ state: "visible", timeout: 5000 });
console.log("OK: simple_stroop loaded");

// Already on show_graph tab; the PyTorch checkbox should disappear once the
// non-autodiff composition's introspection lands.
await page
  .waitForFunction(
    () => {
      const labels = Array.from(document.querySelectorAll("label"));
      return !labels.some((l) => /PyTorch View/.test(l.textContent || ""));
    },
    null,
    { timeout: 5000 }
  )
  .catch(() => {
    console.error("FAIL: 'PyTorch View' checkbox still present on non-autodiff composition");
    return browser.close().then(() => process.exit(1));
  });
console.log("OK: 'PyTorch View' checkbox hidden on non-autodiff composition");

await browser.close();
console.log("DONE: #216 smoke test passed");
