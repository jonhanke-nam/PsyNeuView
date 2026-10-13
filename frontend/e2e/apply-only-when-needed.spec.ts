/**
 * Apply & restart appears only when there is something to apply (#1303).
 *
 * Developer ▸ Which PsyNeuLink is installed starts with nothing chosen and a
 * quiet "In use now" line, so a new user never meets a blue button that does
 * nothing. The Switch to dropdown (#1331) shows the button only for a valid
 * choice that differs from what is installed: a blank branch or path, or a
 * malformed repo, shows a hint of what is missing instead; the installed
 * thing chosen again says "nothing to apply". After a successful apply the
 * new install is what is in use, so nothing is chosen and the line says the
 * new state. The official releases are rows of the dropdown, with dates.
 *
 * The other two buttons are covered where they live: General ▸ PsyNeuLink
 * version in pnl-version-choice.spec.ts, the Mac app's Which PsyNeuView runs
 * in mac-app-settings-section.spec.ts.
 *
 * What is installed, the releases, the branches and the install job are
 * answered here: a real install takes minutes and changes the environment.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { stubFolderCheck } from "./pnl-switch-stub";

type Page = import("@playwright/test").Page;

const JOB = "job-1303";

const devel = {
  version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink",
  commit: "72dde34", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
};
const checkout = {
  version: "0.19.1.0", source: "editable", branch: "jonhanke-dev", repo: "jonhanke-nam/PsyNeuLink",
  commit: "1a2b3c4", path: "/Users/someone/code/PsyNeuLink",
};
const pypi = (version: string) => ({ version, source: "pypi", branch: null, repo: null, commit: null, path: null });

const RELEASES = {
  releases: [
    { version: "0.21.0.0", released: "2026-09-30", requires_python: ">=3.14", yanked: false, compatible: false, reason: "Needs Python >=3.14", limited: false, limited_reason: null, kept: false },
    { version: "0.20.2.0", released: "2026-08-14", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: false },
    { version: "0.19.1.0", released: "2026-03-01", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: true },
  ],
  offline: false, python_version: "3.13.7", in_use: null, releases_dir: "/Users/someone/.psyneuview/releases",
};

async function stubBackend(page: Page, installed: () => object) {
  await stubFolderCheck(page);
  await page.route("**/api/settings/info", async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, psyneulink: installed() } });
  });
  await page.route("**/api/settings/install/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, reason: null, in_mac_app: false, mode: "local" } }),
  );
  await page.route("**/api/settings/pnl-releases", (r) => r.fulfill({ json: RELEASES }));
  await page.route("**/api/settings/pnl-sources", (r) => r.fulfill({ json: { sources: [] } }));
  await page.route("**/api/settings/pnl-freshness", (r) =>
    r.fulfill({ json: { status: "not_applicable", behind_by: null, installed_commit: null, head_commit: null, head_date: null, detail: "" } }),
  );
  await page.route("**/api/settings/install/repos", (r) => r.fulfill({ json: { recent_repos: [] } }));
  await page.route("**/api/settings/install/branches?**", (r) =>
    r.fulfill({ json: { branches: ["devel", "master"], default: "devel", recent_refs: [] } }),
  );
}

async function openDeveloper(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-developer").click();
}

