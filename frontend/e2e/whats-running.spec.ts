/**
 * Settings ▸ About says what PsyNeuView is running and from where (#1356).
 *
 * In the e2e harness the backend runs from this repository's own checkout,
 * so About names it as one, with its branch and commit, and the page (built
 * from the same commit before the run) agrees with the server: no warning.
 * The two other states — the Mac app's included copy, and a page older than
 * the server — are staged by answering `/api/settings/running` for the page.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function openAbout(page: Page) {
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-about").click();
  await expect(page.getByTestId("settings-content-about")).toBeVisible();
}

test.describe("Settings ▸ About: what's running", () => {
  test("names the version, the checkout it runs from, its branch and commit, and the page's build", async ({ page, request }) => {
    const running = await (await request.get("/api/settings/running")).json();
    expect(running.kind).toBe("checkout");

    await page.goto("/");
    await openAbout(page);
    const about = page.getByTestId("settings-content-about");
    await expect(about.getByText(running.version, { exact: true })).toBeVisible();
    await expect(page.getByTestId("about-running-where")).toHaveAttribute("data-kind", "checkout");
    await expect(page.getByTestId("about-running-where")).toContainText("A browser session served from your checkout at");
    const branchLine = page.locator('[data-testid="about-running-line"][data-line-id="branch"]');
    if (running.git.branch) {
      await expect(branchLine).toContainText(`on branch ${running.git.branch} at ${running.git.commit}`);
    } else {
      await expect(branchLine).toContainText("Not on a branch");
    }
    await expect(page.getByTestId("about-running-check-now")).toBeVisible();
    await expect(page.getByTestId("about-page-build")).toContainText(/[0-9a-f]{7,}|no git commit/);
    // Built from the commit the server runs: nothing to warn about.
    await expect(page.getByTestId("about-mismatch")).toHaveCount(0);
  });

  test("the Mac app's included copy, and a page older than the server", async ({ page }) => {
    let answer: Record<string, unknown> = {
      version: "0.5.15", kind: "included", deployment: "mac_app", app_flavor: "release",
      path: "/Users/someone/Library/Application Support/PsyNeuView/psyneuview-0.5.15",
      git: null, git_error: null, started_commit: null, dist: null, dist_relation: null,
      page: { commit: "0000000", relation: "unknown" }, summary: "",
    };
    await page.route("**/api/settings/running**", (route) => route.fulfill({ json: answer }));
    await page.goto("/");
    await openAbout(page);
    await expect(page.getByTestId("about-running-where")).toHaveText("The version included with the Mac app");
    await expect(page.getByTestId("about-running-check-now")).toHaveCount(0);

    const pageCommit = await page.evaluate(() => (window as any).__pnvDiagnostics().then((s: any) => s.state.app.running.page.commit));
    test.skip(!pageCommit, "this build has no git commit to compare");
    answer = {
      ...answer, kind: "checkout", deployment: "local", path: "/srv/pnv",
      git: { branch: "devel", commit: "fffffff", commit_date: null, dirty_files: 0, upstream: "origin/devel", ahead_by: 0,
        behind_by: 0, main_branch: "origin/devel", behind_main: 0, on_main_branch: true, last_fetched: null },
      started_commit: "fffffff", dist: { commit: "fffffff" }, dist_relation: "same",
      page: { commit: pageCommit, relation: "page_older" },
    };
    await page.keyboard.press("Escape");
    await openAbout(page);
    await expect(page.getByTestId("about-mismatch")).toHaveAttribute("data-mismatch", "page-older");
    await expect(page.getByTestId("about-mismatch")).toContainText("This page is older than the server; reload.");
    await expect(page.getByTestId("about-mismatch-reload")).toBeVisible();
  });
});
