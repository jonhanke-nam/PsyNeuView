/**
 * What PsyNeuLink is installed, and the sources Settings can switch to (#1276).
 *
 * Pure helpers for Settings' PsyNeuLink readouts, kept out of the
 * component so they can be unit-tested: how the current install reads, which
 * source the Change install form starts on, how a remembered source is
 * labelled, and roughly how long a switch will take.
 */

export type InstallSource = "pypi" | "github" | "local";

/** `/api/settings/info`'s `psyneulink` block. */
export interface PsyNeuLinkInfo {
  version: string | null;
  source: "pypi" | "github" | "editable" | "unknown";
  branch: string | null;
  repo: string | null;
  commit: string | null;
  path: string | null;
}

/** One entry of `/api/settings/pnl-sources`. */
export interface PnlSourceEntry {
  id: string;
  kind: InstallSource;
  repo: string | null;
  ref: string | null;
  path: string | null;
  label: string | null;
  selected_at: number;
  /** A local checkout: the user's own folder. GitHub and PyPI are managed, read-only. */
  editable: boolean;
  active: boolean;
  /** False only for an active source installed outside Settings and not yet on the list. */
  remembered: boolean;
  /** A local checkout whose folder is gone. */
  missing: boolean;
}

/** What the Change install form holds. */
export interface InstallForm {
  source: InstallSource;
  repo: string;
  ref: string;
  path: string;
  /** A PyPI release to install (#1295 round 5); absent means the newest. */
  version?: string;
  /**
   * source=local into an empty or missing folder (#1342): download
   * PsyNeuLink from this GitHub repo and branch into `path` first.
   */
  download?: DownloadSource;
}

/** Where PsyNeuLink is downloaded from into an empty folder (#1342). */
export interface DownloadSource {
  repo: string;
  ref: string;
}

/**
 * What the backend found at the path typed under "Another local checkout…"
 * (#1342, `GET /api/settings/install/check-folder`): a checkout to switch
 * to, an empty or missing folder PsyNeuLink can be downloaded into, or
 * neither, with the reason in plain words.
 */
export interface LocalFolderCheck {
  status: "usable" | "downloadable" | "refused";
  path: string;
  exists: boolean;
  reason: string | null;
}

export const DEFAULT_GITHUB_REPO = "PrincetonUniversity/PsyNeuLink";

/**
 * The "Currently installed" line. A local checkout leads with its path, even
 * when its folder is a clone of a GitHub repo (#1276): it's the user's own
 * folder and may hold edits, so where it was cloned from is secondary detail.
 */
export function formatCurrentInstall(pnl: PsyNeuLinkInfo): string {
  switch (pnl.source) {
    case "github":
      if (pnl.repo && pnl.branch) {
        return `GitHub: ${pnl.repo} @ ${pnl.branch}${pnl.commit ? ` (${pnl.commit})` : ""}`;
      }
      return "GitHub install";
    case "pypi":
      return `PyPI release${pnl.version ? ` (${pnl.version})` : ""}`;
    case "editable": {
      const origin =
        pnl.repo && pnl.branch ? `${pnl.repo} @ ${pnl.branch}` : (pnl.repo ?? pnl.branch);
      const detail = [origin, pnl.commit].filter(Boolean).join(", ");
      return `Local checkout: ${pnl.path ?? "unknown folder"}${detail ? ` (${detail})` : ""}`;
    }
    case "unknown":
    default:
      return "Unknown — not detected";
  }
}

/**
 * The form's starting point: the source that is installed now (#1276), so the
 * panel never reads as if PyPI were in use while a local checkout is, and
 * Apply & restart can't switch away by accident. For GitHub the branch stays
 * blank so it doesn't filter the branch list (#457); the placeholder shows it.
 */
export function initialInstallForm(pnl: PsyNeuLinkInfo): InstallForm {
  switch (pnl.source) {
    case "editable":
      return { source: "local", repo: "", ref: "", path: pnl.path ?? "" };
    case "github":
      return {
        source: "github",
        repo: pnl.repo && pnl.repo !== DEFAULT_GITHUB_REPO ? pnl.repo : "",
        ref: "",
        path: "",
      };
    default:
      return { source: "pypi", repo: "", ref: "", path: "" };
  }
}