test("Developer: no button until a valid choice differs from what's installed; gone again after applying", async ({ page }) => {
  let installed: object = devel;
  const posted: Array<Record<string, unknown>> = [];
  await stubBackend(page, () => installed);
  const job = (status: string) => ({
    id: JOB, source: "local", ref: null, path: checkout.path, repo: null, status, log: ["pip install -e ."],
    exit_code: status === "succeeded" ? 0 : null, started_at: 0, finished_at: status === "succeeded" ? 1 : null,
  });
  await page.route("**/api/settings/install", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posted.push(r.request().postDataJSON());
    return r.fulfill({ json: job("running") });
  });
  await page.route(`**/api/settings/install/${JOB}`, (r) => {
    installed = checkout;
    return r.fulfill({ json: job("succeeded") });
  });

  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  const apply = group.getByTestId("install-apply");
  const inUse = group.getByTestId("install-in-use");
  const dropdown = group.getByTestId("setting-pnl-source");

  // Nothing chosen: the status line, no button, no summary, no fields.
  await expect(dropdown).toHaveText(/Choose a source…/);
  await expect(inUse).toHaveText("✓ In use now: GitHub · PrincetonUniversity/PsyNeuLink @ devel (72dde34)");
  await expect(apply).toHaveCount(0);
  await expect(group.getByTestId("install-switch-summary")).toHaveCount(0);
  await expect(group.getByTestId("install-wait-hint")).toHaveCount(0);
  await expect(group.getByPlaceholder("devel")).toHaveCount(0);

  // "Another GitHub repo or branch…" with a blank branch is not yet a valid
  // choice: a hint says what is missing, still no button (#1331).
  await dropdown.click();
  await page.getByRole("option", { name: "Another GitHub repo or branch…" }).click();
  const ref = group.getByPlaceholder("devel");
  await expect(ref).toBeVisible();
  await expect(group.getByTestId("install-choice-hint")).toHaveText("Enter a branch or tag.");
  await expect(apply).toHaveCount(0);

  // Another branch is something to apply: the summary, the explanation, the button.
  await ref.fill("master");
  await expect(group.getByTestId("install-switch-summary")).toHaveText(
    "Library, Examples and Tests will list the models in PrincetonUniversity/PsyNeuLink @ master. " +
      "My Project Folder and your catalogs stay the same.",
  );
  await expect(group.getByTestId("install-apply-explanation")).toHaveText("Nothing changes until you press Apply & restart.");
  await expect(apply).toBeVisible();
  await expect(apply).toBeEnabled();
  await expect(group.getByTestId("install-choice-hint")).toHaveCount(0);

  // The installed branch written out, with slashes and odd case, is still nothing to apply.
  await ref.fill("/devel/");
  await expect(apply).toHaveCount(0);
  await expect(group.getByTestId("install-choice-same")).toContainText("nothing to apply");
  await expect(inUse).toBeVisible();

  // A malformed repo: a hint, no button.
  await group.getByPlaceholder("PrincetonUniversity/PsyNeuLink").fill("not a repo");
  await expect(group.getByTestId("install-choice-hint")).toContainText("owner/name");
  await expect(apply).toHaveCount(0);
  await group.getByPlaceholder("PrincetonUniversity/PsyNeuLink").fill("");

  // A checkout: the button, then after the install the new install is what
  // is in use, so nothing is chosen, the button goes and the line says the new state.
  await dropdown.click();
  await page.getByRole("option", { name: "Another local checkout…" }).click();
  await expect(group.getByTestId("install-choice-hint")).toContainText("Enter the path");
  await expect(apply).toHaveCount(0);
  await group.getByPlaceholder("/path/to/PsyNeuLink").fill("~/code/PsyNeuLink/");
  await expect(group.getByTestId("install-switch-summary")).toContainText("your checkout at ~/code/PsyNeuLink");
  await apply.click();
  await expect(group.getByText(/Install succeeded/)).toBeVisible({ timeout: 15_000 });
  expect(posted).toEqual([{ source: "local", path: "~/code/PsyNeuLink/" }]);
  await expect(apply).toHaveCount(0);
  await expect(dropdown).toHaveText(/Choose a source…/);
  await expect(inUse).toHaveText("✓ In use now: Your PsyNeuLink checkout · jonhanke-nam/PsyNeuLink @ jonhanke-dev (1a2b3c4)");
});

test("Developer: picking the installed release is nothing to apply; another release is", async ({ page }) => {
  let installed: object = pypi("0.19.1.0");
  await stubBackend(page, () => installed);

  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  const dropdown = group.getByTestId("setting-pnl-source");
  await expect(group.getByTestId("install-in-use")).toHaveText("✓ In use now: PyPI · 0.19.1.0");
  await expect(group.getByTestId("install-apply")).toHaveCount(0);

  // The releases, with dates, the installed one marked; the incompatible one can't be picked.
  await dropdown.click();
  const releases = page.getByTestId("pnl-switch-group-releases");
  await expect(releases.getByRole("option")).toHaveCount(3);
  await expect(releases.getByRole("option", { name: /0\.19\.1\.0/ })).toContainText("in use");
  await expect(releases.getByRole("option", { name: /0\.21\.0\.0/ })).toBeDisabled();
  await expect(releases.getByRole("option", { name: /0\.21\.0\.0/ })).toHaveAttribute("title", "PyPI 0.21.0.0 — Needs Python >=3.14");
  await expect(releases.getByRole("option", { name: /0\.20\.2\.0/ })).toContainText("released 2026-08-14");
  await expect(releases.getByRole("option", { name: /0\.19\.1\.0/ })).toContainText("released 2026-03-01 · kept");

  // The installed release: nothing to apply. 0.20.2.0: the summary and the button.
  await releases.getByRole("option", { name: /0\.19\.1\.0/ }).click();
  await expect(group.getByTestId("install-choice-same")).toContainText("nothing to apply");
  await expect(group.getByTestId("install-apply")).toHaveCount(0);
  await dropdown.click();
  await releases.getByRole("option", { name: /0\.20\.2\.0/ }).click();
  await expect(group.getByTestId("install-switch-summary")).toHaveText(
    "Library, Examples and Tests will list the models in PyPI 0.20.2.0 (the official release). " +
      "My Project Folder and your catalogs stay the same.",
  );
  await expect(group.getByTestId("install-apply")).toBeVisible();

  // With the newest installed, that same row is nothing to apply.
  installed = pypi("0.20.2.0");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await openDeveloper(page);
  await expect(group.getByTestId("install-in-use")).toHaveText("✓ In use now: PyPI · 0.20.2.0");
  await dropdown.click();
  await releases.getByRole("option", { name: /0\.20\.2\.0/ }).click();
  await expect(group.getByTestId("install-choice-same")).toBeVisible();
  await expect(group.getByTestId("install-apply")).toHaveCount(0);
});
