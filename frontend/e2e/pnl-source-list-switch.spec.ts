/**
 * Settings names the current PsyNeuLink correctly and switches between the
 * known sources through one "Switch to" dropdown (#1276, #1331).
 *
 * In the 0.5.14 new-user test, a local checkout cloned from GitHub read as
 * "GitHub: PrincetonUniversity/PsyNeuLink @ devel", and Change install sat on
 * PyPI, so one Apply & restart would have switched away. Then (#1331) the
 * known sources were a list always on show with names cut off, a new
 * checkout's path had to be typed, and Apply & restart was live with an
 * empty path. This drives the real Settings panel against an answered
 * backend: what's installed, the known sources, the releases, the Mac app's
 * file bridge and the install job are all stubbed, since a real install
 * changes the environment and takes minutes. What's checked is what the
 * panel shows and the install request it sends.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { stubFolderCheck } from "./pnl-switch-stub";

type Page = import("@playwright/test").Page;

const A = "/Users/someone/code/PsyNeuLink";
const B = "/Users/someone/checkouts/PsyNeuLink-experiments";
const LONG = "refactor/emcomposition/externalmemorymechanisms_SHOW_GRAPH";
const PRINCETON = "PrincetonUniversity/PsyNeuLink";

const entry = (over: Record<string, unknown>) => ({
  id: "", kind: "github", repo: null, ref: null, path: null, label: null,
  selected_at: 0, editable: false, active: false, remembered: true, missing: false, ...over,
});
const local = (path: string, active: boolean, over: Record<string, unknown> = {}) =>
  entry({ id: `local:${path}`, kind: "local", path, editable: true, active, ...over });
const github = (repo: string, ref: string, over: Record<string, unknown> = {}) =>
  entry({ id: `github:${repo.toLowerCase()}@${ref}`, repo, ref, ...over });

const RELEASES = {
  releases: [
    { version: "0.21.0.0", released: "2026-09-30", requires_python: ">=3.14", yanked: false, compatible: false, reason: "Needs Python >=3.14", limited: false, limited_reason: null, kept: false },
    { version: "0.20.2.0", released: "2026-08-14", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: true },
  ],
  offline: false, python_version: "3.13.7", in_use: null, releases_dir: "/Users/someone/.psyneuview/releases",
};

/** The sources as the user's Settings listed them (#1331), plus a placeholder an older backend may still send. */
function knownSources(installed: string) {
  return [
    local(A, installed === A),
    github("jonhanke-nam/PsyNeuLink", "devel"),
    github(PRINCETON, "devel"),
    github(PRINCETON, LONG),
    github(PRINCETON, "refactor/emcomposition/em_mech", { label: "EM mechanism work" }),
    local(B, installed === B),
    github("owner/repo", "devel"),
    entry({ id: "pypi", kind: "pypi" }),
  ];
}

async function stubBackend(page: Page, state: { installed: string; posted: Array<Record<string, unknown>> }) {
  await stubFolderCheck(page);
  const pnlInfo = () => ({
    version: "0.19.1.0",
    source: "editable",
    branch: "devel",
    repo: PRINCETON,
    commit: state.installed === A ? "72dde34" : "1a2b3c4",
    path: state.installed,
  });
  await page.route("**/api/settings/info", (r) =>
    r.fulfill({
      json: {
        psyneulink: pnlInfo(),
        psyneuview: { version: "0.0.0", commit: "test" },
        modeci_mdf: { version: "0.0.0" },
        github_auth: { source: "none", user: null, scopes: [], has_repo_scope: false },
        features: { debugger_hook: true, level: "full" },
        health: { status: "ok" },
        deployment: { mode: "local", capabilities: { install: true, github_token: true } },
      },
    }),
  );
  await page.route("**/api/settings/pnl-freshness", (r) =>
    r.fulfill({ json: { status: "not_applicable", behind_by: null, installed_commit: null, head_commit: null, head_date: null, detail: "" } }),
  );
  await page.route("**/api/settings/install/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, reason: null, in_mac_app: false, mode: "local" } }),
  );
  await page.route("**/api/settings/pnl-releases", (r) => r.fulfill({ json: RELEASES }));
  await page.route("**/api/settings/install/repos", (r) => r.fulfill({ json: { recent_repos: ["jonhanke-nam/PsyNeuLink"] } }));
  await page.route("**/api/settings/install/branches?**", (r) =>
    r.fulfill({ json: { branches: ["devel", "master"], default: "devel", recent_refs: [] } }),
  );
  await page.route("**/api/settings/pnl-sources", (r) => r.fulfill({ json: { sources: knownSources(state.installed) } }));
  const job = (id: string, path: string, status: string) => ({
    id, source: "local", ref: null, path, repo: null, status, log: [],
    exit_code: status === "succeeded" ? 0 : null, started_at: 0,
    finished_at: status === "succeeded" ? 1 : null,
  });
  await page.route("**/api/settings/install", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    const body = r.request().postDataJSON();
    state.posted.push(body);
    return r.fulfill({ json: job(`job-${state.posted.length}`, body.path, "running") });
  });
  await page.route(/\/api\/settings\/install\/job-\d+$/, (r) => {
    const n = Number(r.request().url().split("job-")[1]);
    state.installed = state.posted[n - 1].path as string;
    return r.fulfill({ json: job(`job-${n}`, state.installed, "succeeded") });
  });
}

