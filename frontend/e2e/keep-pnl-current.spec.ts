/**
 * Keep PsyNeuLink current and show it (#1304).
 *
 * General ▸ PsyNeuLink version gains a status line (version, behind or up
 * to date, last checked), Check now, and "Keep Latest development up to
 * date automatically", on by default; an update found while that is on
 * installs at the next start, and a note says so until then. An official
 * release is only told about. Developer ▸ Keep your checkouts current lists
 * each checkout with "Check for upstream changes" and "Pull on launch".
 *
 * The backend's answers are stubbed: a real check talks to GitHub and a
 * real pull touches a checkout.
 */
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

const devel = {
  version: "0.20.2+260", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink",
  commit: "7a86e22", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
};
const official = { version: "0.20.2.0", source: "pypi", branch: null, repo: null, commit: null, path: null };

const RELEASES = {
  releases: [
    { version: "0.21.0.0", released: "2026-09-30", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: false },
    { version: "0.20.2.0", released: "2026-08-14", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: true },
  ],
  offline: false, python_version: "3.13.7", in_use: "0.20.2.0", releases_dir: "/Users/someone/.psyneuview/releases",
};

/** A check recorded twenty minutes ago, today. */
const checkedAt = () => Math.floor(Date.now() / 1000) - 20 * 60;

function freshness(behind: number) {
  return {
    status: behind ? "behind" : "current", behind_by: behind, installed_commit: "7a86e22", head_commit: "9ce038f",
    head_date: "2026-10-06T18:02:00Z", detail: behind ? `${behind} commits behind devel.` : "Up to date with devel.",
  };
}

function result(pnl: typeof devel | typeof official, over: Record<string, unknown> = {}) {
  return {
    checked_at: checkedAt(), source: pnl.source, version: pnl.version, repo: pnl.repo, branch: pnl.branch, commit: pnl.commit,
    freshness: null, newest_release: null, release_available: false, offline: false, ...over,
  };
}

const checkout = (over: Record<string, unknown> = {}) => ({
  id: "/Users/someone/code/PsyNeuLink", kind: "psyneulink", name: "PsyNeuLink checkout", path: "/Users/someone/code/PsyNeuLink",
  exists: true, in_use: false, is_checkout: true, branch: "devel", upstream: "origin/devel", commit: "1a2b3c4", dirty_files: 0,
  check: false, pull_on_launch: false, last_check: null, last_pull: null, ...over,
});

async function stub(page: Page, state: { installed: object; updates: Record<string, unknown> }) {
  await page.route("**/api/settings/info", async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, psyneulink: state.installed } });
  });
  await page.route("**/api/settings/install/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, reason: null, in_mac_app: false, mode: "local" } }),
  );
  await page.route("**/api/settings/pnl-releases", (r) => r.fulfill({ json: RELEASES }));
  await page.route("**/api/settings/pnl-sources", (r) => r.fulfill({ json: { sources: [] } }));
  await page.route("**/api/settings/pnl-freshness", (r) =>
    r.fulfill({ json: { status: "not_applicable", behind_by: null, installed_commit: null, head_commit: null, head_date: null, detail: "" } }),
  );
  await page.route("**/api/settings/pnl-updates", (r) => r.fulfill({ json: { installed: state.installed, ...state.updates } }));
}

const base = (installed: object) => ({
  auto_update: true, interval_s: 14400, installed, last_check_at: checkedAt(), last_result: null,
  update_ready: false, ready_commit: null, last_install: null, checks_enabled: true, checkouts: [],
});

async function openGeneral(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-general").click();
}

test("General: behind shows the count and when it was checked; Check now asks the backend; off removes the ready note", async ({ page }) => {
  const state = { installed: devel, updates: { ...base(devel), last_result: result(devel, { freshness: freshness(3) }), update_ready: true, ready_commit: "9ce038f" } };
  await stub(page, state);
  const posted: string[] = [];
  await page.route("**/api/settings/pnl-updates/check", (r) => {
    posted.push("check");
    state.updates = { ...state.updates, last_result: result(devel, { freshness: freshness(5) }), last_check_at: Math.floor(Date.now() / 1000) };
    return r.fulfill({ json: { installed: state.installed, ...state.updates } });
  });
  await page.route("**/api/settings/pnl-updates/auto-update", (r) => {
    const { enabled } = r.request().postDataJSON();
    posted.push(`auto:${enabled}`);
    state.updates = { ...state.updates, auto_update: enabled, update_ready: enabled && state.updates.update_ready };
    return r.fulfill({ json: { installed: state.installed, ...state.updates } });
  });

  await openGeneral(page);
  const status = page.getByTestId("pnl-update-status");
  await expect(status.getByTestId("pnl-update-line")).toHaveText(/^PsyNeuLink 0\.20\.2\+260 \(devel, commit 7a86e22\) · 3 commits behind · last checked \d{1,2}:\d{2}$/);
  await expect(status.getByTestId("setting-pnl-auto-update")).toBeChecked();
  await expect(status.getByTestId("pnl-update-note")).toHaveText("An update is ready; it installs next time PsyNeuView starts.");

  await status.getByTestId("pnl-update-check-now").click();
  await expect(status.getByTestId("pnl-update-line")).toContainText("5 commits behind");
  expect(posted).toEqual(["check"]);

  // Off: nothing installs on its own, so the ready note goes.
  await status.getByTestId("setting-pnl-auto-update").uncheck();
  await expect(status.getByTestId("setting-pnl-auto-update")).not.toBeChecked();
  await expect(status.getByTestId("pnl-update-note")).toHaveCount(0);
  expect(posted).toEqual(["check", "auto:false"]);
  await status.getByTestId("setting-pnl-auto-update").check();
  await expect(status.getByTestId("setting-pnl-auto-update")).toBeChecked();
});

