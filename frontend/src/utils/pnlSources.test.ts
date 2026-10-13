import { describe, expect, it } from "vitest";

import {
  expectedWait,
  formatCurrentInstall,
  formFromSourceEntry,
  formMatchesEntry,
  initialInstallForm,
  type PnlSourceEntry,
  type PsyNeuLinkInfo,
} from "./pnlSources";

const localClone: PsyNeuLinkInfo = {
  version: "0.19.1.0",
  source: "editable",
  branch: "devel",
  repo: "PrincetonUniversity/PsyNeuLink",
  commit: "72dde34",
  path: "/Users/me/PsyNeuLink-clone-test-1",
};

const entry = (over: Partial<PnlSourceEntry>): PnlSourceEntry => ({
  id: "x", kind: "local", repo: null, ref: null, path: null, label: null, selected_at: 0,
  editable: false, active: false, remembered: true, missing: false, ...over,
});

describe("what Settings says is installed (#1276)", () => {
  it("names a local checkout by its folder, with where it was cloned from as detail", () => {
    expect(formatCurrentInstall(localClone)).toBe(
      "Local checkout: /Users/me/PsyNeuLink-clone-test-1 (PrincetonUniversity/PsyNeuLink @ devel, 72dde34)",
    );
  });

  it("names a local checkout that isn't a git clone by its folder alone", () => {
    expect(formatCurrentInstall({ ...localClone, repo: null, branch: null, commit: null })).toBe(
      "Local checkout: /Users/me/PsyNeuLink-clone-test-1",
    );
  });

  it("still names a managed GitHub install by repo and branch", () => {
    expect(formatCurrentInstall({ ...localClone, source: "github" })).toBe(
      "GitHub: PrincetonUniversity/PsyNeuLink @ devel (72dde34)",
    );
  });
});

describe("where the Change install form starts", () => {
  it("starts on the local checkout that is installed, with its path", () => {
    expect(initialInstallForm(localClone)).toEqual({
      source: "local", repo: "", ref: "", path: "/Users/me/PsyNeuLink-clone-test-1",
    });
  });

  it("starts on GitHub with a fork's repo, leaving the branch blank (#457)", () => {
    expect(
      initialInstallForm({ ...localClone, source: "github", repo: "jonhanke-nam/PsyNeuLink" }),
    ).toEqual({ source: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "", path: "" });
  });

  it("starts on PyPI only when PyPI is installed", () => {
    expect(initialInstallForm({ ...localClone, source: "pypi" }).source).toBe("pypi");
  });
});

describe("picking a remembered source", () => {
  it("fills the form, and the form then matches that entry and no other", () => {
    const a = entry({ id: "local:/a", kind: "local", path: "/a" });
    const b = entry({ id: "local:/b", kind: "local", path: "/b" });
    const form = formFromSourceEntry(b);
    expect(form).toEqual({ source: "local", repo: "", ref: "", path: "/b" });
    expect(formMatchesEntry(form, b)).toBe(true);
    expect(formMatchesEntry(form, a)).toBe(false);
  });

  it("leaves Repo blank for the default repo so it reads as the default", () => {
    const devel = entry({ kind: "github", repo: "PrincetonUniversity/PsyNeuLink", ref: "devel" });
    const form = formFromSourceEntry(devel);
    expect(form).toEqual({ source: "github", repo: "", ref: "devel", path: "" });
    expect(formMatchesEntry(form, devel)).toBe(true);
  });
});

describe("the expected wait shown before switching", () => {
  it("is a few seconds for a local checkout", () => {
    expect(expectedWait({ source: "local", repo: "", ref: "", path: "/b" }, localClone)).toBe(
      "a few seconds",
    );
  });

  it("is about a minute for PyPI or a different GitHub repo", () => {
    expect(expectedWait({ source: "pypi", repo: "", ref: "", path: "" }, localClone)).toBe(
      "about a minute",
    );
    expect(expectedWait({ source: "github", repo: "", ref: "devel", path: "" }, localClone)).toBe(
      "about a minute",
    );
  });

  it("is a few seconds for another branch of the GitHub repo already installed", () => {
    const github = { ...localClone, source: "github" as const };
    expect(expectedWait({ source: "github", repo: "", ref: "other", path: "" }, github)).toBe(
      "a few seconds",
    );
  });
});

import { describeInstallForm, pnlSourceLabel, sourceSwitchNote, switchSummary, type InstallForm } from "./pnlSources";

