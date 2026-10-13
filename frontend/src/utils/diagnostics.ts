/**
 * Diagnostics: a snapshot of the page's state, with the activity log since
 * launch. (#1287; the Mac app's half is PsyNeuView-MacApp#208)
 *
 * One function, `window.__pnvDiagnostics`, returns both, so Report a Problem
 * in the Mac app can attach them, and Settings ▸ About can download the same
 * object in a browser. The contract is written down in
 * docs/settings-and-mac-app.md; `version` goes up when the shape changes in a
 * way an older reader could misread.
 *
 * Everything is read live from the stores when the function is called, so it
 * is always current. The server's part (`/api/settings/info`) is fetched
 * fresh with a short timeout, and when that fails the rest is still returned
 * with `{error}` in its place: diagnostics must work precisely when things
 * are going wrong.
 *
 * Scope: only PsyNeuView, PsyNeuLink, their installs, settings and the system
 * they run on. No model source or file contents, no other files, nothing
 * personally identifiable — the home folder is `~`, the GitHub sign-in's user
 * name is left out, and tokens never appear (utils/activityLog.ts has the
 * rules; the whole snapshot goes through them).
 */

import { useCatalogStore } from "@/stores/catalogStore";
import { useEditLockStore } from "@/stores/editLockStore";
import { useGraphPointerStore } from "@/stores/graphPointerStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useModelStore } from "@/stores/modelStore";
import { getCollapsedSections, getSectionOrder, getShownDevSections } from "@/stores/openMenuOrder";
import { usePaletteStore } from "@/stores/paletteStore";
import { isProtected, usePnlSourceStore } from "@/stores/pnlSourceStore";
import { useTourStore } from "@/stores/tourStore";
import { useUIStore } from "@/stores/uiStore";
import { loadOverrides } from "@/shortcuts/storage";
import type { SettingsInfo } from "@/components/common/settings/types";
import { activityEntries, record, scrub, type ActivityEntry } from "./activityLog";
import { pnlSourceName } from "./pnlSources";
import { fetchRunning, isDevServer, pageBuild, runningDiagnostics, type RunningInfo } from "./runningFrom";

export const DIAGNOSTICS_VERSION = 1;

export type ModelKind = "yours" | "library" | "example" | "reference" | "demo" | "other";

export interface ModelOrigin {
  /** The Open menu section it came from: `myModels`, `library`, `examples`, `references`, `demos`, `catalog:<id>`. */
  section: string | null;
  kind: ModelKind;
  /** The catalog's name, for a model from My Project Folder or one of your catalogs. */
  catalog: string | null;
}

export interface DiagnosticsState {
  app: {
    psyneuviewVersion: string | null;
    buildCommit: string | null;
    deployment: string | null;
    /** What is running and from where, and this page's build against the server's (#1356). */
    running: ReturnType<typeof runningDiagnostics>;
  };
  model: {
    open: boolean;
    path: string | null;
    section: string | null;
    catalog: string | null;
    kind: ModelKind | null;
    unsavedChanges: boolean;
    viewOnlyLock: boolean;
    /** Which of the model's own rules makes it read only (#1346): "lock",
     *  "protected" or "protectedPermanently" (a line in the file); null when editable. */
    editRule: string | null;
    protectedByLocation: boolean;
    protectedReason: string | null;
  };
  ui: {
    developerMode: boolean;
    openMenu: { order: string[]; shownDevSections: string[]; collapsed: string[] };
    layout: {
      visiblePanes: string[];
      activeBottomTab: string | null;
      settingsOpen: boolean;
      activeSettingsSection: string | null;
    };
    graph: {
      edgeStyle: string;
      pointer: string;
      pointerSize: string;
      direction: string;
      layoutStyle: string;
      view: "nested" | "flat" | "pytorch";
    };
    keyboardOverrides: { count: number; ids: string[] };
    walkthrough: { id: string; step: number } | null;
  };
  psyneulink: {
    source: string | null;
    kind: string | null;
    version: string | null;
    commit: string | null;
    path: string | null;
    editable: boolean | null;
    updateStatus: Record<string, unknown> | null;
  };
  server: ServerPart;
}

export type ServerPart =
  | {
      versions: { psyneuview: string | null; psyneuviewCommit: string | null; psyneulink: string | null; modeciMdf: string | null };
      deployment: unknown;
      health: unknown;
      features: unknown;
      githubAuth: { source: string; hasRepoScope: boolean } | null;
      updates: unknown;
    }
  | { error: string };

export interface DiagnosticsSnapshot {
  version: typeof DIAGNOSTICS_VERSION;
  state: DiagnosticsState;
  activity: ActivityEntry[];
}

declare global {
  interface Window {
    __pnvDiagnostics?: () => Promise<DiagnosticsSnapshot>;
  }
}

// ─── Facts that live in component state rather than a store ─────────────────

interface UiFacts {
  activeBottomTab: string | null;
  settingsOpen: boolean;
  activeSettingsSection: string | null;
}

const uiFacts: UiFacts = { activeBottomTab: null, settingsOpen: false, activeSettingsSection: null };