/** The Mac app's pnvFile bridge, answering an open-directory panel with `picked`. */
async function stubFileBridge(page: Page, picked: string | null) {
  await page.addInitScript((path) => {
    const w = window as any;
    w.__pnvFileMessages = [];
    w.webkit = {
      messageHandlers: {
        pnvFile: {
          postMessage: async (body: any) => {
            w.__pnvFileMessages.push(body);
            return { path };
          },
        },
      },
    };
  }, picked);
}

async function openDeveloper(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-developer").click();
}

/** Whether every line of `locator`'s text is shown in full: nothing clipped, nothing cut with an ellipsis. */
async function shownInFull(locator: import("@playwright/test").Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.textOverflow !== "ellipsis" && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
  });
}

test("Settings shows the local checkout in use, and switches to another one from the dropdown", { tag: "@ci" }, async ({ page }) => {
  const state = { installed: A, posted: [] as Array<Record<string, unknown>> };
  await stubBackend(page, state);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();

  // What's installed reads as the local checkout: one line in About, and the
  // origin as detail in Developer ▸ PsyNeuLink details (#1295).
  await expect(page.getByText("PsyNeuLink 0.19.1.0, from your checkout at ~/code/PsyNeuLink")).toBeVisible();
  await page.getByTestId("settings-section-developer").click();
  const details = page.getByTestId("settings-group-pnl-details");
  await expect(details.getByText(`Your PsyNeuLink checkout · ${PRINCETON} @ devel (72dde34)`)).toBeVisible();
  await expect(details.getByTitle(A)).toBeVisible(); // the path, in its own box

  // Change install: the status line, nothing chosen, no fields, no button (#1303).
  const group = page.getByTestId("settings-group-pnl-install");
  const dropdown = group.getByTestId("setting-pnl-source");
  await expect(group.getByTestId("install-in-use")).toHaveText(`✓ In use now: Your PsyNeuLink checkout · ${PRINCETON} @ devel (72dde34)`);
  await expect(dropdown).toHaveText(/Choose a source…/);
  await expect(group.getByTestId("install-apply")).toHaveCount(0);
  await expect(group.getByPlaceholder("/path/to/PsyNeuLink")).toHaveCount(0);

  // The dropdown: the two "Another…" rows first, then groups that fold
  // (#1334) — your checkouts open, since the one in use is there and marked;
  // a group per repo and the releases folded; the placeholder left out (#1292).
  await dropdown.click();
  const listbox = page.getByTestId("pnl-switch-listbox");
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option").first()).toHaveAccessibleName("Another local checkout…");
  await expect(page.getByTestId("pnl-switch-group-other").getByRole("option")).toHaveText([/^\+\s*Another local checkout…$/, /^\+\s*Another GitHub repo or branch…$/]);
  await expect(page.getByTestId("pnl-switch-group-checkouts").getByRole("option")).toHaveText([/~\/code\/PsyNeuLink/, /~\/checkouts\/PsyNeuLink-experiments/]);
  await expect(page.getByTestId("pnl-switch-group-checkouts").getByRole("option").first()).toContainText("in use");
  await expect(listbox.getByTestId("pnl-switch-group-heading")).toHaveText([
    /^▼ ?Your checkouts \(2\)$/, /^▶ ?PrincetonUniversity\/PsyNeuLink \(3\)$/, /^▶ ?jonhanke-nam\/PsyNeuLink \(1\)$/, /^▶ ?Official releases on PyPI \(2\) · newest 0\.21\.0\.0$/,
  ]);
  await expect(page.getByTestId("pnl-switch-group-repo:princetonuniversity/psyneulink").getByRole("option")).toHaveCount(0);
  await expect(page.getByTestId("pnl-switch-group-releases").getByRole("option")).toHaveCount(0);
  await expect(listbox.getByRole("option", { name: /owner\/repo/ })).toHaveCount(0);
  await expect(listbox.getByText("owner/repo")).toHaveCount(0);
  // Escape closes the list, not Settings (#1288).
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(page.getByTestId("settings-content-developer")).toBeVisible();

  // A known source: its full name and the summary, no fields; then Apply.
  await dropdown.click();
  await listbox.getByRole("option", { name: /PsyNeuLink-experiments/ }).click();
  await expect(group.getByTestId("install-choice-name")).toHaveText(B);
  await expect(group.getByPlaceholder("/path/to/PsyNeuLink")).toHaveCount(0);
  await expect(group.getByTestId("install-switch-summary")).toContainText("your checkout at ~/checkouts/PsyNeuLink-experiments");
  await expect(group.getByTestId("install-wait-hint")).toHaveText("Expected wait: a few seconds");
  await group.getByTestId("install-apply").click();
  await expect(page.getByText(/Install succeeded/)).toBeVisible({ timeout: 15_000 });
  expect(state.posted[0]).toEqual({ source: "local", path: B });
  await expect(group.getByTestId("install-in-use")).toHaveText(`✓ In use now: Your PsyNeuLink checkout · ${PRINCETON} @ devel (1a2b3c4)`);
  await expect(dropdown).toHaveText(/Choose a source…/);
  await expect(details.getByText(`Your PsyNeuLink checkout · ${PRINCETON} @ devel (1a2b3c4)`)).toBeVisible();
  await page.getByTestId("settings-section-about").click();
  await expect(page.getByText("PsyNeuLink 0.19.1.0, from your checkout at ~/checkouts/PsyNeuLink-experiments")).toBeVisible();
  await page.getByTestId("settings-section-developer").click();

  // And back to A, by keyboard: Down opens the list on the one in use, Up reaches A, Enter picks it.
  await dropdown.focus();
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: /PsyNeuLink-experiments/ })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(group.getByTestId("install-choice-name")).toHaveText(A);
  await group.getByTestId("install-apply").click();
  await expect.poll(() => state.posted.length).toBe(2);
  expect(state.posted[1]).toEqual({ source: "local", path: A });
  await expect(group.getByTestId("install-in-use")).toContainText("(72dde34)", { timeout: 15_000 });
});

