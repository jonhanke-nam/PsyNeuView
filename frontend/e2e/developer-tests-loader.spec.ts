/**
 * E2E smoke for the "Open ▾ → Developer / Tests..." modal
 * (#274 / Phase 3 of #249).
 *
 * Mocks /api/dev/tests and /api/dev/extract-test so the test runs without
 * a real PsyNeuLink source tree. The extractor + endpoint surface itself
 * is covered by Python tests.
 *
 * What this verifies end-to-end:
 *   1. Developer-mode toggle reveals the "Developer / Tests..." entry.
 *   2. Selecting a test posts to /api/dev/extract-test, then to
 *      /api/models/save-as, and the toolbar shows the resulting file.
 *   3. A 422 unextractable response greys the offending row inline
 *      (rather than firing a global toast and closing the modal).
 */
import { mutatingTest as test, expect } from "./test-base";

const FAKE_TESTS_ROOT = "/tmp/fake-pnl";
const EM_FILE = `${FAKE_TESTS_ROOT}/tests/composition/test_emcomposition.py`;
const SIMPLE_FILE = `${FAKE_TESTS_ROOT}/tests/composition/test_simple.py`;

function mockDiscover(page: import("@playwright/test").Page) {
  return page.route("**/api/dev/tests", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source_tree: FAKE_TESTS_ROOT,
        tests: [
          {
            file: EM_FILE,
            class_name: "TestExecution",
            method_name: "test_simple_execution_without_learning",
            qualified_name: "TestExecution.test_simple_execution_without_learning",
          },
          {
            file: SIMPLE_FILE,
            class_name: null,
            method_name: "test_needs_tmp_path",
            qualified_name: "test_needs_tmp_path",
          },
        ],
      }),
    });
  });
}

async function enableDeveloperMode(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem("psynewview_ui_prefs_developerMode", "true");
  });
}

test.describe("@smoke developer tests loader", { tag: "@ci" }, () => {
  test("dropdown → modal → pick test → save-as round-trips through extract", async ({
    page,
  }) => {
    await mockDiscover(page);

    await page.route("**/api/dev/extract-test", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      expect(body.file).toBe(EM_FILE);
      expect(body.qualified_name).toBe(
        "TestExecution.test_simple_execution_without_learning",
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          content:
            "# extracted stub for the e2e test\nimport psyneulink as pnl\n",
          suggested_filename:
            "test_emcomposition__TestExecution__test_simple_execution_without_learning.py",
        }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await enableDeveloperMode(page);
    await page.reload();
    await expect(page.getByTestId("app-toolbar")).toBeVisible();

    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: /Developer \/ Tests/ }).click();

    const modal = page.getByTestId("developer-tests-modal");
    await expect(modal).toBeVisible();

    const emRow = modal.getByText("test_simple_execution_without_learning", {
      exact: true,
    });
    await expect(emRow).toBeVisible();

    await emRow.dblclick();

    await expect(
      page
        .locator('[data-testid="app-toolbar"]')
        .getByText(/test_emcomposition__TestExecution__test_simple_execution_without_learning(_\d+)?\.py/),
    ).toBeVisible({ timeout: 15000 });
  });

  test("422 unextractable greys the row inline (no global toast)", async ({
    page,
  }) => {
    await mockDiscover(page);

    await page.route("**/api/dev/extract-test", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            reason: "unextractable",
            message: "uses unsupported fixture: tmp_path",
          },
        }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await enableDeveloperMode(page);
    await page.reload();

    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: /Developer \/ Tests/ }).click();

    const modal = page.getByTestId("developer-tests-modal");
    await expect(modal).toBeVisible();

    const row = modal.getByText("test_needs_tmp_path", { exact: true });
    await row.click();
    // Scoped to the modal: the toolbar's "Open ▾" also matches /Open/.
    await modal.getByRole("button", { name: /Open/ }).click();

    // Inline error banner inside the modal surfaces the reason; modal stays open.
    await expect(modal.getByText(/uses unsupported fixture: tmp_path/)).toBeVisible();
    await expect(modal).toBeVisible();

    // The row is now marked unextractable and won't re-select on click.
    await expect(modal.getByText("(unextractable)")).toBeVisible();
  });

  test("Developer / Tests... entry is hidden when developer mode is off", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    // Ensure dev mode is off (the default, but be explicit).
    await page.evaluate(() => {
      localStorage.removeItem("psynewview_ui_prefs_developerMode");
    });
    await page.reload();

    await page.getByRole("button", { name: /Open/ }).first().click();
    await expect(
      page.getByRole("button", { name: /Developer \/ Tests/ }),
    ).toHaveCount(0);
  });
});
