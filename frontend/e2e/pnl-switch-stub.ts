/**
 * A backend answered for the Switch to dropdown (#1331, #1334): what is
 * installed, the known sources, the official releases and the rest of what
 * Settings ▸ Developer asks for, so a spec can drive the real panel without
 * a real install (minutes, and it changes the environment).
 *
 * The data is a developer's real Settings as of 0.5.17: a managed clone of
 * PrincetonUniversity/PsyNeuLink in use on devel, five more of its branches,
 * three branches of a fork, one checkout of their own, and nine official
 * releases, the oldest three of which can't install here.
 */
import type { Page } from "@playwright/test";

export const PRINCETON = "PrincetonUniversity/PsyNeuLink";
export const FORK = "jonhanke-nam/PsyNeuLink";
export const CHECKOUT = "/Users/someone/code/PsyNeuLink";
export const MANAGED_CLONE = "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity";

export const PRINCETON_BRANCHES = [
  "devel",
  "jonhanke-dev",
  "refactor/emcomposition/em_mech",
  "refactor/emcomposition/externalmemorymechanisms",
  "refactor/emcomposition/externalmemorymechanisms_SHOW_GRAPH",
  "refactor/emcomposition_SHOW_GRAPH/externalmemorymechanisms",
];
export const FORK_BRANCHES = ["devel", "jonhanke-dev", "refactor/emcomposition/em_mech"];

export const DEVEL_IN_USE = {
  version: "0.19.1.0", source: "github", branch: "devel", repo: PRINCETON, commit: "72dde34", path: MANAGED_CLONE,
};

const entry = (over: Record<string, unknown>) => ({
  id: "", kind: "github", repo: null, ref: null, path: null, label: null,
  selected_at: 0, editable: false, active: false, remembered: true, missing: false, ...over,
});
const github = (repo: string, ref: string, active = false) =>
  entry({ id: `github:${repo.toLowerCase()}@${ref}`, repo, ref, active });

/** The known sources, newest selection first, the way the backend lists them. */
export function knownSources(inUse: { source: string; repo?: string | null; branch?: string | null; path?: string | null }) {
  const active = (kind: string, key: string) =>
    (kind === "github" && inUse.source === "github" && `${inUse.repo} @ ${inUse.branch}` === key) ||
    (kind === "local" && inUse.source === "editable" && inUse.path === key);
  return [
    ...PRINCETON_BRANCHES.map((b) => github(PRINCETON, b, active("github", `${PRINCETON} @ ${b}`))),
    ...FORK_BRANCHES.map((b) => github(FORK, b, active("github", `${FORK} @ ${b}`))),
    entry({ id: `local:${CHECKOUT}`, kind: "local", path: CHECKOUT, label: "My fork checkout", editable: true, active: active("local", CHECKOUT) }),
    entry({ id: "pypi", kind: "pypi", active: inUse.source === "pypi" }),
  ];
}

const release = (version: string, released: string, over: Record<string, unknown> = {}) => ({
  version, released, requires_python: ">=3.10", yanked: false, compatible: true, reason: null,
  limited: false, limited_reason: null, kept: false, ...over,
});
const NO_STEPPING = "No run stepping, value pills or Run State: needs 0.19.1.0 or later";
const OLD_PYTHON = "Needs Python <3.13; this PsyNeuView runs Python 3.13.7";

export const RELEASES = {
  releases: [
    release("0.20.2.0", "2026-08-14", { kept: true }),
    release("0.20.1.0", "2026-07-02"),
    release("0.20.0.0", "2026-05-20"),
    release("0.19.1.0", "2026-03-01", { kept: true }),
    release("0.19.0.0", "2025-12-10", { limited: true, limited_reason: NO_STEPPING }),
    release("0.18.1.0", "2025-11-03", { limited: true, limited_reason: NO_STEPPING }),
    release("0.18.0.0", "2025-09-12", { compatible: false, reason: OLD_PYTHON, requires_python: "<3.13" }),
    release("0.17.1.0", "2025-06-30", { compatible: false, reason: OLD_PYTHON, requires_python: "<3.13" }),
    release("0.17.0.0", "2025-05-15", { compatible: false, reason: OLD_PYTHON, requires_python: "<3.13" }),
  ],
  offline: false, python_version: "3.13.7", in_use: null, releases_dir: "/Users/someone/.psyneuview/releases",
};

/** Answer Settings ▸ Developer's requests, with `installed()` as what is in use. */
export async function stubSwitchBackend(page: Page, installed: () => Record<string, unknown> = () => DEVEL_IN_USE) {
  await stubFolderCheck(page);
  await page.route("**/api/settings/info", async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, psyneulink: installed() } });
  });
  await page.route("**/api/settings/install/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, reason: null, in_mac_app: false, mode: "local" } }),
  );
  await page.route("**/api/settings/pnl-releases", (r) => r.fulfill({ json: RELEASES }));
  await page.route("**/api/settings/pnl-sources", (r) => r.fulfill({ json: { sources: knownSources(installed() as never) } }));
  await page.route("**/api/settings/pnl-freshness", (r) =>
    r.fulfill({ json: { status: "up_to_date", behind_by: 0, installed_commit: "72dde34", head_commit: "72dde34", head_date: "2026-10-07", detail: "" } }),
  );
  await page.route("**/api/settings/install/repos", (r) => r.fulfill({ json: { recent_repos: [FORK, PRINCETON] } }));
  await page.route("**/api/settings/install/branches?**", (r) =>
    r.fulfill({ json: { branches: ["devel", "master"], default: "devel", recent_refs: [] } }),
  );
}

export async function openDeveloper(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-developer").click();
}

export type FolderCheck = { status: "usable" | "downloadable" | "refused"; path: string; exists: boolean; reason: string | null };

/**
 * Answer the check of the folder typed under "Another local checkout…"
 * (#1342). By default every folder is a PsyNeuLink checkout, so a spec about
 * something else can type any path; `answer` decides otherwise.
 */
export async function stubFolderCheck(
  page: Page,
  answer: (path: string) => Partial<FolderCheck> = () => ({}),
) {
  await page.route("**/api/settings/install/check-folder?**", (r) => {
    const path = new URL(r.request().url()).searchParams.get("path") ?? "";
    return r.fulfill({ json: { status: "usable", path, exists: true, reason: null, ...answer(path) } });
  });
}