test("General: up to date, and a failed automatic update is shown with the version kept", async ({ page }) => {
  const failed = { at: checkedAt(), outcome: "failed", from_commit: "7a86e22", to_commit: null, detail: "The update failed; the PsyNeuLink in use stays. fatal: unable to access github.com" };
  await stub(page, { installed: devel, updates: { ...base(devel), last_result: result(devel, { freshness: freshness(0) }), last_install: failed } });
  await openGeneral(page);
  const status = page.getByTestId("pnl-update-status");
  await expect(status.getByTestId("pnl-update-line")).toHaveText(/^✓ Up to date · PsyNeuLink 0\.20\.2\+260 \(devel, commit 7a86e22\) · last checked \d{1,2}:\d{2}$/);
  await expect(status.getByTestId("pnl-update-note")).toContainText("The last automatic update failed; the version in use stays.");
  await expect(status.getByTestId("pnl-update-note")).toContainText("unable to access github.com");
});

test("General: an official release is told about a newer release, with no automatic-update switch", async ({ page }) => {
  await stub(page, { installed: official, updates: { ...base(official), last_result: result(official, { newest_release: "0.21.0.0", release_available: true }) } });
  await openGeneral(page);
  const status = page.getByTestId("pnl-update-status");
  await expect(status.getByTestId("pnl-update-line")).toHaveText(/^0\.20\.2\.0 · a newer release, 0\.21\.0\.0, is available · last checked \d{1,2}:\d{2}$/);
  await expect(status.getByTestId("setting-pnl-auto-update")).toHaveCount(0);
  await expect(status.getByTestId("pnl-update-check-now")).toBeVisible();
  await expect(status).toContainText("never installed on its own");
});

test("Developer: each checkout has its two switches, off by default, naming the remote branch; a refused pull is said", async ({ page }) => {
  const clean = checkout({
    last_check: { checked_at: checkedAt(), fetched: true, status: "behind", behind_by: 2, ahead_by: 0, dirty_files: 0, upstream: "origin/devel", detail: "2 commits behind origin/devel." },
  });
  const dirty = checkout({
    id: "/Users/someone/code/PsyNeuView", kind: "psyneuview", name: "PsyNeuView", path: "/Users/someone/code/PsyNeuView", pull_on_launch: true,
    last_check: { checked_at: checkedAt(), fetched: true, status: "behind", behind_by: 1, ahead_by: 0, dirty_files: 3, upstream: "origin/devel", detail: "1 commit behind origin/devel. 3 files changed locally; not pulled." },
    last_pull: { at: checkedAt(), outcome: "refused", from_commit: "abc1234", to_commit: null, detail: "3 files changed locally; not pulled." },
  });
  const state = { installed: devel, updates: { ...base(devel), checkouts: [dirty, clean] } };
  await stub(page, state);
  const posted: Array<Record<string, unknown>> = [];
  await page.route("**/api/settings/checkout-updates/prefs", (r) => {
    const body = r.request().postDataJSON();
    posted.push(body);
    state.updates = {
      ...state.updates,
      checkouts: (state.updates.checkouts as Array<Record<string, unknown>>).map((c) =>
        c.path === body.path ? { ...c, ...(body.check !== undefined ? { check: body.check } : {}), ...(body.pull_on_launch !== undefined ? { pull_on_launch: body.pull_on_launch } : {}) } : c,
      ),
    };
    return r.fulfill({ json: { checkouts: state.updates.checkouts } });
  });
  await page.route("**/api/settings/checkout-updates/check", (r) => {
    posted.push(r.request().postDataJSON());
    return r.fulfill({ json: { result: {}, checkouts: state.updates.checkouts } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-developer").click();
  const group = page.getByTestId("settings-group-checkout-updates");
  await expect(group.getByTestId("settings-group-checkout-updates-summary")).toHaveText("1 of 2 kept current");
  await group.getByRole("button", { name: "Keep your checkouts current" }).click();

  const rows = group.getByTestId("checkout-update-row");
  await expect(rows).toHaveCount(2);
  const pv = rows.nth(0);
  const pnl = rows.nth(1);
  await expect(pv).toContainText("PsyNeuView");
  await expect(pv.getByTestId("checkout-update-line")).toHaveText(/^1 commit behind origin\/devel · 3 files changed locally; not pulled · last checked \d{1,2}:\d{2}$/);
  await expect(pv.getByTestId("checkout-update-pull-note")).toHaveText(/^Not pulled at \d{1,2}:\d{2}: 3 files changed locally; not pulled\.$/);
  await expect(pv.getByTestId("setting-checkout-pull-on-launch")).toBeChecked();
  await expect(pv.getByTestId("setting-checkout-check-upstream")).not.toBeChecked();
  await expect(pv).toContainText("(origin/devel)");

  await expect(pnl.getByTestId("checkout-update-line")).toHaveText(/^2 commits behind origin\/devel · last checked \d{1,2}:\d{2}$/);
  await expect(pnl.getByTestId("setting-checkout-check-upstream")).not.toBeChecked();
  await expect(pnl.getByTestId("setting-checkout-pull-on-launch")).not.toBeChecked();
  await expect(pnl.getByTestId("checkout-update-pull-note")).toHaveCount(0);

  // The switches post the checkout's path, and Check now asks for that checkout.
  await pnl.getByTestId("setting-checkout-check-upstream").check();
  await expect(pnl.getByTestId("setting-checkout-check-upstream")).toBeChecked();
  await pnl.getByTestId("checkout-update-check-now").click();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted).toEqual([
    { path: "/Users/someone/code/PsyNeuLink", check: true },
    { path: "/Users/someone/code/PsyNeuLink" },
  ]);
});