/** App and Settings tell the snapshot which tab and section are showing. */
export function noteUiFact(facts: Partial<UiFacts>): void {
  Object.assign(uiFacts, facts);
}

let notedOrigin: ({ path: string } & ModelOrigin) | null = null;

/**
 * The loaders that know where a model came from (a reference model, a
 * PsyNeuLink example, a demo) say so here; anything else is classified by
 * its path when the snapshot is built.
 */
export function noteModelOrigin(path: string, origin: Partial<ModelOrigin> & { kind: ModelKind }): void {
  notedOrigin = { path, section: origin.section ?? null, catalog: origin.catalog ?? null, kind: origin.kind };
}

let lastServerInfo: SettingsInfo | null = null;

/** Keep the last `/api/settings/info` answer, for `app` when a fresh fetch fails. */
export function rememberServerInfo(info: SettingsInfo): void {
  lastServerInfo = info;
}

// ─── Building the state ──────────────────────────────────────────────────────

function under(path: string, folder: string | null | undefined): boolean {
  if (!folder) return false;
  const base = folder.replace(/\/+$/, "");
  return path === base || path.startsWith(base + "/");
}

/** Where the open model came from, as best the page knows. */
export function classifyModel(filePath: string): ModelOrigin {
  if (notedOrigin && notedOrigin.path === filePath) {
    const { section, kind, catalog } = notedOrigin;
    return { section, kind, catalog };
  }
  const { projectFolder, catalogs } = useCatalogStore.getState();
  if (under(filePath, projectFolder?.path)) return { section: "myModels", kind: "yours", catalog: "My Project Folder" };
  const catalog = catalogs.find((c) => under(filePath, c.path));
  if (catalog) return { section: `catalog:${catalog.id}`, kind: "yours", catalog: catalog.name };
  if (usePnlSourceStore.getState().status?.owned) return { section: "library", kind: "library", catalog: null };
  if (useModelStore.getState().currentReference) return { section: "references", kind: "reference", catalog: null };
  return { section: null, kind: "other", catalog: null };
}

/** Which of the three views the graph shows (#775: "nested", not "flat", in the UI). */
function graphView(flat: boolean, pytorch: boolean): "nested" | "flat" | "pytorch" {
  if (pytorch) return "pytorch";
  return flat ? "flat" : "nested";
}

/** The page's state, read from the stores now. Pure apart from reading them. */
export function buildDiagnosticsState(
  info: SettingsInfo | null,
  server: ServerPart,
  running: ReturnType<typeof runningDiagnostics> = runningDiagnostics(null, pageBuild(), isDevServer()),
): DiagnosticsState {
  const model = useModelStore.getState();
  const ui = useUIStore.getState();
  const layout = useLayoutStore.getState();
  const graph = useGraphSettings.getState();
  const pointer = useGraphPointerStore.getState();
  const tour = useTourStore.getState();
  const lock = useEditLockStore.getState();
  const pnlSource = usePnlSourceStore.getState();
  const overrides = loadOverrides();
  const origin = model.filePath ? classifyModel(model.filePath) : null;
  const protectedNow = isProtected(pnlSource.status);

  const visiblePanes: string[] = [];
  if (layout.codeVisible) visiblePanes.push("code");
  if (layout.graphVisible) visiblePanes.push("graph");
  if (layout.bottomVisible) visiblePanes.push("bottom");
  if (usePaletteStore.getState().isOpen) visiblePanes.push("palette");

  const pnl = info?.psyneulink ?? null;

  return {
    app: {
      psyneuviewVersion: info?.psyneuview?.version ?? null,
      buildCommit: info?.psyneuview?.commit ?? null,
      deployment: info?.deployment?.mode ?? null,
      running,
    },
    model: {
      open: !!model.filePath,
      path: model.filePath,
      section: origin?.section ?? null,
      catalog: origin?.catalog ?? null,
      kind: origin?.kind ?? null,
      unsavedChanges: !!model.filePath && model.source !== model.savedSource,
      viewOnlyLock: lock.filePath === model.filePath && lock.mode === "viewOnly",
      editRule: lock.filePath === model.filePath ? lock.rule : null,
      protectedByLocation: protectedNow,
      protectedReason: protectedNow ? (pnlSource.status?.message ?? `PsyNeuLink from ${pnlSource.status?.kind ?? "an installed copy"}`) : null,
    },
    ui: {
      developerMode: ui.developerMode,
      openMenu: {
        order: getSectionOrder(useCatalogStore.getState().catalogs.map((c) => c.id)),
        shownDevSections: Array.from(getShownDevSections()),
        collapsed: Array.from(getCollapsedSections()),
      },
      layout: {
        visiblePanes,
        activeBottomTab: uiFacts.activeBottomTab,
        settingsOpen: uiFacts.settingsOpen,
        activeSettingsSection: uiFacts.settingsOpen ? uiFacts.activeSettingsSection : null,
      },
      graph: {
        edgeStyle: graph.edgeRouting,
        pointer: pointer.pointer,
        pointerSize: pointer.size,
        direction: graph.direction,
        layoutStyle: graph.layoutStyle,
        view: graphView(graph.flat, graph.pytorch),
      },
      keyboardOverrides: { count: Object.keys(overrides).length, ids: Object.keys(overrides) },
      walkthrough: tour.activeTourId ? { id: tour.activeTourId, step: tour.stepIndex } : null,
    },
    psyneulink: {
      source: pnlSourceName(pnl),
      kind: pnl?.source ?? null,
      version: pnl?.version ?? null,
      commit: pnl?.commit ?? null,
      path: pnl?.path ?? null,
      editable: pnl ? pnl.source === "editable" : null,
      updateStatus: (info?.updates as Record<string, unknown> | undefined) ?? null,
    },
    server,
  };
}

