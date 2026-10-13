/**
 * E2E smoke for the "Open ▾ → From GitHub repo..." modal (#258).
 *
 * Uses page.route() to mock the backend GitHub endpoints so the test
 * doesn't depend on network reachability or GitHub rate limits — the
 * service layer + endpoint behavior are covered by Python tests.
 *
 * What this verifies end-to-end:
 *   1. Dropdown entry opens the modal.
 *   2. Tree fetch populates the list and a click sets the Selected field.
 *   3. Open posts to /api/model/github/file, then to /api/models/save-as,
 *      and the toolbar shows the resulting local file path.
 *   4. Escape closes the modal.
 */
import { mutatingTest as test, expect } from "./test-base";

test.describe("@smoke github file loader", { tag: "@ci" }, () => {
  test("dropdown → modal → pick path → Open round-trips through save-as", async ({
    page,
  }) => {
    // Mock GitHub tree + file endpoints so the modal renders deterministically.
    await page.route("**/api/model/github/tree*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paths: ["tests/composition/test_emcomposition.py", "psyneulink/__init__.py"],
          truncated: false,
          recent: [],
        }),
      });
    });

    await page.route("**/api/model/github/file*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          repo: "PrincetonUniversity/PsyNeuLink",
          ref: "devel",
          path: "tests/composition/test_emcomposition.py",
          content: "# stub source for the e2e test\nimport psyneulink as pnl\n",
        }),
      });
    });

    // Also mock the install/branches probe the modal fires on mount so it
    // doesn't try to hit GitHub for the default repo's branch list.
    await page.route("**/api/settings/install/branches*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          branches: ["devel", "main"],
          default: "devel",
          recent_refs: [],
        }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();

    // Open the Open ▾ dropdown, then the GitHub entry.
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: /From GitHub repo/ }).click();

    const modal = page.getByTestId("github-file-loader-modal");
    await expect(modal).toBeVisible();

    // The tree should have rendered both paths under "All paths".
    const pickedPath = "tests/composition/test_emcomposition.py";
    const row = modal.getByText(pickedPath, { exact: true });
    await expect(row).toBeVisible();

    // Clicking the row populates the Selected field.
    await row.click();
    const selectedField = modal.getByPlaceholder("path/to/file.py");
    await expect(selectedField).toHaveValue(pickedPath);

    // Open → save-as flow lands the file in My Project Folder and toolbar shows path.
    // Scoped to the modal: the toolbar's "Open ▾" also matches.
    await modal.getByRole("button", { name: "Open" }).click();

    // Toolbar shows the saved file path after introspection completes. The
    // basename should match (or include an _N suffix if a file already exists).
    await expect(
      page.locator('[data-testid="app-toolbar"]').getByText(/test_emcomposition(_\d+)?\.py/),
    ).toBeVisible({ timeout: 15000 });
  });

  test("Escape closes the modal", async ({ page }) => {
    await page.route("**/api/model/github/tree*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ paths: [], truncated: false, recent: [] }),
      });
    });
    await page.route("**/api/settings/install/branches*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ branches: [], default: "devel", recent_refs: [] }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: /From GitHub repo/ }).click();

    const modal = page.getByTestId("github-file-loader-modal");
    await expect(modal).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
  });
});
