/**
 * The diagnostics snapshot (#1287): its shape, what it reads from the stores,
 * and that a server that can't be reached leaves `{error}` in its place
 * rather than failing the whole call.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useCatalogStore } from "@/stores/catalogStore";
import { useEditLockStore } from "@/stores/editLockStore";
import { useModelStore } from "@/stores/modelStore";
import { usePnlSourceStore } from "@/stores/pnlSourceStore";
import { useTourStore } from "@/stores/tourStore";
import type { SettingsInfo } from "@/components/common/settings/types";
import type { RunningInfo } from "./runningFrom";
import { clearActivity, record } from "./activityLog";
import { pageAgainstServer,
  DIAGNOSTICS_VERSION,
  classifyModel,
  collectDiagnostics,
  diagnosticsFilename,
  noteModelOrigin,
  rememberServerInfo,
} from "./diagnostics";

const INFO: SettingsInfo = {
  psyneuview: { version: "0.5.13", commit: "abc1234" },
  psyneulink: {
    version: "0.19.1.0",
    source: "editable",
    branch: "devel",
    repo: "PrincetonUniversity/PsyNeuLink",
    commit: "72dde34",
    path: "/Users/someone/code/PsyNeuLink",
  },
  modeci_mdf: { version: "0.4.11" },
  github_auth: { source: "gh_cli", user: "a-real-person", scopes: ["repo"], has_repo_scope: true },
  features: { debugger_hook: true, level: "full" },
  deployment: { mode: "local" },
  health: { ok: true },
  updates: { status: "current", last_check_at: 1760000000 },
};

const MODEL = {
  compositions: [{ varName: "c", name: "c", nodes: [{ varName: "a", name: "a", type: "TransferMechanism" }], projections: [] }],
  lineMap: {},
};

beforeEach(() => {
  clearActivity();
  useModelStore.setState({ filePath: null, source: "", savedSource: "", currentReference: null });
  useCatalogStore.setState({ projectFolder: null, catalogs: [] });
  useEditLockStore.setState({ filePath: null, mode: null });
  usePnlSourceStore.setState({ filePath: null, status: null });
  useTourStore.getState().stopTour();
});

describe("collectDiagnostics", () => {
  it("has the contract's shape, with no model open and nothing recorded", async () => {
    const snap = await collectDiagnostics({ fetchInfo: async () => INFO });
    expect(snap.version).toBe(DIAGNOSTICS_VERSION);
    expect(Object.keys(snap.state)).toEqual(["app", "model", "ui", "psyneulink", "server"]);
    expect(snap.state.app).toEqual({
      psyneuviewVersion: "0.5.13",
      buildCommit: "abc1234",
      // The page's own build (#2); unit tests have none, so it can't be compared.
      pageVersion: null,
      pageCommit: null,
      pageMatchesServer: null,
      versionWarning: null,
      deployment: "local",
      running: expect.objectContaining({ page: expect.any(Object) }),
    });
    expect(snap.state.model).toEqual({
      open: false,
      path: null,
      section: null,
      catalog: null,
      kind: null,
      unsavedChanges: false,
      viewOnlyLock: false,
      editRule: null,
      protectedByLocation: false,
      protectedReason: null,
    });
    expect(snap.state.ui.developerMode).toBe(false);
    expect(snap.state.ui.openMenu).toEqual({ order: expect.any(Array), shownDevSections: [], collapsed: [] });
    expect(snap.state.ui.layout.visiblePanes).toEqual(expect.arrayContaining(["graph"]));
    expect(snap.state.ui.graph).toEqual(
      expect.objectContaining({ edgeStyle: expect.any(String), pointer: "arrow", pointerSize: expect.any(String), view: "nested" }),
    );
    expect(snap.state.ui.keyboardOverrides).toEqual({ count: 0, ids: [] });
    expect(snap.state.ui.walkthrough).toBeNull();
    expect(snap.activity).toEqual([]);
  });

  it("reads the model, the lock, the walkthrough and the activity from the stores", async () => {
    useModelStore.getState().setFilePath("/Users/someone/Documents/PsyNeuView-My-Models/stroop.py");
    useModelStore.getState().setSource("edited");
    useModelStore.getState().loadModelFromServer(MODEL);
    useModelStore.getState().setSource("edited again");
    useCatalogStore.setState({ projectFolder: { path: "/Users/someone/Documents/PsyNeuView-My-Models", exists: true, fixed: false } });
    useEditLockStore.setState({ filePath: "/Users/someone/Documents/PsyNeuView-My-Models/stroop.py", mode: "viewOnly", rule: "lock" });
    useTourStore.getState().startTour("orientation-window");
    useTourStore.getState().advance();
    record("run", "Run finished", { outcome: "ok", durationMs: 12 });

    const snap = await collectDiagnostics({ fetchInfo: async () => INFO });
    expect(snap.state.model).toEqual({
      open: true,
      path: "~/Documents/PsyNeuView-My-Models/stroop.py",
      section: "myModels",
      catalog: "My Project Folder",
      kind: "yours",
      unsavedChanges: true,
      viewOnlyLock: true,
      editRule: "lock",
      protectedByLocation: false,
      protectedReason: null,
    });
    expect(snap.state.ui.walkthrough).toEqual({ id: "orientation-window", step: 1 });
    // setFilePath recorded the open, with the home folder as ~; then the run.
    expect(snap.activity.map((e) => e.kind)).toEqual(["model", "run"]);
    expect(snap.activity[0]).toEqual(
      expect.objectContaining({ text: "Opened ~/Documents/PsyNeuView-My-Models/stroop.py", data: { path: "~/Documents/PsyNeuView-My-Models/stroop.py" } }),
    );
    expect(snap.activity[1]).toEqual(expect.objectContaining({ kind: "run", data: { outcome: "ok", durationMs: 12 } }));
  });

  it("carries the PsyNeuLink and server parts, with paths as ~ and no user name", async () => {
    const snap = await collectDiagnostics({ fetchInfo: async () => INFO });
    expect(snap.state.psyneulink).toEqual({
      source: "your checkout at ~/code/PsyNeuLink",
      kind: "editable",
      version: "0.19.1.0",
      commit: "72dde34",
      path: "~/code/PsyNeuLink",
      editable: true,
      updateStatus: { status: "current", last_check_at: 1760000000 },
    });
    expect(snap.state.server).toEqual({
      versions: { psyneuview: "0.5.13", psyneuviewCommit: "abc1234", psyneulink: "0.19.1.0", modeciMdf: "0.4.11" },
      deployment: { mode: "local" },
      health: { ok: true },
      features: { debugger_hook: true, level: "full" },
      githubAuth: { source: "gh_cli", hasRepoScope: true },
      updates: { status: "current", last_check_at: 1760000000 },
    });
    expect(JSON.stringify(snap)).not.toContain("a-real-person");
    expect(JSON.stringify(snap)).not.toContain("/Users/");
  });

  it("tolerates a server that can't be reached: {error}, and the last known versions", async () => {
    rememberServerInfo(INFO);
    const snap = await collectDiagnostics({
      fetchInfo: async () => {
        throw new Error("HTTP 503");
      },
    });
    expect(snap.state.server).toEqual({ error: "HTTP 503" });
    expect(snap.state.app.psyneuviewVersion).toBe("0.5.13");
    expect(snap.state.psyneulink.version).toBe("0.19.1.0");
    expect(snap.version).toBe(DIAGNOSTICS_VERSION);
  });

  it("names a timeout as such", async () => {
    const snap = await collectDiagnostics({
      fetchInfo: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });
    expect(snap.state.server).toEqual({ error: "timed out" });
  });
});

describe("what is running (#1356)", () => {
  const RUNNING: RunningInfo = {
    version: "0.5.13",
    kind: "checkout",
    deployment: "mac_app",
    app_flavor: "release",
    path: "/Users/someone/Documents/PsyNeuView",
    git: {
      branch: "feature/x",
      commit: "abc1234",
      commit_date: "2026-10-09T12:55:00+00:00",
      dirty_files: 2,
      upstream: null,
      ahead_by: null,
      behind_by: null,
      main_branch: "origin/devel",
      behind_main: 7,
      on_main_branch: false,
      last_fetched: "2026-10-11T10:00:00+00:00",
    },
    git_error: null,
    started_commit: "abc1234",
    dist: null,
    dist_relation: null,
    page: null,
    summary: "PsyNeuView 0.5.13 running from your checkout at ~/Documents/PsyNeuView (feature/x, abc1234, 2 files changed)",
  };

  it("carries where it runs from, the branch and how far behind devel, with the path as ~", async () => {
    const snap = await collectDiagnostics({ fetchInfo: async () => INFO, fetchRunning: async () => RUNNING });
    expect(snap.state.app.running).toMatchObject({
      kind: "checkout",
      deployment: "mac_app",
      path: "~/Documents/PsyNeuView",
      branch: "feature/x",
      onMainBranch: false,
      commit: "abc1234",
      dirtyFiles: 2,
      behindMain: 7,
      lastFetched: "2026-10-11T10:00:00+00:00",
      movedSinceStart: false,
      mismatch: null,
    });
    expect(JSON.stringify(snap.state.app.running)).not.toContain("/Users/");
  });

  it("says why when the server couldn't be asked", async () => {
    const snap = await collectDiagnostics({
      fetchInfo: async () => INFO,
      fetchRunning: async () => {
        throw new Error("HTTP 500");
      },
    });
    expect(snap.state.app.running).toMatchObject({ error: "HTTP 500" });
  });
});

describe("classifyModel", () => {
  it("prefers what a loader noted, then the project folder, a catalog, PsyNeuLink's files, a reference", () => {
    noteModelOrigin("/tmp/working/stroop.py", { kind: "demo", section: "demos" });
    expect(classifyModel("/tmp/working/stroop.py")).toEqual({ section: "demos", kind: "demo", catalog: null });

    useCatalogStore.setState({
      projectFolder: { path: "/Users/someone/Documents/PsyNeuView-My-Models/", exists: true, fixed: false },
      catalogs: [{ id: "c1", name: "Lab scripts", path: "/Users/someone/lab", exists: true, models: [] }],
    });
    expect(classifyModel("/Users/someone/Documents/PsyNeuView-My-Models/a.py").kind).toBe("yours");
    expect(classifyModel("/Users/someone/lab/b.py")).toEqual({ section: "catalog:c1", kind: "yours", catalog: "Lab scripts" });

    usePnlSourceStore.setState({ status: { owned: true, kind: "github", editable: false } });
    expect(classifyModel("/x/psyneulink/library/models/c.py")).toEqual({ section: "library", kind: "library", catalog: null });

    usePnlSourceStore.setState({ status: null });
    useModelStore.setState({ currentReference: "stroop" });
    expect(classifyModel("/x/working/stroop.py").kind).toBe("reference");

    useModelStore.setState({ currentReference: null });
    expect(classifyModel("/x/elsewhere/d.py")).toEqual({ section: null, kind: "other", catalog: null });
  });
});

describe("diagnosticsFilename", () => {
  it("is psyneuview-diagnostics-<UTC time>.json, safe on every file system", () => {
    expect(diagnosticsFilename(new Date("2026-10-09T14:03:22.123Z"))).toBe("psyneuview-diagnostics-2026-10-09T14-03-22.json");
  });
});

describe("pageAgainstServer (#2)", () => {
  const page = (version: string | null, commit: string | null) =>
    ({ version, commit, commitDate: null, dirty: null, builtAt: "2026-10-13T00:00:00Z" }) as const;

  it("flags a cached older page against a newer server", () => {
    const r = pageAgainstServer("0.5.16", "unknown", page("0.5.14", null), false);
    expect(r.pageMatchesServer).toBe(false);
    expect(r.pageVersion).toBe("0.5.14");
    expect(r.versionWarning).toContain("0.5.14");
    expect(r.versionWarning).toContain("0.5.16");
    expect(r.versionWarning).toContain("stored copy");
  });

  it("compares commits when both are known", () => {
    expect(pageAgainstServer("0.6.0", "abc1234def", page("0.6.0", "abc1234"), false).pageMatchesServer).toBe(true);
    expect(pageAgainstServer("0.6.0", "abc1234", page("0.6.0", "fff9999"), false).pageMatchesServer).toBe(false);
  });

  it("agrees when the versions match and no commits are known", () => {
    const r = pageAgainstServer("0.6.0", null, page("0.6.0", null), false);
    expect(r.pageMatchesServer).toBe(true);
    expect(r.versionWarning).toBeNull();
  });

  it("can't tell without a page build, and never flags the dev server", () => {
    expect(pageAgainstServer("0.6.0", null, null, false).pageMatchesServer).toBeNull();
    expect(pageAgainstServer("0.6.0", null, page("0.5.0", null), true).versionWarning).toBeNull();
  });
});
