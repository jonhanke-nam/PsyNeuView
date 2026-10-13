/**
 * Reference Model Walkthroughs — capture + verify (#886).
 *
 * Model-centric walkthroughs (a distinct category from the task tutorials). One
 * parametrized spec over every bundled reference model: it loads each, captures
 * the screenshots embedded in docs/reference-models/<key>.md (Open menu, graph,
 * run), and re-verifies load + render. Living under e2e/tutorials/ puts it in
 * the gated + capturing machinery so the docs can't drift.
 *
 * Running is best-effort: a couple of models can't yet run *by name* through the
 * Run panel (MDS96 — function-scoped compositions, #859; EGO — .learn() blocked
 * upstream, PsyNeuLink#30). For those we still capture whatever the Run panel
 * shows and only forbid a frontend crash — same tolerance as
 * reference-models-runnable.spec.ts.
 *
 * Read-only w.r.t. backend reset.
 */
import { readOnlyTest as test, expect } from "../../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync, existsSync } from "fs";

const ASSETS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/reference-models/assets",
);

// key ↔ the doc filename / asset dir; label ↔ the Open-menu entry.
const MODELS = [
  { key: "botvinick", label: "Conflict Monitoring — Stroop (Botvinick et al. 2001)" },
  { key: "cohen-huston-1994", label: "Stroop — Bidirectional (Cohen & Huston 1994)" },
  { key: "cohen-huston-horse-race", label: "Stroop — Horse Race (Cohen & Huston 1994)" },
  { key: "kalanthroff-pctc", label: "Stroop — PCTC (Kalanthroff, Davelaar & Usher 2018)" },
  { key: "gilzenrat", label: "Locus Coeruleus — gain model (Gilzenrat et al.)" },
  { key: "nieuwenhuis-2005", label: "Locus Coeruleus / P300 (Nieuwenhuis et al. 2005)" },
  { key: "montague-dayan-sejnowski", label: "TD Learning / dopamine (Montague, Dayan & Sejnowski 1996)" },
  { key: "stroop-basic", label: "Stroop — Basic" },
  { key: "stroop-with-lc", label: "Stroop — with Locus Coeruleus (LC)" },
  { key: "ego", label: "EGO — Giallanza et al. 2024 (Study 2)" },
];

// Models whose run-by-name is genuinely blocked (documented as ⚠️ in their
// walkthrough Guarantees). For these the run step is best-effort. EVERY other
// model MUST produce per-trial results — so a "runs but errors" regression (like
// EGO's #859-class name mismatch, which read as a graceful in-panel error and
// slipped past a no-crash-only check) fails CI instead of hiding (#886).
const RUN_BLOCKED = new Set<string>(["montague-dayan-sejnowski"]);

const DOCS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/reference-models",
);

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Reference model walkthroughs", () => {
  // The monitor (#886): coverage can't silently regress in either direction.
  test("coverage: every reference model has a walkthrough (doc + capture)", async ({ request }) => {
    const resp = await request.get("/api/reference-models");
    expect(resp.ok()).toBeTruthy();
    const backendLabels = ((await resp.json()).models as { label: string }[]).map((m) => m.label);
    const specLabels = MODELS.map((m) => m.label);

    // A new reference model added without a walkthrough → fail (forces parity).
    const uncovered = backendLabels.filter((l) => !specLabels.includes(l));
    expect(
      uncovered,
      `reference model(s) with no walkthrough — add a docs/reference-models/<key>.md ` +
        `and a MODELS entry: ${uncovered.join(", ")}`,
    ).toEqual([]);

    // A walkthrough whose model is gone → flag for a deliberate conversation.
    const dropped = specLabels.filter((l) => !backendLabels.includes(l));
    expect(
      dropped,
      `walkthrough(s) for model(s) no longer in the catalog — retire or restore ` +
        `(a conversation, not a silent drop): ${dropped.join(", ")}`,
    ).toEqual([]);

    // Every walkthrough's doc file exists.
    const missingDocs = MODELS.filter((m) => !existsSync(path.join(DOCS_ROOT, `${m.key}.md`)));
    expect(
      missingDocs.map((m) => m.key),
      `MODELS entries missing their docs/reference-models/<key>.md`,
    ).toEqual([]);
  });

  for (const { key, label } of MODELS) {
    test(`${key}: loads, renders, runs — captures walkthrough screenshots`, async ({ page }) => {
      test.setTimeout(120_000);
      const dir = path.join(ASSETS_ROOT, key);
      mkdirSync(dir, { recursive: true });
      const shot = (name: string) => path.join(dir, name);

      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.stack || String(e)));

      await page.goto("/");
      await page.getByRole("button", { name: /Open/ }).first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot("open.png") });
      await page.getByText(label, { exact: true }).first().click();

      // Structure on the canvas — every model must load + render.
      await expect(
        page.locator(".react-flow__node").first(),
        `graph never rendered for ${label}`,
      ).toBeVisible({ timeout: 60000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: shot("graph.png") });

      // Run. A non-blocked model MUST produce per-trial results — the walkthrough's
      // "Run ✅" guarantee, self-enforced. Blocked ones are best-effort (capture
      // whatever shows; only forbid a crash).
      await page.getByRole("button", { name: "Run", exact: true }).click();
      const panel = page.getByTestId("run-panel");
      await expect(panel.getByRole("button", { name: /Run Model/ })).toBeVisible();
      await panel.getByRole("button", { name: /Run Model/ }).click();
      if (RUN_BLOCKED.has(key)) {
        await page
          .waitForResponse((r) => r.url().includes("/api/model/run"), { timeout: 60000 })
          .catch(() => null);
        await page.waitForTimeout(800);
      } else {
        await expect(
          panel.getByText(/Results \(\d+ trials?\)/),
          `Run ✅ model produced no results (a "runs but errors" regression?): ${label}`,
        ).toBeVisible({ timeout: 60000 });
      }
      await page.screenshot({ path: shot("run.png") });

      expect(pageErrors, `frontend crash for ${label}:\n${pageErrors.join("\n")}`).toEqual([]);
      expect(
        await page.getByTestId("error-boundary-fallback").count(),
        `ErrorBoundary tripped for ${label}`,
      ).toBe(0);
    });
  }
});