/** The parts of `/api/settings/info` a report needs. The GitHub user's name is left out. */
export function serverPartFrom(info: SettingsInfo): ServerPart {
  return {
    versions: {
      psyneuview: info.psyneuview?.version ?? null,
      psyneuviewCommit: info.psyneuview?.commit ?? null,
      psyneulink: info.psyneulink?.version ?? null,
      modeciMdf: info.modeci_mdf?.version ?? null,
    },
    deployment: info.deployment ?? null,
    health: info.health ?? null,
    features: info.features ?? null,
    githubAuth: info.github_auth ? { source: info.github_auth.source, hasRepoScope: !!info.github_auth.has_repo_scope } : null,
    updates: info.updates ?? null,
  };
}

/** `/api/settings/info`, fresh, or an Error after `timeoutMs`. */
export async function fetchServerInfo(timeoutMs = 3000): Promise<SettingsInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch("/api/settings/info", { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as SettingsInfo;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The whole snapshot: state and activity. Never throws for the server's part:
 * when `/api/settings/info` can't be fetched, `server` is `{error}` and `app`
 * and `psyneulink` fall back to the last answer the page saw, if any.
 */
export async function collectDiagnostics(
  opts: { fetchInfo?: () => Promise<SettingsInfo>; fetchRunning?: () => Promise<RunningInfo> } = {},
): Promise<DiagnosticsSnapshot> {
  const fetchInfo = opts.fetchInfo ?? (() => fetchServerInfo());
  // What's running (#1356), asked at the same time, with its own timeout.
  const page = pageBuild();
  const runningPart = (opts.fetchRunning ?? (() => fetchRunning(page, 3000)))().then(
    (r) => runningDiagnostics(r, page, isDevServer(page)),
    (e) => runningDiagnostics(null, page, isDevServer(page), errorText(e)),
  );
  let info: SettingsInfo | null = lastServerInfo;
  let server: ServerPart;
  try {
    info = await fetchInfo();
    lastServerInfo = info;
    server = serverPartFrom(info);
  } catch (e) {
    server = { error: errorText(e) };
  }
  const snapshot: DiagnosticsSnapshot = {
    version: DIAGNOSTICS_VERSION,
    state: buildDiagnosticsState(info, server, await runningPart),
    activity: activityEntries(),
  };
  // The one place the scope rules are applied to the snapshot as a whole:
  // every path as ~, every sensitive key redacted, whoever put it there.
  return scrub(snapshot) as DiagnosticsSnapshot;
}

function errorText(e: unknown): string {
  return e instanceof Error ? (e.name === "AbortError" ? "timed out" : e.message) : String(e);
}

// ─── The download, for a browser ─────────────────────────────────────────────

/** `psyneuview-diagnostics-2026-10-09T14-03-22.json` (UTC, so it sorts). */
export function diagnosticsFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
  return `psyneuview-diagnostics-${stamp}.json`;
}

/** Save the snapshot as a JSON file through the browser's download. */
export async function downloadDiagnostics(): Promise<void> {
  const snapshot = await collectDiagnostics();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = diagnosticsFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // After the click has been handled; revoking at once can cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Installing ──────────────────────────────────────────────────────────────

/**
 * Publish `window.__pnvDiagnostics` and record what the stores already know
 * how to tell us (walkthrough starts, steps and ends). Returns the uninstall.
 */
export function installDiagnostics(): () => void {
  window.__pnvDiagnostics = () => collectDiagnostics();

  const unsubscribeTour = useTourStore.subscribe((s, prev) => {
    if (s.activeTourId !== prev.activeTourId || s.startCount !== prev.startCount) {
      if (prev.activeTourId && s.activeTourId !== prev.activeTourId) {
        record("walkthrough", `Walkthrough ended: ${prev.activeTourId}`, { id: prev.activeTourId, step: prev.stepIndex });
      }
      if (s.activeTourId) record("walkthrough", `Walkthrough started: ${s.activeTourId}`, { id: s.activeTourId });
      return;
    }
    if (s.activeTourId && s.stepIndex !== prev.stepIndex) {
      record("walkthrough", `Walkthrough ${s.activeTourId}: step ${s.stepIndex + 1}`, { id: s.activeTourId, step: s.stepIndex });
    }
  });

  return () => {
    unsubscribeTour();
    if (window.__pnvDiagnostics) delete window.__pnvDiagnostics;
  };
}