test("long names are shown in full, in the dropdown and under Manage known sources", { tag: "@ci" }, async ({ page }) => {
  const state = { installed: A, posted: [] as Array<Record<string, unknown>> };
  await stubBackend(page, state);
  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  await group.getByTestId("setting-pnl-source").click();
  // The repo's group is folded (the one in use is a checkout): open it. Its
  // rows say the branch alone; the full name is the tooltip (#1334).
  const princeton = page.getByTestId("pnl-switch-group-repo:princetonuniversity/psyneulink");
  await princeton.getByTestId("pnl-switch-group-heading").click();
  const longRow = princeton.getByRole("option", { name: LONG, exact: true });
  await expect(longRow).toBeVisible();
  await expect(longRow).toHaveAttribute("title", `${PRINCETON} @ ${LONG}`);
  expect(await shownInFull(longRow), "the long branch name is cut off in the dropdown").toBe(true);
  // A named source shows its name, with the branch it names as the detail.
  const named = princeton.getByRole("option", { name: /EM mechanism work/ });
  await expect(named).toContainText("refactor/emcomposition/em_mech");
  await expect(named).not.toContainText(PRINCETON);
  await expect(named).toHaveAttribute("title", `EM mechanism work — ${PRINCETON} @ refactor/emcomposition/em_mech`);
  // Chosen, the trigger shows it in full, repo and all.
  await longRow.click();
  const dropdown = group.getByTestId("setting-pnl-source");
  await expect(dropdown).toContainText(LONG);
  expect(await shownInFull(dropdown), "the long branch name is cut off on the dropdown").toBe(true);
  await expect(dropdown).toHaveAttribute("title", `${PRINCETON} @ ${LONG}`);
  await expect(group.getByTestId("install-choice-name")).toHaveText(`${PRINCETON} @ ${LONG}`);

  // Manage known sources: folded; open, every row in full, Rename on each,
  // Remove on all but the one in use; the placeholder not listed.
  await expect(group.getByTestId("pnl-source-row")).toHaveCount(0);
  await group.getByTestId("pnl-manage-sources-toggle").click();
  const rows = group.getByTestId("pnl-source-row");
  await expect(rows).toHaveCount(7);
  const longName = group.locator(`[data-testid="pnl-source-row"][data-source-id="github:princetonuniversity/psyneulink@${LONG}"]`).getByTestId("pnl-source-name");
  await expect(longName).toContainText(LONG);
  expect(await shownInFull(longName), "the long branch name is cut off under Manage").toBe(true);
  const current = group.locator(`[data-testid="pnl-source-row"][data-source-id="local:${A}"]`);
  await expect(current.getByText("in use")).toBeVisible();
  await expect(current.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(current.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(rows.getByRole("button", { name: "Rename" })).toHaveCount(7);
  await expect(rows.getByRole("button", { name: "Remove" })).toHaveCount(6);
  await expect(group.getByText("owner/repo")).toHaveCount(0);
});

test("Another local checkout…: Path with Choose… through the Mac app's bridge; an empty path shows no Apply", { tag: "@ci" }, async ({ page }) => {
  const state = { installed: A, posted: [] as Array<Record<string, unknown>> };
  await stubBackend(page, state);
  await stubFileBridge(page, "/Users/someone/picked/PsyNeuLink");
  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  await group.getByTestId("setting-pnl-source").click();
  await page.getByRole("option", { name: "Another local checkout…" }).click();

  // Path and Choose…; nothing typed yet, so a hint and no button.
  const pathField = group.getByTestId("install-path");
  await expect(pathField).toBeVisible();
  await expect(pathField).toHaveValue("");
  await expect(group.getByTestId("install-choice-hint")).toHaveText("Enter the path to a PsyNeuLink checkout, or choose its folder.");
  await expect(group.getByTestId("install-apply")).toHaveCount(0);
  await expect(group.getByTestId("install-switch-summary")).toHaveCount(0);

  // Choose… asks the app for a folder and fills the path.
  await group.getByTestId("install-choose-path").click();
  await expect(pathField).toHaveValue("/Users/someone/picked/PsyNeuLink");
  expect(await page.evaluate(() => (window as any).__pnvFileMessages)).toEqual([
    { op: "open", directories: true, message: "Choose your PsyNeuLink checkout, or an empty folder to download PsyNeuLink into" },
  ]);
  await expect(group.getByTestId("install-choice-hint")).toHaveCount(0);
  await expect(group.getByTestId("install-switch-summary")).toContainText("your checkout at ~/picked/PsyNeuLink");
  await expect(group.getByTestId("install-apply")).toBeVisible();

  // Cleared again: the hint is back and the button is gone. Typing works too.
  await pathField.fill("   ");
  await expect(group.getByTestId("install-apply")).toHaveCount(0);
  await expect(group.getByTestId("install-choice-hint")).toBeVisible();
  await pathField.fill(B);
  await expect(group.getByTestId("install-apply")).toBeVisible();
  await group.getByTestId("install-apply").click();
  await expect.poll(() => state.posted).toEqual([{ source: "local", path: B }]);
});

test("in a browser there is no Choose…, and typing the path is the way", { tag: "@ci" }, async ({ page }) => {
  const state = { installed: A, posted: [] as Array<Record<string, unknown>> };
  await stubBackend(page, state);
  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  await group.getByTestId("setting-pnl-source").click();
  await page.getByRole("option", { name: "Another local checkout…" }).click();
  await expect(group.getByTestId("install-path")).toBeVisible();
  await expect(group.getByTestId("install-choose-path")).toHaveCount(0);
});
