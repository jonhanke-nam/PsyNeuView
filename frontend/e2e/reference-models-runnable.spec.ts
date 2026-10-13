/**
 * Reference-model runnability gate (#818, #577, #652).
 *
 * For EVERY bundled reference model: load it, confirm the graph renders, run a
 * trial, and assert the app never crashes — no uncaught JS error and no white
 * screen (React tree still mounted). A *graceful* backend error (e.g. EGO's
 * learn path blocked by PsyNeuLink#30) is allowed; a frontend crash is not.
 *
 * This is the gate that would have caught #818: the Cohen & Huston 1994 model
 * white-screened the whole app because `RunPanel` assumed a 2-D output shape
 * and `row.map` threw on its non-2-D output.
 *
 * The `coverage` test fails if this list drifts from the backend's
 * `/api/reference-models`, so a newly bundled model can't silently skip the gate.
 */
import { mutatingTest as test, expect } from "./test-base";

// Mirrors backend REFERENCE_MODELS (backend/app/api/routes.py), by label.
const MODELS = [
  "EGO — Giallanza et al. 2024 (Study 2)",
  "Stroop — Basic",
  "Stroop — with Locus Coeruleus (LC)",
  "Stroop — Bidirectional (Cohen & Huston 1994)",
  "Stroop — Horse Race (Cohen & Huston 1994)",
  "Stroop — PCTC (Kalanthroff, Davelaar & Usher 2018)",
  "Locus Coeruleus — gain model (Gilzenrat et al.)",
  "Locus Coeruleus / P300 (Nieuwenhuis et al. 2005)",
  "TD Learning / dopamine (Montague, Dayan & Sejnowski 1996)",
  "Conflict Monitoring — Stroop (Botvinick et al. 2001)",
];

// Read the root directly, without a catch. The catch used to turn *any*
// failure into 0, so a page too busy to answer before the test timed out was
// reported as a white screen, which sent the diagnosis the wrong way.
async function rootChildCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.getElementById("root")?.childElementCount ?? 0);
}

test.describe("reference models: load + run without crashing", { tag: "@ci" }, () => {
  test("coverage: spec lists every bundled reference model", async ({ request }) => {
    const resp = await request.get("/api/reference-models");
    expect(resp.ok()).toBeTruthy();
    const labels = ((await resp.json()).models as { label: string }[]).map((m) => m.label);
    expect(new Set(labels)).toEqual(new Set(MODELS));
  });

  for (const label of MODELS) {
    test(`loads + runs without white-screen: ${label}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.stack || String(e)));

      await page.goto("/");
      await page.getByRole("button", { name: /Open/ }).first().click();
      await page.getByText(label, { exact: true }).first().click();

      // The model loaded and the graph drew.
      await expect(
        page.locator(".react-flow__node").first(),
        `graph never rendered for ${label}`,
      ).toBeVisible({ timeout: 60000 });
      expect(pageErrors, `render crash after loading ${label}:\n${pageErrors.join("\n")}`).toEqual([]);
      expect(await rootChildCount(page), `white screen after loading ${label}`).toBeGreaterThan(0);
      // A crash swallowed by the ErrorBoundary shows the fallback (no white
      // screen, maybe no pageerror) — still a failure for the gate.
      expect(await page.getByTestId("error-boundary-fallback").count(), `ErrorBoundary tripped loading ${label}`).toBe(0);

      // Run a trial. Allow a graceful backend error; forbid a frontend crash.
      await page.getByRole("button", { name: "Run", exact: true }).click();
      const runDone = page
        .waitForResponse((r) => r.url().includes("/api/model/run"), { timeout: 120000 })
        .catch(() => null);
      await page.getByRole("button", { name: /Run Model/ }).click();
      await runDone;
      await page.waitForTimeout(2500); // let results / error render

      expect(pageErrors, `crash while running ${label}:\n${pageErrors.join("\n")}`).toEqual([]);
      expect(await rootChildCount(page), `white screen after running ${label}`).toBeGreaterThan(0);
      expect(await page.getByTestId("error-boundary-fallback").count(), `ErrorBoundary tripped running ${label}`).toBe(0);
    });
  }
});