/** Fill the form from a remembered source. */
export function formFromSourceEntry(entry: PnlSourceEntry): InstallForm {
  return {
    source: entry.kind,
    repo: entry.kind === "github" && entry.repo !== DEFAULT_GITHUB_REPO ? (entry.repo ?? "") : "",
    ref: entry.kind === "github" ? (entry.ref ?? "") : "",
    path: entry.kind === "local" ? (entry.path ?? "") : "",
  };
}

/** Whether the form currently describes ``entry``. */
export function formMatchesEntry(form: InstallForm, entry: PnlSourceEntry): boolean {
  if (form.source !== entry.kind) return false;
  if (entry.kind === "local") return trimSlash(form.path) === trimSlash(entry.path ?? "");
  if (entry.kind === "github") {
    const repo = form.repo.trim() || DEFAULT_GITHUB_REPO;
    return (
      repo.toLowerCase() === (entry.repo ?? "").toLowerCase() &&
      normalizeRef(form.ref) === (entry.ref ?? "")
    );
  }
  return true;
}

/** How a source reads when the user hasn't named it. */
export function defaultSourceLabel(entry: PnlSourceEntry): string {
  switch (entry.kind) {
    case "github":
      return `GitHub: ${entry.repo} @ ${entry.ref}`;
    case "pypi":
      return "PyPI (official release)";
    case "local":
    default:
      return `Local checkout: ${entry.path}`;
  }
}

/**
 * Roughly how long Apply & restart will take, shown before switching (#1276).
 * A local checkout installs in place without dependencies, and one already
 * installed skips pip altogether. GitHub re-fetches its managed clone and
 * reinstalls when it moved; PyPI downloads a release.
 */
export function expectedWait(form: InstallForm, current: PsyNeuLinkInfo | null): string {
  // All of PsyNeuLink and its history comes down first (#1342).
  if (form.source === "local" && form.download) return "a few minutes, to download PsyNeuLink";
  if (form.source === "local") return "a few seconds";
  if (
    form.source === "github" &&
    current?.source === "github" &&
    (form.repo.trim() || DEFAULT_GITHUB_REPO).toLowerCase() === (current.repo ?? "").toLowerCase()
  ) {
    // Same managed clone: a fetch and a checkout, pip only if pyproject moved.
    return "a few seconds";
  }
  return "about a minute";
}

function trimSlash(s: string): string {
  return s.trim().replace(/\/+$/, "");
}

/** A git ref as the install request sends it: no surrounding whitespace or slashes (#248). */
function normalizeRef(ref: string): string {
  return ref.trim().replace(/^\/+|\/+$/g, "");
}

// ─── Where the Open menu's PsyNeuLink sections come from (#1295) ──────────

