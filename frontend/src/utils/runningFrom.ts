/**
 * What PsyNeuView is running, and from where (#1356).
 *
 * The Mac app runs either the PsyNeuView it includes or a git checkout the
 * user chose, and a checkout changes only when it is pulled, on whatever
 * branch it is on; a colleague ran an old one for weeks without anyone
 * noticing. Settings ▸ About says which, from `/api/settings/running`, and
 * this file turns that answer into the sentences it shows, and into the
 * diagnostics fields Report a Problem captures. Pure apart from the two
 * fetches at the bottom.
 */

/** What this build of the page came from; `__PNV_BUILD__` is defined by vite.config.ts. */
export interface PageBuild {
  version: string | null;
  commit: string | null;
  commitDate: string | null;
  dirty: boolean | null;
  builtAt: string | null;
  /** Served by the Vite dev server, which always serves the checkout as it is now. */
  devServer?: boolean;
}

declare const __PNV_BUILD__: PageBuild | undefined;

/** The page's own build, or null where it isn't defined (unit tests). */
export function pageBuild(): PageBuild | null {
  return typeof __PNV_BUILD__ !== "undefined" ? __PNV_BUILD__ : null;
}

/** Served live by the Vite dev server: the code is the checkout as it is now, so a commit can't be stale. */
export function isDevServer(page: PageBuild | null = pageBuild()): boolean {
  return !!page?.devServer;
}

