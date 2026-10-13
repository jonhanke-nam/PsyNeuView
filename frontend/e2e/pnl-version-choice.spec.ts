/**
 * General ▸ PsyNeuLink version: the simple view of which PsyNeuLink is
 * installed (#1295 round 4).
 *
 * Two choices for everyone — Latest development (recommended, the default)
 * and Official release — editing the same setting as Developer ▸ Which
 * PsyNeuLink is installed, through the same install request. What is
 * installed and the install job are answered here, as in the other switch
 * specs: a real install takes minutes and changes the environment. When the
 * installed PsyNeuLink is anything else, General says so and points at
 * Developer instead of showing radios.
 */
import { readOnlyTest as test, expect } from "./test-base";

const JOB = "job-1295-r4";

const latest = {
  version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink",
  commit: "72dde34", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
};
const official = { version: "0.20.2.0", source: "pypi", branch: null, repo: null, commit: null, path: null };
const checkout = {
  version: "0.19.1.0", source: "editable", branch: "jonhanke-dev", repo: "jonhanke-nam/PsyNeuLink",
  commit: "1a2b3c4", path: "/Users/someone/code/PsyNeuLink",
};

type Page = import("@playwright/test").Page;

const RELEASES = {
  releases: [
    { version: "0.21.0.0", released: "2026-09-30", requires_python: ">=3.14", yanked: false, compatible: false, reason: "Needs Python >=3.14; this PsyNeuView runs Python 3.13.7", limited: false, limited_reason: null, kept: false },
    { version: "0.20.2.0", released: "2026-08-14", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: false },
    { version: "0.19.1.0", released: "2026-03-01", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: true },
    { version: "0.18.0.0", released: "2025-09-12", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: true, limited_reason: "No run stepping, value pills or Run State: needs 0.19.1.0 or later", kept: false },
  ],
  offline: false, python_version: "3.13.7", in_use: null, releases_dir: "/Users/someone/.psyneuview/releases",
};

async function stubInstalled(page: Page, pnl: () => object) {
  await page.route("**/api/settings/pnl-releases", (r) => r.fulfill({ json: RELEASES }));
  await page.route("**/api/settings/info", async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, psyneulink: pnl() } });
  });
  await page.route("**/api/settings/install/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, reason: null, in_mac_app: false, mode: "local" } }),
  );
  await page.route("**/api/settings/pnl-freshness", (r) =>
    r.fulfill({ json: { status: "not_applicable", behind_by: null, installed_commit: null, head_commit: null, head_date: null, detail: "" } }),
  );
}

async function openGeneral(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-general").click();
}