/** `~` for the home folder, the way Settings writes paths. Display only. */
function homeAbbreviated(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

/**
 * The installed PsyNeuLink in a few words, for an Open menu section heading
 * and the note after a switch: "PrincetonUniversity/PsyNeuLink @ devel",
 * "PyPI 0.19.1.0", "your checkout at ~/code/PsyNeuLink". Null when nothing is
 * known, so a heading can leave the hint out rather than say something false.
 */
export function pnlSourceName(pnl: PsyNeuLinkInfo | null | undefined): string | null {
  if (!pnl) return null;
  switch (pnl.source) {
    case "github":
      return pnl.repo ? `${pnl.repo}${pnl.branch ? ` @ ${pnl.branch}` : ""}` : "GitHub";
    case "pypi":
      return `PyPI${pnl.version ? ` ${pnl.version}` : ""}`;
    case "editable":
      return pnl.path ? `your checkout at ${homeAbbreviated(pnl.path)}` : "your checkout";
    default:
      return null;
  }
}

/** The secondary text on a PsyNeuLink section's heading: "from …". */
export function pnlSourceLabel(pnl: PsyNeuLinkInfo | null | undefined): string | null {
  const name = pnlSourceName(pnl);
  return name ? `from ${name}` : null;
}

/** The one-time note in the Open menu right after a switch. */
export function sourceSwitchNote(pnl: PsyNeuLinkInfo | null | undefined): string | null {
  const name = pnlSourceName(pnl);
  return name ? `Library, Examples and Tests now list ${name}.` : null;
}

/** What the Change install form would install, in the same words. */
export function describeInstallForm(form: InstallForm): string {
  switch (form.source) {
    case "github":
      return `${form.repo.trim() || DEFAULT_GITHUB_REPO} @ ${normalizeRef(form.ref) || "devel"}`;
    case "pypi":
      return form.version ? `PyPI ${form.version} (the official release)` : "PyPI (the official release)";
    case "local":
    default:
      return form.path.trim() ? `your checkout at ${homeAbbreviated(form.path.trim())}` : "your checkout";
  }
}

/**
 * The installed PsyNeuLink in one line without its path, for a row that
 * shows the path on its own line (#1295 round 5): "Your PsyNeuLink checkout
 * · jonhanke-nam/PsyNeuLink @ jonhanke-dev (cce6f67)", "GitHub ·
 * PrincetonUniversity/PsyNeuLink @ devel (72dde34)", "PyPI · 0.20.2".
 */
export function formatInstallSummary(pnl: PsyNeuLinkInfo): string {
  const origin = pnl.repo && pnl.branch ? `${pnl.repo} @ ${pnl.branch}` : (pnl.repo ?? pnl.branch ?? null);
  const detail = [origin, pnl.commit ? `(${pnl.commit})` : null].filter(Boolean).join(" ");
  switch (pnl.source) {
    case "github":
      return `GitHub${detail ? ` · ${detail}` : ""}`;
    case "pypi":
      return `PyPI${pnl.version ? ` · ${pnl.version}` : ""}`;
    case "editable":
      return `Your PsyNeuLink checkout${detail ? ` · ${detail}` : ""}`;
    default:
      return "Unknown — not detected";
  }
}

/**
 * Before Apply & restart: what a switch changes and what it doesn't. Null
 * while the form still describes the PsyNeuLink installed now, so nothing is
 * announced for a switch to the same thing.
 */
export function switchSummary(
  form: InstallForm,
  current: PsyNeuLinkInfo | null,
  options: ApplyOptions = {},
): string | null {
  if (current && !somethingToApply(form, current, options)) return null;
  if (form.source === "local" && form.download) {
    return (
      `PsyNeuLink will be downloaded from ${downloadSourceName(form.download)} into ` +
      `${homeAbbreviated(form.path.trim())}, installed so your edits there take effect, and used from then on. ` +
      `Library, Examples and Tests will list the models in it. My Project Folder and your catalogs stay the same.`
    );
  }
  return (
    `Library, Examples and Tests will list the models in ${describeInstallForm(form)}. ` +
    "My Project Folder and your catalogs stay the same."
  );
}

/** What the comparison needs beyond the form and the install: see `somethingToApply`. */
export interface ApplyOptions {
  /**
   * The newest official release that can install here, when known. A PyPI
   * form without a version installs it, so "nothing to apply" means the
   * installed release is that one. Unknown (absent or null): any PyPI
   * install counts as the same thing, as before.
   */
  newestRelease?: string | null;
}

/**
 * Whether pressing Apply & restart would change anything (#1303): the form
 * compared with the installed PsyNeuLink, normalised the same way the install
 * request and `simpleChoiceOf` are. A GitHub repo is matched case-insensitively,
 * blank meaning the default repo, and a blank ref meaning the installed
 * branch; a ref is trimmed of slashes. A PyPI form with a version matches that
 * version; without one it means the newest (see `ApplyOptions`). A local path
 * is matched after trimming, dropping a trailing slash and expanding `~` with
 * the home folder the installed path is under.
 *
 * The one place this is decided, so the button, the pre-switch summary and
 * the status line can never disagree.
 */
export function somethingToApply(form: InstallForm, current: PsyNeuLinkInfo, options: ApplyOptions = {}): boolean {
  switch (form.source) {
    case "pypi": {
      if (current.source !== "pypi") return true;
      const wanted = form.version || options.newestRelease || null;
      return wanted !== null && wanted !== current.version;
    }
    case "local": {
      if (current.source !== "editable") return true;
      const installed = trimSlash(current.path ?? "");
      return expandHomeLike(trimSlash(form.path), installed) !== installed;
    }
    case "github":
      return !(
        current.source === "github" &&
        (form.repo.trim() || DEFAULT_GITHUB_REPO).toLowerCase() === (current.repo ?? "").toLowerCase() &&
        (normalizeRef(form.ref) || (current.branch ?? "")) === (current.branch ?? "")
      );
  }
}

/** `~/x` → `<home>/x`, taking the home folder from `like` (an installed path) when it is under one. */
function expandHomeLike(p: string, like: string): string {
  if (p !== "~" && !p.startsWith("~/")) return p;
  const home = like.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  return home ? home + p.slice(1) : p;
}

// ─── The simple choice in General ▸ PsyNeuLink version (#1295 round 4) ─────

/**
 * Regular users choose between two PsyNeuLinks; the full form in Developer
 * can set anything. Both edit the same setting through the same install
 * mechanism (settings/useInstallJob.ts): this is only the mapping between
 * the two words and the install form.
 */
export type SimplePnlChoice = "latest" | "official";

/**
 * The recommendation and the default for a new user. The one place it is
 * written: PyPI lags development too far behind today, so it is the latest
 * development branch; if that changes, change it here.
 */
export const RECOMMENDED_PNL_CHOICE: SimplePnlChoice = "latest";

export const SIMPLE_PNL_CHOICES: Record<SimplePnlChoice, { label: string; description: string; form: InstallForm }> = {
  latest: {
    label: "Latest development",
    description: `Newest features, from ${DEFAULT_GITHUB_REPO}`,
    form: { source: "github", repo: "", ref: "devel", path: "" },
  },
  official: {
    label: "Official release",
    description: "Stable, from PyPI",
    form: { source: "pypi", repo: "", ref: "", path: "" },
  },
};

/** The PyPI release in use, for the Official release dropdown; null otherwise. */
export function officialVersionOf(pnl: PsyNeuLinkInfo | null | undefined): string | null {
  return pnl?.source === "pypi" && pnl.version ? pnl.version : null;
}

/** A release row as shown in the dropdown: "0.20.2 · released 2026-08-14 · kept (no run stepping)". */
export function releaseOptionLabel(r: {
  version: string; released: string | null; kept: boolean; limited: boolean; compatible: boolean; reason: string | null;
}): string {
  let label = `${r.version} · ${r.released ? `released ${r.released}` : "release date unknown"}`;
  if (r.kept) label += " · kept";
  if (r.limited) label += " (no run stepping)";
  if (!r.compatible && r.reason) label += ` — ${r.reason}`;
  return label;
}

/** Whether a release can be picked, and the tooltip that says why not (or what it lacks). */
export function releaseOptionState(r: { compatible: boolean; reason: string | null; limited_reason: string | null }): {
  disabled: boolean; title: string | undefined;
} {
  return { disabled: !r.compatible, title: r.reason ?? r.limited_reason ?? undefined };
}

/** The release to start the dropdown on: the one in use, else the newest that can install. */
export function defaultReleaseVersion(
  releases: { version: string; compatible: boolean }[],
  inUse: string | null,
): string | null {
  if (inUse && releases.some((r) => r.version === inUse)) return inUse;
  return releases.find((r) => r.compatible)?.version ?? null;
}

/**
 * Which simple choice the installed PsyNeuLink is: "latest" for the default
 * repo's devel branch, "official" for PyPI, "custom" for anything else —
 * another repo or branch, or a checkout, set in Developer. Null when nothing
 * is known.
 */
export function simpleChoiceOf(pnl: PsyNeuLinkInfo | null | undefined): SimplePnlChoice | "custom" | null {
  if (!pnl || pnl.source === "unknown") return null;
  if (pnl.source === "pypi") return "official";
  if (
    pnl.source === "github" &&
    (pnl.repo ?? "").toLowerCase() === DEFAULT_GITHUB_REPO.toLowerCase() &&
    pnl.branch === "devel"
  ) {
    return "latest";
  }
  return "custom";
}

// ─── The Switch to dropdown in Developer ▸ Which PsyNeuLink is installed (#1331) ─

/** A GitHub repo as the install request wants it: `owner/name`. */
export const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/**
 * Example slugs that are never a source (#1292): the docs, the code and the
 * Repo field's placeholder all say `owner/repo`. The same list as the
 * backend's `source_history.is_placeholder_repo`, which refuses to record
 * one; this drops one an older backend may still list.
 */
const PLACEHOLDER_REPOS = new Set([
  "owner/repo", "owner/name", "org/repo", "user/repo", "username/repo",
  "your-org/your-repo", "example/repo", "<owner>/<repo>", "owner/repository",
]);
const PLACEHOLDER_OWNERS = new Set([
  "owner", "org", "user", "username", "example", "your-org", "yourorg", "your_org",
  "your-name", "yourname", "<owner>", "{owner}",
]);
const PLACEHOLDER_NAMES = new Set([
  "repo", "name", "repository", "your-repo", "yourrepo", "your_repo", "repo-name",
  "reponame", "<repo>", "{repo}",
]);

export function isPlaceholderRepo(repo: string | null | undefined): boolean {
  const slug = (repo ?? "").trim().toLowerCase();
  if (!slug) return false;
  if (PLACEHOLDER_REPOS.has(slug)) return true;
  if (/[<>{}[\]…]/.test(slug) || slug.includes("...")) return true;
  const [owner, name = ""] = slug.split("/", 2);
  return PLACEHOLDER_OWNERS.has(owner) || PLACEHOLDER_NAMES.has(name);
}

/** The known sources without any placeholder entry (#1292). */
export function dropPlaceholderSources(sources: PnlSourceEntry[]): PnlSourceEntry[] {
  return sources.filter((e) => !(e.kind === "github" && isPlaceholderRepo(e.repo)));
}

/**
 * What is missing or wrong before the form can be applied, in the user's
 * words, or null when it can be (#1331). A blank path, a repo that isn't
 * `owner/name` (or is the placeholder), a blank branch: no Apply & restart,
 * and this line says why. Form validation, not the §10 rule — that one
 * (`somethingToApply`) asks whether a valid form differs from what is in use.
 */
export function installFormProblem(form: InstallForm): string | null {
  switch (form.source) {
    case "local":
      return form.path.trim() ? null : "Enter the path to a PsyNeuLink checkout, or choose its folder.";
    case "github": {
      const repo = form.repo.trim();
      if (repo && !REPO_PATTERN.test(repo)) return "Repo must be owner/name, like PrincetonUniversity/PsyNeuLink.";
      if (repo && isPlaceholderRepo(repo)) return "owner/repo is the example: enter the real owner/name.";
      if (!normalizeRef(form.ref)) return "Enter a branch or tag.";
      return null;
    }
    case "pypi":
    default:
      return null;
  }
}

/** What the Switch to dropdown can be set to. */
export type SwitchChoice =
  | { kind: "known"; id: string }
  | { kind: "release"; version: string }
  | { kind: "other-local" }
  | { kind: "other-github" };

/** The dropdown's value for a choice: one string, so a row can carry it. */
export function switchChoiceValue(choice: SwitchChoice): string {
  switch (choice.kind) {
    case "known": return `known:${choice.id}`;
    case "release": return `release:${choice.version}`;
    case "other-local": return "other-local";
    case "other-github": return "other-github";
  }
}

export function parseSwitchChoice(value: string): SwitchChoice | null {
  if (value === "other-local" || value === "other-github") return { kind: value };
  if (value.startsWith("known:")) return { kind: "known", id: value.slice("known:".length) };
  if (value.startsWith("release:")) return { kind: "release", version: value.slice("release:".length) };
  return null;
}

/** One row of the dropdown. */
export interface SwitchOption {
  value: string;
  /**
   * The name as the row shows it, never truncated: a long branch wraps.
   * Inside a repo's group it is the branch alone (#1334), the heading
   * having said the repo.
   */
  name: string;
  /** The name on its own, out of its group: "repo @ branch" for a branch row. */
  fullName: string;
  /** A second line: a named source's path, a release's date, a missing folder. */
  detail: string | null;
  /** The tooltip: the full name, and the reason when it can't be picked. */
  title: string;
  /** The one in use now. */
  current: boolean;
  disabled: boolean;
  /** What picking it would install; null for the two "Another…" rows. */
  form: InstallForm | null;
}

export interface SwitchGroup {
  /** "other", "checkouts", "releases", or `repo:<owner/name>` in lower case. */
  id: string;
  kind: "other" | "checkouts" | "repo" | "releases";
  /** The heading; null for the first group: the two "Another…" rows need none. */
  label: string | null;
  /** After the heading, in brief: the releases group says the newest. */
  note: string | null;
  options: SwitchOption[];
}

/** A known source's name without its kind — the group heading says that. */
export function sourceOptionName(entry: PnlSourceEntry): string {
  if (entry.label) return entry.label;
  return sourceDefaultName(entry);
}

function sourceDefaultName(entry: PnlSourceEntry): string {
  switch (entry.kind) {
    case "github": return `${entry.repo} @ ${entry.ref}`;
    case "pypi": return "PyPI (newest official release)";
    case "local":
    default: return homeAbbreviated(entry.path ?? "");
  }
}

/** The full name as a tooltip: a named source with what it names, a path in full. */
export function sourceFullName(entry: PnlSourceEntry): string {
  const full = entry.kind === "local" ? (entry.path ?? "") : sourceDefaultName(entry);
  return entry.label ? `${entry.label} — ${full}` : full;
}

export interface ReleaseRow {
  version: string; released: string | null; kept: boolean; limited: boolean; compatible: boolean;
  reason: string | null; limited_reason: string | null;
}

/**
 * The dropdown's rows, grouped (#1331, folded in #1334): "Another local
 * checkout…" and "Another GitHub repo or branch…" first, always in view;
 * then groups that fold — your checkouts, one group per GitHub repo (the
 * heading names the repo, its rows the branch alone), and the official
 * releases with their dates (incompatible ones can't be picked, as in
 * General). The default repo's group comes before the other repos, which
 * keep the backend's order. The one in use is marked by the one rule the
 * button uses (`somethingToApply`), so the two can't disagree. A known PyPI
 * entry is listed only while the releases aren't known: once they are, the
 * releases group says it better. Empty groups are left out.
 */
export function switchGroups(
  sources: PnlSourceEntry[],
  releases: ReleaseRow[] | null,
  current: PsyNeuLinkInfo,
  options: ApplyOptions = {},
): SwitchGroup[] {
  const known = dropPlaceholderSources(sources);
  const isCurrent = (form: InstallForm) => !somethingToApply(form, current, options);
  const knownOption = (entry: PnlSourceEntry): SwitchOption => {
    const form = formFromSourceEntry(entry);
    const full = sourceFullName(entry);
    const missing = entry.kind === "local" && entry.missing;
    // In a repo's group the row says the branch; the heading said the repo.
    const inGroup = entry.kind === "github" ? (entry.ref ?? "") : sourceDefaultName(entry);
    return {
      value: switchChoiceValue({ kind: "known", id: entry.id }),
      name: entry.label ?? inGroup,
      fullName: sourceOptionName(entry),
      detail: missing ? "folder missing" : entry.label && entry.kind !== "pypi" ? inGroup : null,
      title: missing ? `${full} — the folder is missing` : full,
      current: entry.active || isCurrent(form),
      disabled: missing,
      form,
    };
  };
  const checkouts = known.filter((e) => e.kind === "local").map(knownOption);
  // One group per repo, by first appearance; the default repo first.
  const byRepo = new Map<string, { repo: string; options: SwitchOption[] }>();
  for (const entry of known) {
    if (entry.kind !== "github" || !entry.repo) continue;
    const key = entry.repo.toLowerCase();
    const group = byRepo.get(key) ?? { repo: entry.repo, options: [] };
    group.options.push(knownOption(entry));
    byRepo.set(key, group);
  }
  const repoGroups: SwitchGroup[] = [...byRepo.entries()]
    .sort(([a], [b]) => Number(b === DEFAULT_GITHUB_REPO.toLowerCase()) - Number(a === DEFAULT_GITHUB_REPO.toLowerCase()))
    .map(([key, g]) => ({ id: `repo:${key}`, kind: "repo", label: g.repo, note: null, options: g.options }));
  const releaseRows: SwitchOption[] = (releases ?? []).map((r) => {
    const state = releaseOptionState(r);
    const form: InstallForm = { source: "pypi", repo: "", ref: "", path: "", version: r.version };
    const name = `${r.version}`;
    return {
      value: switchChoiceValue({ kind: "release", version: r.version }),
      name,
      fullName: name,
      detail: releaseOptionLabel(r).slice(name.length + " · ".length),
      title: state.title ? `PyPI ${r.version} — ${state.title}` : `PyPI ${r.version}`,
      current: isCurrent(form),
      disabled: state.disabled,
      form,
    };
  });
  const pypiKnown = releases === null ? known.filter((e) => e.kind === "pypi").map(knownOption) : [];
  const other: SwitchOption[] = [
    {
      value: "other-local", name: "Another local checkout…", fullName: "Another local checkout…", detail: null,
      title: "A PsyNeuLink checkout of your own, by its folder", current: false, disabled: false, form: null,
    },
    {
      value: "other-github", name: "Another GitHub repo or branch…", fullName: "Another GitHub repo or branch…", detail: null,
      title: "Any public GitHub repo and branch", current: false, disabled: false, form: null,
    },
  ];
  const groups: SwitchGroup[] = [
    { id: "other", kind: "other", label: null, note: null, options: other },
    { id: "checkouts", kind: "checkouts", label: "Your checkouts", note: null, options: checkouts },
    ...repoGroups,
    {
      id: "releases", kind: "releases", label: "Official releases on PyPI",
      note: releaseRows.length > 0 ? `newest ${releaseRows[0].name}` : null,
      options: [...releaseRows, ...pypiKnown],
    },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/**
 * Which groups start open when the list opens (#1334): only the one holding
 * the PsyNeuLink in use, and the one holding what has been chosen since,
 * if that is another. Nothing matches (a source set outside Settings, say):
 * all folded. The first group has no heading and is always in view.
 */
export function groupsOpenAtFirst(groups: SwitchGroup[], selectedValue: string | null = null): Set<string> {
  const open = new Set<string>();
  for (const g of groups) {
    if (g.kind === "other") continue;
    if (g.options.some((o) => o.current || (selectedValue !== null && o.value === selectedValue))) open.add(g.id);
  }
  return open;
}

/** How many releases the releases group shows before "Show older (n)". */
export const RELEASES_SHOWN = 5;

/**
 * The releases group's rows as first shown (#1334): the newest few, the
 * rest behind "Show older (n)" — unless the release in use is among the
 * rest, in which case all are shown, so the one marked ✓ is never hidden.
 */
export function splitOlderReleases(options: SwitchOption[]): { shown: SwitchOption[]; older: SwitchOption[] } {
  const currentAt = options.findIndex((o) => o.current);
  if (options.length <= RELEASES_SHOWN || currentAt >= RELEASES_SHOWN) return { shown: options, older: [] };
  return { shown: options.slice(0, RELEASES_SHOWN), older: options.slice(RELEASES_SHOWN) };
}

/** The option a choice names, if it is still listed. */
export function findSwitchOption(groups: SwitchGroup[], choice: SwitchChoice | null): SwitchOption | null {
  if (!choice) return null;
  const value = switchChoiceValue(choice);
  for (const g of groups) {
    const found = g.options.find((o) => o.value === value);
    if (found) return found;
  }
  return null;
}

/**
 * The form a choice stands for: a known source's or a release's own, or the
 * fields typed under "Another…"; null when nothing is chosen (or the known
 * source is gone from the list).
 */
export function formForChoice(
  choice: SwitchChoice | null,
  groups: SwitchGroup[],
  typed: { repo: string; ref: string; path: string },
): InstallForm | null {
  if (!choice) return null;
  if (choice.kind === "other-local") return { source: "local", repo: "", ref: "", path: typed.path };
  if (choice.kind === "other-github") return { source: "github", repo: typed.repo, ref: typed.ref, path: "" };
  return findSwitchOption(groups, choice)?.form ?? null;
}

// ─── Downloading PsyNeuLink into an empty folder (#1342) ──────────────

/** The recommended source to download from: Princeton's devel, "Latest development". */
export const DEFAULT_DOWNLOAD_SOURCE: DownloadSource = { repo: DEFAULT_GITHUB_REPO, ref: "devel" };

/** "Latest development (PrincetonUniversity/PsyNeuLink @ devel)" for the default; "owner/name @ branch" otherwise. */
export function downloadSourceName(source: DownloadSource): string {
  const name = `${source.repo} @ ${source.ref}`;
  return sameDownloadSource(source, DEFAULT_DOWNLOAD_SOURCE) ? `Latest development (${name})` : name;
}

function sameDownloadSource(a: DownloadSource, b: DownloadSource): boolean {
  return a.repo.toLowerCase() === b.repo.toLowerCase() && a.ref === b.ref;
}

/** The value of a download source in the "Download from" dropdown. */
export function downloadSourceValue(source: DownloadSource): string {
  return `${source.repo}@${source.ref}`;
}

/**
 * What an empty folder can be filled from: "Latest development" first (the
 * recommendation and the default), then every other GitHub source Settings
 * knows, in the known sources' order, each once. A placeholder repo is never
 * one (#1292).
 */
export function downloadSources(known: PnlSourceEntry[]): DownloadSource[] {
  const out: DownloadSource[] = [DEFAULT_DOWNLOAD_SOURCE];
  for (const e of known) {
    if (e.kind !== "github" || !e.repo || !e.ref || isPlaceholderRepo(e.repo)) continue;
    const candidate = { repo: e.repo, ref: e.ref };
    if (!out.some((o) => sameDownloadSource(o, candidate))) out.push(candidate);
  }
  return out;
}
