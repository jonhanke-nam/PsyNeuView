import { readOnlyTest as test, expect } from "./test-base";

// Manual measurement harness (#864) — quantifies where model-load latency goes
// end-to-end: click -> backend introspect -> response -> frontend build/layout ->
// React Flow paint. Captures the unified [perf] load line (utils/loadPerf.ts,
// which folds in the backend `timings` block) plus the true click->first-node-
// painted wall time.
//
// Skipped by default (it only logs — no assertions) so it never slows CI.
// Run: PERF_MEASURE=1 npx playwright test e2e/_measure-load-latency.spec.ts

const RUN = !!process.env.PERF_MEASURE;

const MODELS = [
  { label: "TD Learning / dopamine (Montague, Dayan & Sejnowski 1996)", tag: "MDS96 (small)" },
  { label: "EGO — Giallanza et al. 2024 (Study 2)", tag: "EGO (heavy)" },
];

for (const { label, tag } of MODELS) {
  test(`measure load latency: ${tag}`, async ({ page }) => {
    test.skip(!RUN, "perf measurement harness — set PERF_MEASURE=1 to run");
    const perf: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes("[perf]")) perf.push(t);
    });

    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });

    // t0 = user clicks the model in the Open menu
    await page.getByRole("button", { name: /Open/ }).first().click();
    const t0 = Date.now();
    await page.getByText(label, { exact: true }).first().click();

    // render-complete signal: first React Flow node painted to the DOM
    await expect(
      page.locator(".react-flow__node").first(),
      `graph never rendered for ${tag}`,
    ).toBeVisible({ timeout: 90000 });
    const clickToPaint = Date.now() - t0;

    // brief settle so any trailing [perf] log flushes
    await page.waitForTimeout(300);

    console.log(`\n========== ${tag} : "${label}" ==========`);
    console.log(`  CLICK -> FIRST NODE PAINTED (end-to-end perceived): ${clickToPaint} ms`);
    console.log(`  frontend/backend [perf] breakdown:`);
    for (const line of perf) console.log(`    ${line.replace(/^.*\[perf\]/, "[perf]")}`);
    console.log(`==================================================\n`);
  });
}