describe("where the Open menu's PsyNeuLink sections come from (#1295)", () => {
  const github: PsyNeuLinkInfo = {
    version: "0.19.1.0", source: "github", branch: "devel",
    repo: "PrincetonUniversity/PsyNeuLink", commit: "72dde34", path: "/Users/me/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
  };
  const pypi: PsyNeuLinkInfo = { version: "0.19.1.0", source: "pypi", branch: null, repo: null, commit: null, path: null };

  it("labels a GitHub install by repo and branch, PyPI by version, a checkout by its folder", () => {
    expect(pnlSourceLabel(github)).toBe("from PrincetonUniversity/PsyNeuLink @ devel");
    expect(pnlSourceLabel(pypi)).toBe("from PyPI 0.19.1.0");
    expect(pnlSourceLabel(localClone)).toBe("from your checkout at ~/PsyNeuLink-clone-test-1");
  });

  it("says nothing when nothing is known", () => {
    expect(pnlSourceLabel({ ...pypi, source: "unknown" })).toBeNull();
    expect(pnlSourceLabel(null)).toBeNull();
  });

  it("writes the one-time note after a switch in the same words", () => {
    expect(sourceSwitchNote({ ...github, repo: "jonhanke-nam/PsyNeuLink", branch: "jonhanke-dev" })).toBe(
      "Library, Examples and Tests now list jonhanke-nam/PsyNeuLink @ jonhanke-dev.",
    );
  });

  it("summarises what a switch will change, and that the project folder and catalogs won't", () => {
    expect(switchSummary({ source: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev", path: "" }, github)).toBe(
      "Library, Examples and Tests will list the models in jonhanke-nam/PsyNeuLink @ jonhanke-dev. " +
        "My Project Folder and your catalogs stay the same.",
    );
    expect(describeInstallForm({ source: "github", repo: "", ref: "", path: "" })).toBe("PrincetonUniversity/PsyNeuLink @ devel");
    expect(describeInstallForm({ source: "pypi", repo: "", ref: "", path: "" })).toBe("PyPI (the official release)");
    expect(describeInstallForm({ source: "local", repo: "", ref: "", path: "/Users/me/PsyNeuLink" })).toBe("your checkout at ~/PsyNeuLink");
  });

  it("says nothing for a switch to what is installed now", () => {
    expect(switchSummary({ source: "github", repo: "", ref: "", path: "" }, github)).toBeNull();
    expect(switchSummary({ source: "github", repo: "princetonuniversity/psyneulink", ref: "devel/", path: "" }, github)).toBeNull();
    expect(switchSummary({ source: "pypi", repo: "", ref: "", path: "" }, pypi)).toBeNull();
    expect(switchSummary({ source: "local", repo: "", ref: "", path: localClone.path! + "/" }, localClone)).toBeNull();
    expect(switchSummary({ source: "pypi", repo: "", ref: "", path: "" }, github)).toContain("PyPI");
  });
});

import { RECOMMENDED_PNL_CHOICE, SIMPLE_PNL_CHOICES, simpleChoiceOf } from "./pnlSources";

describe("the simple PsyNeuLink choice in General (#1295)", () => {
  const princetonDevel: PsyNeuLinkInfo = {
    version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink", commit: "72dde34", path: null,
  };

  it("maps the default repo's devel to Latest development, PyPI to Official release, anything else to custom", () => {
    expect(simpleChoiceOf(princetonDevel)).toBe("latest");
    expect(simpleChoiceOf({ ...princetonDevel, repo: "princetonuniversity/psyneulink" })).toBe("latest");
    expect(simpleChoiceOf({ ...princetonDevel, source: "pypi", repo: null, branch: null })).toBe("official");
    expect(simpleChoiceOf({ ...princetonDevel, branch: "master" })).toBe("custom");
    expect(simpleChoiceOf({ ...princetonDevel, repo: "jonhanke-nam/PsyNeuLink" })).toBe("custom");
    expect(simpleChoiceOf(localClone)).toBe("custom");
    expect(simpleChoiceOf({ ...princetonDevel, source: "unknown" })).toBeNull();
    expect(simpleChoiceOf(null)).toBeNull();
  });

  it("recommends the latest development branch, and each choice installs what it says", () => {
    expect(RECOMMENDED_PNL_CHOICE).toBe("latest");
    expect(SIMPLE_PNL_CHOICES.latest.form).toEqual({ source: "github", repo: "", ref: "devel", path: "" });
    expect(SIMPLE_PNL_CHOICES.official.form.source).toBe("pypi");
    // The forms round-trip through the mapping: a choice reads back as itself.
    expect(switchSummary(SIMPLE_PNL_CHOICES.latest.form, princetonDevel)).toBeNull();
    expect(switchSummary(SIMPLE_PNL_CHOICES.official.form, princetonDevel)).toContain("PyPI");
  });
});

import { defaultReleaseVersion, formatInstallSummary, officialVersionOf, releaseOptionLabel, releaseOptionState } from "./pnlSources";

describe("official releases in General (#1295 round 5)", () => {
  const row = (over: Partial<Parameters<typeof releaseOptionLabel>[0] & { limited_reason: string | null }>) => ({
    version: "0.20.2.0", released: "2026-08-14", kept: false, limited: false, compatible: true, reason: null, limited_reason: null, ...over,
  });

  it("labels a release with its date, and marks kept, limited and incompatible ones", () => {
    expect(releaseOptionLabel(row({}))).toBe("0.20.2.0 · released 2026-08-14");
    expect(releaseOptionLabel(row({ kept: true }))).toBe("0.20.2.0 · released 2026-08-14 · kept");
    expect(releaseOptionLabel(row({ version: "0.18.0.0", released: "2025-09-12", limited: true }))).toBe(
      "0.18.0.0 · released 2025-09-12 (no run stepping)",
    );
    expect(releaseOptionLabel(row({ version: "0.21.0.0", compatible: false, reason: "Needs Python >=3.14; this PsyNeuView runs Python 3.13.7" }))).toBe(
      "0.21.0.0 · released 2026-08-14 — Needs Python >=3.14; this PsyNeuView runs Python 3.13.7",
    );
    expect(releaseOptionLabel(row({ released: null, kept: true }))).toBe("0.20.2.0 · release date unknown · kept");
  });

  it("disables what can't install, with the reason as the tooltip; a limited one stays enabled with its limit", () => {
    expect(releaseOptionState(row({ compatible: false, reason: "Withdrawn by its authors" }))).toEqual({ disabled: true, title: "Withdrawn by its authors" });
    expect(releaseOptionState(row({ limited: true, limited_reason: "No run stepping, value pills or Run State: needs 0.19.1.0 or later" }))).toEqual({
      disabled: false, title: "No run stepping, value pills or Run State: needs 0.19.1.0 or later",
    });
    expect(releaseOptionState(row({}))).toEqual({ disabled: false, title: undefined });
  });

  it("starts the dropdown on the release in use, else the newest that can install", () => {
    const releases = [
      { version: "0.21.0.0", compatible: false }, { version: "0.20.2.0", compatible: true }, { version: "0.19.1.0", compatible: true },
    ];
    expect(defaultReleaseVersion(releases, "0.19.1.0")).toBe("0.19.1.0");
    expect(defaultReleaseVersion(releases, null)).toBe("0.20.2.0");
    expect(defaultReleaseVersion(releases, "0.5.0")).toBe("0.20.2.0");
    expect(defaultReleaseVersion([], null)).toBeNull();
  });

  it("names the version in the pre-switch summary, and reads a PyPI install at any version as Official", () => {
    const pypi: PsyNeuLinkInfo = { version: "0.19.1.0", source: "pypi", branch: null, repo: null, commit: null, path: null };
    expect(officialVersionOf(pypi)).toBe("0.19.1.0");
    expect(officialVersionOf(localClone)).toBeNull();
    expect(switchSummary({ source: "pypi", repo: "", ref: "", path: "", version: "0.20.2.0" }, pypi)).toContain("PyPI 0.20.2.0 (the official release)");
    expect(switchSummary({ source: "pypi", repo: "", ref: "", path: "", version: "0.19.1.0" }, pypi)).toBeNull();
    expect(switchSummary({ source: "pypi", repo: "", ref: "", path: "" }, pypi)).toBeNull();
  });

  it("summarises an install without its path, for rows that show the path on its own line", () => {
    expect(formatInstallSummary(localClone)).toBe("Your PsyNeuLink checkout · PrincetonUniversity/PsyNeuLink @ devel (72dde34)");
    expect(formatInstallSummary({ ...localClone, repo: null, branch: null, commit: null })).toBe("Your PsyNeuLink checkout");
    expect(formatInstallSummary({ version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink", commit: "72dde34", path: null })).toBe(
      "GitHub · PrincetonUniversity/PsyNeuLink @ devel (72dde34)",
    );
    expect(formatInstallSummary({ version: "0.20.2.0", source: "pypi", branch: null, repo: null, commit: null, path: null })).toBe("PyPI · 0.20.2.0");
  });
});

import { somethingToApply } from "./pnlSources";

describe("whether Apply & restart has anything to apply (#1303)", () => {
  const github: PsyNeuLinkInfo = {
    version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink", commit: "72dde34",
    path: "/Users/me/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
  };
  const pypi: PsyNeuLinkInfo = { version: "0.19.1.0", source: "pypi", branch: null, repo: null, commit: null, path: null };
  const form = (over: Partial<InstallForm>): InstallForm => ({ source: "github", repo: "", ref: "", path: "", ...over });

  it("GitHub: the same repo and branch however written is nothing to apply; another repo or branch is", () => {
    expect(somethingToApply(form({}), github)).toBe(false); // blank = the default repo, the installed branch
    expect(somethingToApply(form({ repo: "princetonuniversity/psyneulink", ref: " /devel/ " }), github)).toBe(false);
    expect(somethingToApply(form({ repo: "PrincetonUniversity/PsyNeuLink", ref: "devel" }), github)).toBe(false);
    expect(somethingToApply(form({ ref: "master" }), github)).toBe(true);
    expect(somethingToApply(form({ repo: "jonhanke-nam/PsyNeuLink" }), github)).toBe(true);
    expect(somethingToApply(form({ source: "pypi" }), github)).toBe(true);
    expect(somethingToApply(form({ source: "local", path: github.path! }), github)).toBe(true);
  });

  it("PyPI: the installed version is nothing to apply; another version is", () => {
    expect(somethingToApply(form({ source: "pypi", version: "0.19.1.0" }), pypi)).toBe(false);
    expect(somethingToApply(form({ source: "pypi", version: "0.20.2.0" }), pypi)).toBe(true);
    expect(somethingToApply(form({ source: "github", ref: "devel" }), pypi)).toBe(true);
  });

  it("PyPI without a version means the newest: nothing to apply only when that is installed", () => {
    expect(somethingToApply(form({ source: "pypi" }), pypi, { newestRelease: "0.19.1.0" })).toBe(false);
    expect(somethingToApply(form({ source: "pypi" }), pypi, { newestRelease: "0.20.2.0" })).toBe(true);
    // Unknown newest: a PyPI install reads as the same thing, as before.
    expect(somethingToApply(form({ source: "pypi" }), pypi)).toBe(false);
    expect(somethingToApply(form({ source: "pypi" }), pypi, { newestRelease: null })).toBe(false);
  });

  it("a local checkout: the same folder with ~, a trailing slash or spaces is nothing to apply", () => {
    expect(somethingToApply(form({ source: "local", path: localClone.path! }), localClone)).toBe(false);
    expect(somethingToApply(form({ source: "local", path: `${localClone.path}/` }), localClone)).toBe(false);
    expect(somethingToApply(form({ source: "local", path: ` ${localClone.path} ` }), localClone)).toBe(false);
    expect(somethingToApply(form({ source: "local", path: "~/PsyNeuLink-clone-test-1" }), localClone)).toBe(false);
    expect(somethingToApply(form({ source: "local", path: "~/PsyNeuLink-clone-test-1/" }), localClone)).toBe(false);
    expect(somethingToApply(form({ source: "local", path: "~/other" }), localClone)).toBe(true);
    expect(somethingToApply(form({ source: "local", path: "/Users/you/PsyNeuLink-clone-test-1" }), localClone)).toBe(true);
    expect(somethingToApply(form({ source: "local", path: "" }), localClone)).toBe(true);
  });

  it("agrees with the pre-switch summary, which says nothing when there is nothing to apply", () => {
    expect(switchSummary(form({ source: "pypi" }), pypi, { newestRelease: "0.20.2.0" })).toContain("PyPI");
    expect(switchSummary(form({ source: "pypi" }), pypi, { newestRelease: "0.19.1.0" })).toBeNull();
    expect(switchSummary(form({ source: "local", path: "~/PsyNeuLink-clone-test-1/" }), localClone)).toBeNull();
  });
});

// ─── The Switch to dropdown (#1331) ──────────────────────────────────────────

import {
  dropPlaceholderSources,
  findSwitchOption,
  formForChoice,
  installFormProblem,
  isPlaceholderRepo,
  parseSwitchChoice,
  sourceFullName,
  sourceOptionName,
  switchChoiceValue,
  switchGroups,
  type ReleaseRow,
} from "./pnlSources";

const LONG = "refactor/emcomposition/externalmemorymechanisms_SHOW_GRAPH";
const checkoutInUse: PsyNeuLinkInfo = {
  version: "0.19.1.0", source: "editable", branch: "jonhanke-dev", repo: "jonhanke-nam/PsyNeuLink",
  commit: "1a2b3c4", path: "/Users/me/code/PsyNeuLink",
};
const mine = entry({ id: "local:/Users/me/code/PsyNeuLink", kind: "local", path: "/Users/me/code/PsyNeuLink", editable: true, active: true, selected_at: 9 });
const gone = entry({ id: "local:/Users/me/old/PsyNeuLink", kind: "local", path: "/Users/me/old/PsyNeuLink", editable: true, missing: true, label: "Old clone" });
const princeton = entry({ id: "github:princetonuniversity/psyneulink@devel", kind: "github", repo: "PrincetonUniversity/PsyNeuLink", ref: "devel", selected_at: 8 });
const long = entry({ id: `github:princetonuniversity/psyneulink@${LONG}`, kind: "github", repo: "PrincetonUniversity/PsyNeuLink", ref: LONG, selected_at: 7 });
const placeholder = entry({ id: "github:owner/repo@devel", kind: "github", repo: "owner/repo", ref: "devel", selected_at: 10 });
const pypiKnown = entry({ id: "pypi", kind: "pypi" });
const releases: ReleaseRow[] = [
  { version: "0.21.0.0", released: "2026-09-30", kept: false, limited: false, compatible: false, reason: "Needs Python >=3.14", limited_reason: null },
  { version: "0.20.2.0", released: "2026-08-14", kept: true, limited: false, compatible: true, reason: null, limited_reason: null },
  { version: "0.19.1.0", released: "2026-03-01", kept: false, limited: false, compatible: true, reason: null, limited_reason: null },
];

describe("placeholders are never a source (#1292)", () => {
  it("recognises the example slugs and their shape", () => {
    for (const r of ["owner/repo", "Owner/Repo", "org/repo", "your-org/your-repo", "<owner>/<repo>", "owner/PsyNeuLink", "x/repo", "a/..."]) {
      expect(isPlaceholderRepo(r), r).toBe(true);
    }
    for (const r of ["PrincetonUniversity/PsyNeuLink", "jonhanke-nam/PsyNeuLink", "ownerly/repository-tools", "", null]) {
      expect(isPlaceholderRepo(r), String(r)).toBe(false);
    }
  });

  it("drops a placeholder entry an older backend may still list", () => {
    expect(dropPlaceholderSources([placeholder, princeton, mine]).map((e) => e.id)).toEqual([princeton.id, mine.id]);
  });
});

describe("what is missing before Apply & restart (#1331)", () => {
  it("wants a path for a checkout", () => {
    expect(installFormProblem({ source: "local", repo: "", ref: "", path: "  " })).toMatch(/Enter the path/);
    expect(installFormProblem({ source: "local", repo: "", ref: "", path: "~/code/PsyNeuLink" })).toBeNull();
  });

  it("wants owner/name and a branch for GitHub, and refuses the placeholder", () => {
    expect(installFormProblem({ source: "github", repo: "not a repo", ref: "devel", path: "" })).toMatch(/owner\/name/);
    expect(installFormProblem({ source: "github", repo: "owner/repo", ref: "devel", path: "" })).toMatch(/the example/);
    expect(installFormProblem({ source: "github", repo: "", ref: " / ", path: "" })).toBe("Enter a branch or tag.");
    expect(installFormProblem({ source: "github", repo: "", ref: "devel", path: "" })).toBeNull();
    expect(installFormProblem({ source: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "/devel/", path: "" })).toBeNull();
  });

  it("has nothing to ask about a release", () => {
    expect(installFormProblem({ source: "pypi", repo: "", ref: "", path: "", version: "0.20.2.0" })).toBeNull();
  });
});

describe("the Switch to dropdown's groups (#1331, folded in #1334)", () => {
  const fork = entry({ id: "github:jonhanke-nam/psyneulink@jonhanke-dev", kind: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev", selected_at: 9 });
  const groups = switchGroups([placeholder, fork, mine, princeton, long, gone, pypiKnown], releases, checkoutInUse, { newestRelease: "0.20.2.0" });
  const byId = (id: string) => groups.find((g) => g.id === id)!;

  it("lists the two Another… rows first, then your checkouts, a group per repo, then the releases", () => {
    expect(groups.map((g) => g.id)).toEqual(["other", "checkouts", "repo:princetonuniversity/psyneulink", "repo:jonhanke-nam/psyneulink", "releases"]);
    expect(groups.map((g) => g.kind)).toEqual(["other", "checkouts", "repo", "repo", "releases"]);
    expect(groups[0].label).toBeNull();
    expect(groups[0].options.map((o) => o.name)).toEqual(["Another local checkout…", "Another GitHub repo or branch…"]);
    expect(byId("checkouts").label).toBe("Your checkouts");
    expect(byId("releases").label).toBe("Official releases on PyPI");
  });

  it("groups GitHub sources by repo, the default repo first and the rest in the backend's order, headed by the repo's name", () => {
    expect(byId("repo:princetonuniversity/psyneulink").label).toBe("PrincetonUniversity/PsyNeuLink");
    expect(byId("repo:princetonuniversity/psyneulink").options).toHaveLength(2);
    expect(byId("repo:jonhanke-nam/psyneulink").label).toBe("jonhanke-nam/PsyNeuLink");
    expect(byId("repo:jonhanke-nam/psyneulink").options).toHaveLength(1);
    // Case is only a matter of spelling: the same repo twice is one group.
    const g = switchGroups([princeton, entry({ ...long, id: "github:x", repo: "princetonuniversity/psyneulink" })], null, checkoutInUse);
    expect(g.filter((x) => x.kind === "repo")).toHaveLength(1);
    expect(g.find((x) => x.kind === "repo")!.options).toHaveLength(2);
  });

  it("names a branch row by the branch alone, with the full name as the tooltip and out of its group", () => {
    const rows = byId("repo:princetonuniversity/psyneulink").options;
    expect(rows.map((o) => o.name)).toEqual(["devel", LONG]);
    expect(rows.map((o) => o.fullName)).toEqual(["PrincetonUniversity/PsyNeuLink @ devel", `PrincetonUniversity/PsyNeuLink @ ${LONG}`]);
    expect(rows[1].title).toBe(`PrincetonUniversity/PsyNeuLink @ ${LONG}`);
    expect(rows[1].detail).toBeNull();
  });

  it("keeps the backend's order within a group and shows checkouts by their folder", () => {
    expect(byId("checkouts").options.map((o) => o.name)).toEqual(["~/code/PsyNeuLink", "Old clone"]);
    expect(byId("checkouts").options[1].detail).toBe("folder missing");
    expect(byId("checkouts").options[1].title).toBe("Old clone — /Users/me/old/PsyNeuLink — the folder is missing");
    expect(byId("checkouts").options[1].disabled).toBe(true);
  });

  it("marks the one in use, and only it", () => {
    const current = groups.flatMap((g) => g.options).filter((o) => o.current).map((o) => o.value);
    expect(current).toEqual([switchChoiceValue({ kind: "known", id: mine.id })]);
  });

  it("leaves the placeholder out", () => {
    expect(groups.flatMap((g) => g.options).some((o) => o.name.includes("owner/repo") || o.title.includes("owner/repo"))).toBe(false);
  });

  it("lists the releases with their dates, the newest in the heading, incompatible ones disabled with the reason, and no bare PyPI row", () => {
    const rows = byId("releases").options;
    expect(byId("releases").note).toBe("newest 0.21.0.0");
    expect(rows.map((o) => o.name)).toEqual(["0.21.0.0", "0.20.2.0", "0.19.1.0"]);
    expect(rows[0].disabled).toBe(true);
    expect(rows[0].title).toBe("PyPI 0.21.0.0 — Needs Python >=3.14");
    expect(rows[1].detail).toBe("released 2026-08-14 · kept");
    expect(rows[1].form).toEqual({ source: "pypi", repo: "", ref: "", path: "", version: "0.20.2.0" });
  });

  it("marks the installed release as in use", () => {
    const g = switchGroups([princeton], releases, { version: "0.20.2.0", source: "pypi", branch: null, repo: null, commit: null, path: null });
    const rel = g.find((x) => x.id === "releases")!.options;
    expect(rel.map((o) => o.current)).toEqual([false, true, false]);
    expect(g.find((x) => x.kind === "repo")!.options[0].current).toBe(false);
  });

  it("falls back to the known PyPI row while the releases aren't known, and leaves empty groups out", () => {
    const g = switchGroups([pypiKnown], null, checkoutInUse);
    expect(g.map((x) => x.id)).toEqual(["other", "releases"]);
    expect(g[1].options[0].name).toBe("PyPI (newest official release)");
    expect(g[1].note).toBeNull();
    expect(switchGroups([], null, checkoutInUse).map((x) => x.id)).toEqual(["other"]);
  });

  it("names a source by its label, with what it names as the detail and the tooltip", () => {
    const named = entry({ ...princeton, label: "Upstream" });
    expect(sourceOptionName(named)).toBe("Upstream");
    expect(sourceFullName(named)).toBe("Upstream — PrincetonUniversity/PsyNeuLink @ devel");
    const opt = switchGroups([named], null, checkoutInUse).find((g) => g.kind === "repo")!.options[0];
    expect(opt.name).toBe("Upstream");
    expect(opt.detail).toBe("devel");
    expect(opt.fullName).toBe("Upstream");
    expect(opt.title).toBe("Upstream — PrincetonUniversity/PsyNeuLink @ devel");
  });

  it("round-trips a choice through its value, and finds the form it stands for", () => {
    for (const c of [{ kind: "known", id: mine.id }, { kind: "release", version: "0.20.2.0" }, { kind: "other-local" }, { kind: "other-github" }] as const) {
      expect(parseSwitchChoice(switchChoiceValue(c))).toEqual(c);
    }
    expect(parseSwitchChoice("nope")).toBeNull();
    const typed = { repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev", path: "~/x" };
    expect(formForChoice(null, groups, typed)).toBeNull();
    expect(formForChoice({ kind: "known", id: "local:/vanished" }, groups, typed)).toBeNull();
    expect(formForChoice({ kind: "known", id: princeton.id }, groups, typed)).toEqual({ source: "github", repo: "", ref: "devel", path: "" });
    expect(formForChoice({ kind: "release", version: "0.19.1.0" }, groups, typed)?.version).toBe("0.19.1.0");
    expect(formForChoice({ kind: "other-local" }, groups, typed)).toEqual({ source: "local", repo: "", ref: "", path: "~/x" });
    expect(formForChoice({ kind: "other-github" }, groups, typed)).toEqual({ source: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev", path: "" });
    expect(findSwitchOption(groups, { kind: "known", id: princeton.id })?.fullName).toBe("PrincetonUniversity/PsyNeuLink @ devel");
  });
});

import { RELEASES_SHOWN, groupsOpenAtFirst, splitOlderReleases } from "./pnlSources";

describe("how the Switch to list opens (#1334)", () => {
  const fork = entry({ id: "github:jonhanke-nam/psyneulink@jonhanke-dev", kind: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev" });
  // The checkout as the backend lists it when something else is in use.
  const mine = entry({ id: "local:/Users/me/code/PsyNeuLink", kind: "local", path: "/Users/me/code/PsyNeuLink", editable: true });
  const princetonDevel: PsyNeuLinkInfo = {
    version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink", commit: "72dde34", path: null,
  };

  it("opens only the group holding the PsyNeuLink in use", () => {
    const groups = switchGroups([mine, princeton, long, fork], releases, princetonDevel);
    expect([...groupsOpenAtFirst(groups)]).toEqual(["repo:princetonuniversity/psyneulink"]);
    expect([...groupsOpenAtFirst(switchGroups([mine, princeton, fork], releases, checkoutInUse))]).toEqual(["checkouts"]);
    const pypi: PsyNeuLinkInfo = { version: "0.20.2.0", source: "pypi", branch: null, repo: null, commit: null, path: null };
    expect([...groupsOpenAtFirst(switchGroups([mine, princeton], releases, pypi))]).toEqual(["releases"]);
  });

  it("opens nothing when nothing matches what is in use, and never counts the Another… rows", () => {
    const custom: PsyNeuLinkInfo = { ...princetonDevel, repo: "someone-else/PsyNeuLink", branch: "feature" };
    expect(groupsOpenAtFirst(switchGroups([mine, princeton, fork], releases, custom)).size).toBe(0);
    expect(groupsOpenAtFirst(switchGroups([], null, custom)).size).toBe(0);
  });

  it("also opens the group holding what has been chosen since, so the chosen row is in view", () => {
    const groups = switchGroups([mine, princeton, fork], releases, princetonDevel);
    expect([...groupsOpenAtFirst(groups, switchChoiceValue({ kind: "known", id: fork.id }))]).toEqual([
      "repo:princetonuniversity/psyneulink", "repo:jonhanke-nam/psyneulink",
    ]);
    expect([...groupsOpenAtFirst(groups, "other-local")]).toEqual(["repo:princetonuniversity/psyneulink"]);
  });

  it("shows the newest five releases and keeps the rest behind Show older", () => {
    const many: ReleaseRow[] = Array.from({ length: 9 }, (_, i) => ({
      version: `0.${20 - i}.0.0`, released: null, kept: false, limited: false, compatible: i !== 1, reason: i === 1 ? "Withdrawn" : null, limited_reason: null,
    }));
    const rows = switchGroups([], many, checkoutInUse).find((g) => g.id === "releases")!.options;
    const { shown, older } = splitOlderReleases(rows);
    expect(RELEASES_SHOWN).toBe(5);
    expect(shown.map((o) => o.name)).toEqual(["0.20.0.0", "0.19.0.0", "0.18.0.0", "0.17.0.0", "0.16.0.0"]);
    expect(older.map((o) => o.name)).toEqual(["0.15.0.0", "0.14.0.0", "0.13.0.0", "0.12.0.0"]);
    // An incompatible release among the newest keeps its place, disabled.
    expect(shown[1].disabled).toBe(true);
  });

  it("shows every release when there are five or fewer, or when the one in use is older than the newest five", () => {
    const few = switchGroups([], releases, checkoutInUse).find((g) => g.id === "releases")!.options;
    expect(splitOlderReleases(few)).toEqual({ shown: few, older: [] });
    const many: ReleaseRow[] = Array.from({ length: 8 }, (_, i) => ({
      version: `0.${20 - i}.0.0`, released: null, kept: false, limited: false, compatible: true, reason: null, limited_reason: null,
    }));
    const old: PsyNeuLinkInfo = { version: "0.13.0.0", source: "pypi", branch: null, repo: null, commit: null, path: null };
    const rows = switchGroups([], many, old).find((g) => g.id === "releases")!.options;
    expect(rows[7].current).toBe(true);
    expect(splitOlderReleases(rows).older).toEqual([]);
    expect(splitOlderReleases(rows).shown).toHaveLength(8);
  });
});

// ─── Downloading PsyNeuLink into an empty folder (#1342) ──────────────

import { DEFAULT_DOWNLOAD_SOURCE, downloadSourceName, downloadSources } from "./pnlSources";
import { installRequestBody } from "@/components/common/settings/useInstallJob";

describe("an empty folder under Another local checkout… (#1342)", () => {
  const into = (download?: { repo: string; ref: string }): InstallForm => ({
    source: "local", repo: "", ref: "", path: "~/Documents/PNV--my-local-PNL-repo", download,
  });

  it("offers Latest development first, then each other known GitHub source once", () => {
    const known = [
      entry({ id: "a", kind: "github", repo: "PrincetonUniversity/PsyNeuLink", ref: "devel" }),
      entry({ id: "b", kind: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev" }),
      entry({ id: "c", kind: "github", repo: "owner/repo", ref: "devel" }),
      entry({ id: "d", kind: "local", path: "/x" }),
      entry({ id: "e", kind: "github", repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev" }),
    ];
    expect(downloadSources(known)).toEqual([
      DEFAULT_DOWNLOAD_SOURCE,
      { repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev" },
    ]);
    expect(downloadSources([])).toEqual([DEFAULT_DOWNLOAD_SOURCE]);
    expect(downloadSourceName(DEFAULT_DOWNLOAD_SOURCE)).toBe("Latest development (PrincetonUniversity/PsyNeuLink @ devel)");
    expect(downloadSourceName({ repo: "jonhanke-nam/PsyNeuLink", ref: "jonhanke-dev" })).toBe("jonhanke-nam/PsyNeuLink @ jonhanke-dev");
  });

  it("says the wait is a download's, and what the switch does", () => {
    expect(expectedWait(into(DEFAULT_DOWNLOAD_SOURCE), localClone)).toBe("a few minutes, to download PsyNeuLink");
    expect(expectedWait(into(), localClone)).toBe("a few seconds");
    expect(switchSummary(into(DEFAULT_DOWNLOAD_SOURCE), localClone)).toBe(
      "PsyNeuLink will be downloaded from Latest development (PrincetonUniversity/PsyNeuLink @ devel) into " +
        "~/Documents/PNV--my-local-PNL-repo, installed so your edits there take effect, and used from then on. " +
        "Library, Examples and Tests will list the models in it. My Project Folder and your catalogs stay the same.",
    );
  });

  it("sends the download with the install request, and nothing extra without one", () => {
    expect(installRequestBody(into(DEFAULT_DOWNLOAD_SOURCE))).toEqual({
      source: "local", path: "~/Documents/PNV--my-local-PNL-repo",
      download_repo: "PrincetonUniversity/PsyNeuLink", download_ref: "devel",
    });
    expect(installRequestBody(into())).toEqual({ source: "local", path: "~/Documents/PNV--my-local-PNL-repo" });
  });
});
