/**
 * Reference-model lineage in the Inspector (#835).
 *
 * When a vendored reference model is loaded, the Inspector's Model Overview
 * shows a "Lineage" section linking the exact upstream PsyNeuLink source file at
 * the pinned commit on GitHub — so you can see what code is actually being run.
 */
import { mutatingTest as test, expect } from "./test-base";

const BOTVINICK = "Conflict Monitoring — Stroop (Botvinick et al. 2001)";

test.describe("reference model lineage", { tag: "@ci" }, () => {
  test("Inspector links the exact vendored upstream source @ commit", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText(BOTVINICK, { exact: true }).first().click();
    await expect(
      page.locator(".react-flow__node").first(),
    ).toBeVisible({ timeout: 60000 });

    // Model Overview (Inspector tab, default) renders the lineage link.
    const link = page.getByRole("link", {
      name: /Botvinick_conflict_monitoring_model\.py/,
    });
    await expect(link).toBeVisible({ timeout: 15000 });

    const href = await link.getAttribute("href");
    expect(href).toContain(
      "github.com/PrincetonUniversity/PsyNeuLink/blob/",
    );
    expect(href).toContain(
      "psyneulink/library/models/Botvinick_conflict_monitoring_model.py",
    );
  });
});