/** `~` for the home folder, as everywhere else in Settings (display only). */
function abbreviateHome(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/) ?? p.match(/^\/home\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

export interface RunningGit {
  branch: string | null;
  commit: string | null;
  commit_date: string | null;
  dirty_files: number | null;
  upstream: string | null;
  ahead_by: number | null;
  behind_by: number | null;
  main_branch: string | null;
  behind_main: number | null;
  on_main_branch: boolean;
  last_fetched: string | null;
}

export type PageRelation = "same" | "page_older" | "page_newer" | "different" | "unknown";

/** `/api/settings/running` (backend/app/services/running_from.py). */
export interface RunningInfo {
  version: string;
  kind: "checkout" | "included" | "copy";
  deployment: "local" | "mac_app" | "container" | "hosted";
  app_flavor: string | null;
  path: string;
  git: RunningGit | null;
  git_error: string | null;
  started_commit: string | null;
  dist: { version?: string | null; commit?: string | null; builtAt?: string | null } | null;
  dist_relation: PageRelation | null;
  page: { commit: string; relation: PageRelation } | null;
  summary: string;
  /** Only after Check now. */
  fetched?: boolean;
  fetch_error?: string | null;
}

export type Tone = "ok" | "behind" | "muted" | "warn";

export interface Line {
  id: string;
  text: string;
  tone: Tone;
}

const MAIN = "devel";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "the version included with the Mac app", "your checkout at ~/…", "a browser session served from …". */
export function whereLine(r: RunningInfo): string {
  const path = abbreviateHome(r.path);
  if (r.kind === "included") return "The version included with the Mac app";
  if (r.deployment === "container" || r.deployment === "hosted") {
    return "A browser session served by a PsyNeuView server";
  }
  if (r.kind === "checkout") {
    return r.deployment === "mac_app" ? `Your checkout at ${path}` : `A browser session served from your checkout at ${path}`;
  }
  return r.deployment === "mac_app"
    ? `A copy at ${path} (not a git checkout)`
    : `A browser session served from ${path} (not a git checkout)`;
}

/** "2 hours ago", "3 days ago", "just now", from an ISO time. */
export function ago(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const s = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${plural(m, "minute")} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${plural(h, "hour")} ago`;
  return `${plural(Math.round(h / 24), "day")} ago`;
}

/** "9 Oct 2026", from an ISO time; null when there is none. */
export function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The sentences under "Running from" for a checkout: the branch and commit,
 * files changed, how it stands against its remote branch and devel as last
 * fetched, how to update, and whether it moved since the server started.
 */
export function checkoutLines(r: RunningInfo, now: Date = new Date()): Line[] {
  if (r.kind !== "checkout") return [];
  if (r.git_error || !r.git) {
    return [{ id: "git-error", text: `Couldn't read the checkout: ${r.git_error ?? "git gave no answer"}.`, tone: "muted" }];
  }
  const g = r.git;
  const lines: Line[] = [];
  const at = g.commit ? ` at ${g.commit}` : "";
  const date = shortDate(g.commit_date);
  const committed = date ? ` (${date})` : "";

  // Where it stands, in one sentence.
  const behindMain = g.behind_main ?? 0;
  if (!g.branch) {
    lines.push({ id: "branch", text: `Not on a branch (detached${at}${committed}).`, tone: "warn" });
  } else if (g.on_main_branch) {
    let standing: string;
    let tone: Tone;
    const remote = g.upstream ?? g.main_branch;
    const behind = g.upstream ? g.behind_by : g.behind_main;
    if (!remote) {
      standing = "not compared with a remote: there is no origin/devel here";
      tone = "muted";
    } else if (behind) {
      standing = `${plural(behind, "commit")} behind ${remote}`;
      tone = "warn";
    } else {
      standing = `up to date with ${remote}`;
      tone = "ok";
    }
    if (g.upstream && g.ahead_by) standing += `, with ${plural(g.ahead_by, "commit")} of its own`;
    lines.push({ id: "branch", text: `Your checkout is on branch ${g.branch}${at}${committed}, ${standing}.`, tone });
  } else {
    const parts = [`Your checkout is on branch ${g.branch}${at}${committed}, not ${MAIN}`];
    if (g.main_branch) {
      parts.push(behindMain ? `${plural(behindMain, "commit")} behind ${g.main_branch}` : `with everything on ${g.main_branch}`);
    }
    lines.push({ id: "branch", text: `${parts.join("; ")}.`, tone: "warn" });
    if (g.upstream && g.behind_by) {
      lines.push({ id: "behind-upstream", text: `It is also ${plural(g.behind_by, "commit")} behind ${g.upstream}, the branch it tracks.`, tone: "warn" });
    }
  }

  if (g.dirty_files) {
    lines.push({ id: "dirty", text: `${plural(g.dirty_files, "file")} changed locally, not committed.`, tone: "muted" });
  }

  const fetched = ago(g.last_fetched, now);
  const remoteKnown = !!(g.upstream || g.main_branch);
  if (remoteKnown) {
    lines.push({
      id: "fetched",
      text: fetched
        ? `As of the last fetch, ${fetched}. Check now fetches again; nothing is pulled.`
        : "Never fetched here. Check now fetches; nothing is pulled.",
      tone: "muted",
    });
  }

  const behindAny = g.on_main_branch ? !!(g.upstream ? g.behind_by : g.behind_main) : behindMain > 0;
  if (g.branch && !g.on_main_branch) {
    lines.push({
      id: "hint",
      text: `To run the latest ${MAIN}: in that folder, git switch ${MAIN} and then git pull; then restart PsyNeuView.`,
      tone: "muted",
    });
  } else if (behindAny) {
    lines.push({
      id: "hint",
      text:
        r.deployment === "mac_app"
          ? "To update: PsyNeuView ▸ Update PsyNeuView checkout… in the menu bar (shown with developer mode on), or git pull in that folder; then restart PsyNeuView."
          : "To update: git pull in that folder, then restart PsyNeuView.",
      tone: "muted",
    });
  }

  if (r.started_commit && g.commit && !sameCommit(r.started_commit, g.commit)) {
    lines.push({
      id: "moved",
      text: `The checkout has moved since PsyNeuView started (from ${r.started_commit} to ${g.commit}): restart PsyNeuView to run it.`,
      tone: "warn",
    });
  }
  return lines;
}

export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** "abc1234, built 11 Oct 2026" (with "uncommitted changes" when the tree had them). */
export function pageBuildLine(page: PageBuild | null, dev: boolean): string {
  if (dev) return "served live by the development server";
  if (!page) return "unknown";
  const parts = [page.commit ?? "no git commit"];
  if (page.dirty) parts.push("with uncommitted changes");
  const built = shortDate(page.builtAt);
  if (built) parts.push(`built ${built}`);
  return parts.join(", ");
}

export interface Mismatch {
  id: "page-older" | "page-newer" | "different" | "page-files-older";
  text: string;
  action: "reload" | "restart" | "rebuild";
}

