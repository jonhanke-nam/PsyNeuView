import { readOnlyTest as test, expect } from "./test-base";

// #113: the Components panel opens as the full panel (search box and the word
// list of sections, all folded closed), not the narrow icon strip. Switching to
// the strip is remembered across a reload.
test.describe("Components panel opening state", { tag: "@ci" }, () => {
  test("opens as the word list; the strip is remembered", async ({ page }) => {
    await page.goto("/");
    const palette = page.getByTestId("palette-sidebar");
    await expect(palette).toBeVisible();
    await expect(palette.getByPlaceholder("Search components...")).toBeVisible();
    for (const name of ["Mechanisms", "Projections", "Compositions", "Functions", "Ports"]) {
      await expect(palette.getByRole("button", { name: new RegExp(`^\\u25B6\\s*${name}$`) })).toBeVisible();
    }
    // Folded closed: no sub-group shows until a section is opened.
    await expect(palette.getByRole("button", { name: /Processing/ })).toHaveCount(0);

    await palette.getByTitle("Compact mode").click();
    await expect(palette.getByPlaceholder("Search components...")).toHaveCount(0);

    await page.reload();
    await expect(palette).toBeVisible();
    await expect(palette.getByTitle("Expand palette")).toBeVisible();
    await expect(palette.getByPlaceholder("Search components...")).toHaveCount(0);
  });
});
