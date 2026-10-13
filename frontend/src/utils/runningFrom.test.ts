/** What Settings ▸ About says about what's running (#1356). */
import { describe, expect, it } from "vitest";
import {
  ago,
  checkoutLines,
  mismatch,
  pageBuildLine,
  runningDiagnostics,
  whereLine,
  type PageBuild,
  type RunningGit,
  type RunningInfo,
} from "./runningFrom";

const NOW = new Date("2026-10-11T12:00:00Z");

function git(over: Partial<RunningGit> = {}): RunningGit {
  return {
    branch: "devel",
    commit: "abc1234",
    commit_date: "2026-10-09T12:55:00+00:00",
    dirty_files: 0,
    upstream: "origin/devel",
    ahead_by: 0,
    behind_by: 0,
    main_branch: "origin/devel",
    behind_main: 0,
    on_main_branch: true,
    last_fetched: "2026-10-11T10:00:00+00:00",
    ...over,
  };
}

function running(over: Partial<RunningInfo> = {}): RunningInfo {
  return {
    version: "0.5.15",
    kind: "checkout",
    deployment: "mac_app",
    app_flavor: "release",
    path: "/Users/someone/Documents/PsyNeuView",
    git: git(),
    git_error: null,
    started_commit: "abc1234",
    dist: { commit: "abc1234" },
    dist_relation: "same",
    page: { commit: "abc1234", relation: "same" },
    summary: "PsyNeuView 0.5.15 running from your checkout at ~/Documents/PsyNeuView (devel, abc1234)",
    ...over,
  };
}

const PAGE: PageBuild = { version: "0.5.15", commit: "abc1234", commitDate: null, dirty: false, builtAt: "2026-10-11T09:00:00Z" };

const text = (r: RunningInfo) => checkoutLines(r, NOW).map((l) => l.text);

describe("where it runs from", () => {
  it("the Mac app's included copy", () => {
    expect(whereLine(running({ kind: "included", git: null, path: "/Users/someone/Library/Application Support/PsyNeuView/psyneuview-0.5.15" }))).toBe(
      "The version included with the Mac app",
    );
  });
  it("a checkout in the Mac app, home as ~", () => {
    expect(whereLine(running())).toBe("Your checkout at ~/Documents/PsyNeuView");
  });
  it("a browser session served from a checkout", () => {
    expect(whereLine(running({ deployment: "local" }))).toBe("A browser session served from your checkout at ~/Documents/PsyNeuView");
  });
  it("a browser session from a copy without git, and from a server", () => {
    expect(whereLine(running({ deployment: "local", kind: "copy", git: null, path: "/srv/pnv" }))).toBe(
      "A browser session served from /srv/pnv (not a git checkout)",
    );
    expect(whereLine(running({ deployment: "hosted", kind: "copy", git: null }))).toBe("A browser session served by a PsyNeuView server");
  });
});

describe("a checkout's lines", () => {
  it("up to date on devel", () => {
    const lines = checkoutLines(running(), NOW);
    expect(lines[0]).toEqual({ id: "branch", tone: "ok", text: "Your checkout is on branch devel at abc1234 (9 Oct 2026), up to date with origin/devel." });
    expect(lines.map((l) => l.id)).toEqual(["branch", "fetched"]);
    expect(lines[1].text).toBe("As of the last fetch, 2 hours ago. Check now fetches again; nothing is pulled.");
  });

  it("behind devel, with how to update in the Mac app", () => {
    const t = text(running({ git: git({ behind_by: 12, behind_main: 12 }) }));
    expect(t[0]).toBe("Your checkout is on branch devel at abc1234 (9 Oct 2026), 12 commits behind origin/devel.");
    expect(t).toContain(
      "To update: PsyNeuView ▸ Update PsyNeuView checkout… in the menu bar (shown with developer mode on), or git pull in that folder; then restart PsyNeuView.",
    );
  });

  it("behind devel in a browser: git pull", () => {
    expect(text(running({ deployment: "local", git: git({ behind_by: 1, behind_main: 1 }) }))).toContain(
      "To update: git pull in that folder, then restart PsyNeuView.",
    );
  });

  it("another branch says so, and how far behind devel it is", () => {
    const lines = checkoutLines(
      running({ git: git({ branch: "feature/x", on_main_branch: false, upstream: "origin/feature/x", behind_by: 2, behind_main: 5 }) }),
      NOW,
    );
    expect(lines[0]).toEqual({
      id: "branch",
      tone: "warn",
      text: "Your checkout is on branch feature/x at abc1234 (9 Oct 2026), not devel; 5 commits behind origin/devel.",
    });
    expect(lines.map((l) => l.text)).toContain("It is also 2 commits behind origin/feature/x, the branch it tracks.");
    expect(lines.find((l) => l.id === "hint")?.text).toBe(
      "To run the latest devel: in that folder, git switch devel and then git pull; then restart PsyNeuView.",
    );
  });

  it("files changed, detached, never fetched", () => {
    const t = text(running({ git: git({ branch: null, on_main_branch: false, upstream: null, dirty_files: 1, last_fetched: null }) }));
    expect(t[0]).toBe("Not on a branch (detached at abc1234 (9 Oct 2026)).");
    expect(t).toContain("1 file changed locally, not committed.");
    expect(t).toContain("Never fetched here. Check now fetches; nothing is pulled.");
  });

  it("moved since the server started", () => {
    expect(text(running({ started_commit: "1111111" }))).toContain(
      "The checkout has moved since PsyNeuView started (from 1111111 to abc1234): restart PsyNeuView to run it.",
    );
  });

  it("no git", () => {
    expect(text(running({ git: null, git_error: "git couldn't run here (No such file)" }))).toEqual([
      "Couldn't read the checkout: git couldn't run here (No such file).",
    ]);
  });

  it("nothing for the included copy", () => {
    expect(checkoutLines(running({ kind: "included", git: null }), NOW)).toEqual([]);
  });
});

