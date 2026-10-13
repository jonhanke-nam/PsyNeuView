/**
 * Stroop + LC reference model — LC feedback edges render after the swap.
 *
 * Loads the bundled "Stroop — with Locus Coeruleus (LC)" reference model via
 * the toolbar and asserts the LC's four modulatory edges render:
 *   - LC → color_hidden[gain]   (original)
 *   - LC → word_hidden[gain]    (original)
 *   - LC → decision[gain]       (new feedback)
 *   - LC → response[rate]       (new feedback)
 * These all target parameter ports, so they exercise the #616 fix together
 * with the refreshed reference content.
 *
 * Also asserts the reference loader delivers the full layout bundle — named
 * variants ("1" / "Default") + active selection + the layout index — so the
 * reference carries the same curated GUI state as the source model and the
 * variant picker appears.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REF_LABEL = "Stroop — with Locus Coeruleus (LC)";

test.describe("stroop_with_lc reference model", { tag: "@ci" }, () => {
  test("loads and renders all four LC modulatory edges", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /Open/ }).first().click();
    const loadResp = page.waitForResponse(
      (r) => r.url().includes("/api/reference-models/load") && r.ok(),
    );
    await page.getByText(REF_LABEL).click();

    // The bundled layout + remapped labels travel with the reference model.
    const payload = await (await loadResp).json();
    const positions = payload.layout?.positions ?? {};
    // The contract is that the *bundled* layout travels with the model — not
    // that LC sits at any particular coordinate. Asserting literals coupled
    // this test to a design decision: re-curating the layout (#1012) moved LC
    // and broke a test that was checking delivery, not placement. Compare
    // against the shipped sidecar instead, so the layout stays free to change
    // while delivery stays guarded.
    expect(positions.lc, "bundled default layout missing LC position").toBeTruthy();
    const shipped = JSON.parse(
      readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../backend/reference_models/stroop_reference_with_lc.pnlview.json",
        ),
        "utf8",
      ),
    ).positions;
    expect(positions.lc.x).toBeCloseTo(shipped.lc.x, 1);
    expect(positions.lc.y).toBeCloseTo(shipped.lc.y, 1);
    const labelKeys = Object.keys(payload.labels ?? {});
    expect(labelKeys, "labels remapped to renamed nodes").toEqual(
      expect.arrayContaining(["decision", "response"]),
    );
    expect(labelKeys).not.toContain("output");

    // The full layout bundle travels: both named variants are present (none
    // missing) and "Default" is the active layout (#483 variant picker).
    const layouts = payload.sidecars?.layouts ?? [];
    expect(payload.sidecars?.activeLayout).toBe("Default");
    const byName = Object.fromEntries(layouts.map((l: any) => [l.name, l]));
    expect(Object.keys(byName).sort()).toEqual(["1", "Default"]);
    expect(byName["1"].missing, "variant '1' should be on disk").toBeFalsy();
    expect(byName["Default"].missing, "Default layout should be on disk").toBeFalsy();

    // The graph has rendered once the LC node and its edges are on the canvas.
    await expect(
      page.locator('.react-flow__node[data-id="LC"]'),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".react-flow__edge").first()).toBeVisible({
      timeout: 30000,
    });

    for (const target of [
      "color_hidden[gain]",
      "word_hidden[gain]",
      "decision[gain]",
      "response[rate]",
    ]) {
      await expect(
        page.locator(`.react-flow__edge[data-id*="${target}"]`),
        `expected modulatory edge to ${target}`,
      ).toHaveCount(1);
    }

    // The variant picker reflects the bundled layouts with "Default" active.
    await expect(
      page.getByRole("button", { name: /Layout:\s*Default/ }),
    ).toBeVisible();
  });

  // #627: LC_objective used plain Linear, leaving a 2-element OUTCOME the LC's
  // scalar drive couldn't consume — Run Model crashed with a shape mismatch
  // ("shapes (1,2) and (1,1) not aligned"). The Energy conflict objective
  // reduces it to a scalar so a trial completes.
  test("runs a trial without the scalar-conflict shape error", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText(REF_LABEL).click();
    await expect(
      page.locator('.react-flow__node[data-id="LC"]'),
    ).toBeVisible({ timeout: 30000 });

    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: /Run Model/ })).toBeVisible();
    await page.getByRole("button", { name: /Run Model/ }).click();

    // A trial result row appears, and no shape-mismatch error surfaces.
    await expect(
      page.getByText(/stroop_reference_with_lc\b.*trial/).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/not aligned/i)).toHaveCount(0);
  });
});
