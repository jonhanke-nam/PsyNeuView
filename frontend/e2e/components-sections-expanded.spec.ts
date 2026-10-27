import { readOnlyTest as test, expect } from "./test-base";

// #113: the Components panel opens with its sections expanded, so the names
// of the parts show at once, and a section you collapse stays collapsed.
test.describe("Components panel sections", { tag: "@ci" }, () => {
  test("open expanded, and a collapsed section is remembered", async ({ page }) => {
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette).toBeVisible();

    for (const id of ["mechanisms", "projections", "compositions", "functions", "ports"]) {
      await expect(palette.getByTestId(`palette-section-${id}`)).toHaveAttribute("aria-expanded", "true");
    }
    // Without clicking anything: sub-groups show by name (still closed), and
    // single components show as items.
    await expect(palette.getByRole("button", { name: /Processing/ })).toBeVisible();
    await expect(
      palette.getByTitle("GatingMechanism — drag or click to add", { exact: true }),
    ).toBeVisible();
    const pathway = palette.getByRole("button", { name: /Pathway/ });
    await expect(pathway).toBeVisible();

    const projections = palette.getByTestId("palette-section-projections");
    await projections.click();
    await expect(projections).toHaveAttribute("aria-expanded", "false");
    await expect(pathway).toHaveCount(0);

    await page.reload();
    await expect(palette.getByTestId("palette-section-projections")).toHaveAttribute("aria-expanded", "false");
    await expect(palette.getByTestId("palette-section-mechanisms")).toHaveAttribute("aria-expanded", "true");
    await expect(pathway).toHaveCount(0);
  });
});