/**
 * Whether the page and the server disagree: a page left in a cache, a server
 * left running from before a pull, or page files not rebuilt after one.
 * None from the Vite dev server, which always serves the code as it is.
 */
export function mismatch(r: RunningInfo, page: PageBuild | null, dev: boolean): Mismatch | null {
  if (dev || !page) return null;
  const relation = r.page && page.commit && sameCommit(r.page.commit, page.commit) ? r.page.relation : null;
  if (relation === "page_older") {
    // The files on disk are the page's own build: what the server knows of
    // them, or, without git to order them, whether they match the page.
    const filesOld = r.dist_relation ? r.dist_relation === "page_older" : sameCommit(r.dist?.commit, page.commit);
    if (filesOld) {
      return {
        id: "page-files-older",
        text: "The page files were built from an older version than the server runs, so reloading won't help: rebuild them (npm run build in frontend), then reload.",
        action: "rebuild",
      };
    }
    return { id: "page-older", text: "This page is older than the server; reload.", action: "reload" };
  }
  if (relation === "page_newer") {
    return {
      id: "page-newer",
      text: "This page is newer than the server: the server was started before the latest changes. Restart PsyNeuView.",
      action: "restart",
    };
  }
  if (relation === "different") {
    return { id: "different", text: "This page and the server come from different versions; reload. If this stays, restart PsyNeuView.", action: "reload" };
  }
  if (relation === "same") return null;
  // No commits to compare: the version numbers, at least.
  if (page.version && r.version && page.version !== r.version) {
    return {
      id: "different",
      text: `This page is from PsyNeuView ${page.version} and the server is ${r.version}; reload. If this stays, restart PsyNeuView.`,
      action: "reload",
    };
  }
  return null;
}

/** The facts for `window.__pnvDiagnostics` (`state.app.running`); paths are made `~` by the snapshot's scrub. */
export function runningDiagnostics(r: RunningInfo | null, page: PageBuild | null, dev: boolean, error?: string) {
  const pagePart = {
    version: page?.version ?? null,
    commit: page?.commit ?? null,
    commitDate: page?.commitDate ?? null,
    dirty: page?.dirty ?? null,
    builtAt: page?.builtAt ?? null,
    devServer: dev,
  };
  if (!r) return { error: error ?? "not fetched", page: pagePart };
  const g = r.git;
  const warn = mismatch(r, page, dev);
  return {
    summary: r.summary,
    kind: r.kind,
    deployment: r.deployment,
    appFlavor: r.app_flavor,
    path: r.path,
    version: r.version,
    branch: g?.branch ?? null,
    onMainBranch: g ? g.on_main_branch : null,
    commit: g?.commit ?? null,
    commitDate: g?.commit_date ?? null,
    dirtyFiles: g?.dirty_files ?? null,
    upstream: g?.upstream ?? null,
    aheadBy: g?.ahead_by ?? null,
    behindBy: g?.behind_by ?? null,
    mainBranch: g?.main_branch ?? null,
    behindMain: g?.behind_main ?? null,
    lastFetched: g?.last_fetched ?? null,
    gitError: r.git_error,
    startedCommit: r.started_commit,
    movedSinceStart: !!(r.started_commit && g?.commit && !sameCommit(r.started_commit, g.commit)),
    page: { ...pagePart, relation: r.page?.relation ?? null },
    pageFiles: { commit: r.dist?.commit ?? null, builtAt: r.dist?.builtAt ?? null, relation: r.dist_relation },
    mismatch: warn ? warn.id : null,
  };
}

// ─── Fetching ────────────────────────────────────────────────────────────────

function query(page: PageBuild | null): string {
  return page?.commit ? `?page_commit=${encodeURIComponent(page.commit)}` : "";
}

/** `/api/settings/running` for this page, or an Error after `timeoutMs`. */
export async function fetchRunning(page: PageBuild | null = pageBuild(), timeoutMs = 5000): Promise<RunningInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`/api/settings/running${query(page)}`, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as RunningInfo;
  } finally {
    clearTimeout(timer);
  }
}

/** Check now: the server fetches (with its own timeout) and describes again. */
export async function checkRunningNow(page: PageBuild | null = pageBuild()): Promise<RunningInfo> {
  const resp = await fetch(`/api/settings/running/check${query(page)}`, { method: "POST" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as RunningInfo;
}