describe("the page and the server", () => {
  it("agree: no warning", () => {
    expect(mismatch(running(), PAGE, false)).toBeNull();
  });
  it("page older than the server: reload", () => {
    const r = running({ page: { commit: "abc1234", relation: "page_older" }, dist: { commit: "def5678" }, dist_relation: "same" });
    expect(mismatch(r, PAGE, false)).toEqual({ id: "page-older", text: "This page is older than the server; reload.", action: "reload" });
  });
  it("page files on disk older than the server: rebuild, a reload won't help", () => {
    const r = running({ page: { commit: "abc1234", relation: "page_older" }, dist: { commit: "abc1234" }, dist_relation: "page_older" });
    expect(mismatch(r, PAGE, false)?.id).toBe("page-files-older");
  });
  it("page newer: restart the server", () => {
    expect(mismatch(running({ page: { commit: "abc1234", relation: "page_newer" } }), PAGE, false)?.action).toBe("restart");
  });
  it("no commits to compare: the version numbers", () => {
    const r = running({ kind: "included", git: null, version: "0.5.16", page: { commit: "abc1234", relation: "unknown" } });
    expect(mismatch(r, PAGE, false)?.text).toBe("This page is from PsyNeuView 0.5.15 and the server is 0.5.16; reload. If this stays, restart PsyNeuView.");
  });
  it("never from the dev server", () => {
    expect(mismatch(running({ page: { commit: "abc1234", relation: "page_older" } }), PAGE, true)).toBeNull();
  });
  it("the page's own build line", () => {
    expect(pageBuildLine(PAGE, false)).toBe("abc1234, built 11 Oct 2026");
    expect(pageBuildLine({ ...PAGE, dirty: true }, false)).toBe("abc1234, with uncommitted changes, built 11 Oct 2026");
    expect(pageBuildLine(PAGE, true)).toBe("served live by the development server");
  });
});

describe("ago", () => {
  it("reads naturally", () => {
    expect(ago("2026-10-11T11:59:30Z", NOW)).toBe("just now");
    expect(ago("2026-10-11T11:59:00Z", NOW)).toBe("1 minute ago");
    expect(ago("2026-10-09T12:00:00Z", NOW)).toBe("2 days ago");
    expect(ago(null, NOW)).toBeNull();
  });
});

describe("diagnostics", () => {
  it("carries every fact, and the warning by id", () => {
    const d = runningDiagnostics(running({ git: git({ behind_by: 3, behind_main: 3 }), page: { commit: "abc1234", relation: "page_older" } }), PAGE, false);
    expect(d).toMatchObject({
      kind: "checkout",
      deployment: "mac_app",
      appFlavor: "release",
      path: "/Users/someone/Documents/PsyNeuView",
      branch: "devel",
      commit: "abc1234",
      behindBy: 3,
      behindMain: 3,
      movedSinceStart: false,
      page: { commit: "abc1234", relation: "page_older", devServer: false },
      mismatch: "page-older",
    });
  });
  it("says why when the server couldn't be asked", () => {
    expect(runningDiagnostics(null, PAGE, false, "timed out")).toMatchObject({ error: "timed out", page: { commit: "abc1234" } });
  });
});