test("Latest development is selected and in use by default; choosing Official explains and posts the same install", { tag: "@ci" }, async ({ page }) => {
  let installed: object = latest;
  const posted: Array<Record<string, unknown>> = [];
  await stubInstalled(page, () => installed);
  const job = (status: string) => ({
    id: JOB, source: "pypi", ref: null, path: null, repo: null, status, log: ["pip install psyneulink"],
    exit_code: status === "succeeded" ? 0 : null, started_at: 0, finished_at: status === "succeeded" ? 1 : null,
  });
  await page.route("**/api/settings/install", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posted.push(r.request().postDataJSON());
    return r.fulfill({ json: job("running") });
  });
  await page.route(`**/api/settings/install/${JOB}`, (r) => {
    installed = official;
    return r.fulfill({ json: job("succeeded") });
  });

  await openGeneral(page);
  const group = page.getByTestId("settings-group-pnl-version");
  await expect(group.getByTestId("pnl-version-latest")).toBeChecked();
  await expect(group.getByText("(recommended)")).toBeVisible();
  await expect(group.getByTestId("pnl-version-in-use")).toBeVisible();
  await expect(group.getByText("Latest development", { exact: true })).toBeVisible();
  // Nothing to apply: no button, a quiet line saying what is in use (#1303).
  await expect(group.getByTestId("install-switch-summary")).toHaveCount(0);
  await expect(group.getByTestId("pnl-version-apply")).toHaveCount(0);
  await expect(group.getByTestId("pnl-version-in-use-now")).toHaveText("✓ In use now: GitHub · PrincetonUniversity/PsyNeuLink @ devel (72dde34)");

  // Every official release, newest first with its date; one that can't
  // install on this Python is greyed out with the reason; the newest that
  // can is preselected; a kept one says so.
  const release = group.getByTestId("pnl-version-release");
  await expect(release.locator("option")).toHaveText([
    "0.21.0.0 · released 2026-09-30 — Needs Python >=3.14; this PsyNeuView runs Python 3.13.7",
    "0.20.2.0 · released 2026-08-14",
    "0.19.1.0 · released 2026-03-01 · kept",
    "0.18.0.0 · released 2025-09-12 (no run stepping)",
  ]);
  await expect(release.locator('option[value="0.21.0.0"]')).toHaveJSProperty("disabled", true);
  await expect(release.locator('option[value="0.20.2.0"]')).toHaveJSProperty("disabled", false);
  await expect(release).toHaveValue("0.20.2.0");

  // Choosing the other one says what changes — naming the version — then
  // posts the same request Developer's form would, version included.
  await group.getByTestId("pnl-version-official").check();
  await expect(group.getByTestId("install-switch-summary")).toHaveText(
    "Library, Examples and Tests will list the models in PyPI 0.20.2.0 (the official release). " +
      "My Project Folder and your catalogs stay the same.",
  );
  await expect(group.getByTestId("pnl-version-limited")).toHaveCount(0);
  await expect(group.getByTestId("pnl-version-in-use-now")).toHaveCount(0);
  await expect(group.getByTestId("pnl-version-apply-explanation")).toHaveText("Nothing changes until you press Apply & restart.");

  // An old release warns before Apply, and is still allowed.
  await release.selectOption("0.18.0.0");
  await expect(group.getByTestId("pnl-version-limited")).toContainText("No run stepping, value pills or Run State: needs 0.19.1.0 or later");
  await expect(group.getByTestId("install-switch-summary")).toContainText("PyPI 0.18.0.0");
  await release.selectOption("0.20.2.0");
  await expect(group.getByTestId("pnl-version-limited")).toHaveCount(0);

  await group.getByTestId("pnl-version-apply").click();
  await expect(group.getByText(/Install succeeded/)).toBeVisible({ timeout: 15_000 });
  expect(posted).toEqual([{ source: "pypi", version: "0.20.2.0" }]);
  // The installed one follows, and the choice with it.
  await expect(group.getByTestId("pnl-version-official")).toBeChecked();
  await expect(group.getByTestId("pnl-version-apply")).toHaveCount(0);
  await expect(group.getByTestId("pnl-version-in-use-now")).toHaveText("✓ In use now: PyPI · 0.20.2.0");
  await expect(page.getByTestId("settings-content-about")).toHaveCount(0);
  await page.getByTestId("settings-section-about").click();
  await expect(page.getByText("PsyNeuLink 0.20.2.0, from PyPI 0.20.2.0")).toBeVisible();
});

test("a custom source shows the Custom line and a link to Developer, not radios", { tag: "@ci" }, async ({ page }) => {
  await stubInstalled(page, () => checkout);
  await page.route("**/api/settings/pnl-sources", (r) => r.fulfill({ json: { sources: [] } }));
  await openGeneral(page);
  const group = page.getByTestId("settings-group-pnl-version");
  // The source on its own line, the path in its box, and the link.
  await expect(group.getByTestId("pnl-version-custom")).toContainText("Custom — chosen in Developer");
  await expect(group.getByTestId("pnl-version-custom-source")).toHaveText(
    "Your PsyNeuLink checkout · jonhanke-nam/PsyNeuLink @ jonhanke-dev (1a2b3c4)",
  );
  await expect(group.getByTestId("pnl-version-custom").getByText("Full path")).toBeVisible();
  await expect(group.getByTestId("pnl-version-custom")).not.toContainText("everyday choices");
  await expect(group.getByTestId("setting-pnl-version")).toHaveCount(0);
  await group.getByRole("button", { name: "Change in Developer" }).click();
  await expect(page.getByTestId("settings-content-developer")).toBeVisible();
  await expect(page.getByTestId("setting-pnl-source")).toBeVisible();
  await expect(page.getByTestId("install-in-use")).toContainText("Your PsyNeuLink checkout");
});
