/**
 * Zustand store — single source of truth for the frontend.
 * Holds the model graph, source code, selected node, and connection state.
 */

import { create } from "zustand";
import { MarkerType, type Node, type Edge } from "@xyflow/react";
import { applyLayout } from "@/utils/layout";
import { useHistoryStore } from "./historyStore";
import { recordAction } from "@/utils/history";
import { usePortLayout } from "@/stores/portLayoutStore";
import { useValueViews } from "@/stores/valueViewStore";
import { useGraphSettings } from "./graphSettingsStore";
import { useExternalChangeStore } from "./externalChangeStore";
import type { GSCInfo, BasicConditionEntry, ConditionInfo, SchedulerConfig, DanglingProjectionInfo, BrokenProjectionInfo, CompositionExecutionModeInfo, InputSet, LearningProfile } from "@/types/model";
import { buildStepNodeValues, type StepNodeValues } from "@/utils/traceValues";
import { deriveTrialBoundaries } from "@/utils/trialBoundaries";
import { newlyBrokenStatement, type SkippedStatement } from "@/utils/previewBreak";
import { gscEdgeId } from "@/utils/gscEdgeId";
import type { ModelLabels } from "@/utils/labels";
import {
  listSidecars,
  resolveSidecars,
  setActiveVariant as apiSetActiveVariant,
  setPlacement as apiSetPlacement,
  type MigrationResult,
  type PlacementLocation,
  type SidecarKind,
  type SidecarView,
} from "@/utils/sidecarApi";
import { useEdgeAttach } from "./edgeAttachStore";
import { hydrateRoutes, type EdgeRouteMap, type RoutableEdge } from "@/utils/edgeRoutes";
import { record } from "@/utils/activityLog";
import { paletteColor } from "@/utils/paletteColor";

// #407: shape of an entry in the model's sidecar bundle list. Kind is a
// well-known identifier the backend understands for /api/model/sidecar
// lookups (currently "source" | "labels" | "layout"). #631: a model can
// carry several variants of a kind, so sidecar entries also carry the
// variant name the backend resolves to a specific file.
export type BundleEntry = { kind: string; name: string; variant?: string };

// Edge styling by projection type (matches show_graph conventions). Each
// type's colour is a palette token, --pnv-projection-* (#1302).
const PROJECTION_TOKENS: Record<string, `--pnv-${string}`> = {
  MappingProjection: "--pnv-projection-mapping",
  ControlProjection: "--pnv-projection-control",
  LearningProjection: "--pnv-projection-learning",
  AutoAssociativeProjection: "--pnv-projection-autoassociative",
  InactiveProjection: "--pnv-projection-inactive",
  CIMProjection: "--pnv-projection-cim",
  DanglingProjection: "--pnv-projection-dangling",
};

const EDGE_STYLES: Record<string, React.CSSProperties> = {
  MappingProjection: { stroke: "var(--pnv-projection-mapping)", strokeWidth: 2 },
  ControlProjection: { stroke: "var(--pnv-projection-control)", strokeWidth: 2, strokeDasharray: "6 3" },
  LearningProjection: { stroke: "var(--pnv-projection-learning)", strokeWidth: 2 },
  AutoAssociativeProjection: { stroke: "var(--pnv-projection-autoassociative)", strokeWidth: 2 },
  InactiveProjection: { stroke: "var(--pnv-projection-inactive)", strokeWidth: 1.5, strokeDasharray: "4 4" },
  CIMProjection: { stroke: "var(--pnv-projection-cim)", strokeWidth: 1.5, strokeDasharray: "3 3" },
  DanglingProjection: { stroke: "var(--pnv-projection-dangling)", strokeWidth: 2.5, strokeDasharray: "8 4" },
};

/** Arrowhead size by projection type; the colour comes from the type's token. */
const EDGE_MARKER_SIZES: Record<string, number> = {
  MappingProjection: 16,
  ControlProjection: 16,
  LearningProjection: 16,
  AutoAssociativeProjection: 16,
  InactiveProjection: 14,
  CIMProjection: 12,
  DanglingProjection: 18,
};

const edgeMarkers = new Map<string, any>();

function getEdgeStyle(projType: string): React.CSSProperties {
  return EDGE_STYLES[projType] || EDGE_STYLES.MappingProjection;
}

/**
 * The arrowhead for a projection type. React Flow names each arrowhead's
 * <marker> after its colour string, and a `var()` in an element id and its
 * url(#…) reference is asking for trouble, so the marker gets the token's
 * resolved value (paletteColor) — the same string the hex used to be, so the
 * same marker ids. Resolved on first use, once the stylesheet is loaded.
 */
function getEdgeMarker(projType: string): any {
  const type = projType in PROJECTION_TOKENS ? projType : "MappingProjection";
  let marker = edgeMarkers.get(type);
  if (!marker) {
    const token = PROJECTION_TOKENS[type];
    const resolved = paletteColor(token);
    const size = EDGE_MARKER_SIZES[type];
    marker = { type: MarkerType.ArrowClosed, color: resolved ?? `var(${token})`, width: size, height: size };
    if (resolved) edgeMarkers.set(type, marker);
  }
  return marker;
}

// A composition's external I/O surface lives on its CompositionInterface-
// Mechanisms: the input_CIM's input ports are the composition's inputs, the
// output_CIM's output ports are its outputs. Top-level projections attach to
// these CIM ports (e.g. `EM[INPUT_CIM_STATE [VALUE]_InputPort-0]`), so the
// rendered composition node must expose handles with those exact ids or React
// Flow silently drops the edges and the composition looks disconnected (#644).
function compositionInterfacePorts(nodeData: any): {
  inputPorts: any[];
  outputPorts: any[];
} {
  const cimNodes: any[] = nodeData?.cim?.nodes || [];
  const find = (kind: "input" | "output") =>
    cimNodes.find((c) => String(c?.cimType || "").toLowerCase().startsWith(kind));
  return {
    inputPorts: find("input")?.inputPorts || [],
    outputPorts: find("output")?.outputPorts || [],
  };
}

// Annotate each edge with how many edges share its source port, its target
// port, and — most importantly — its exact source+target pair. The custom
// edge component fans only TRUE duplicate projections (same pair) into bowed
// curves: those overlap along their whole length, so straight lines would
// collapse onto each other. Edges that merely share one endpoint (fan-in /
// fan-out from different nodes) stay straight — they already render as
// distinct tree branches that only meet at the shared port pixel.
function annotateEdgeBundles(edges: Edge[]) {
  const key = (n: string, h: string | null | undefined) => `${n}|${h ?? ""}`;
  const targetBuckets = new Map<string, string[]>();
  const sourceBuckets = new Map<string, string[]>();
  const pairBuckets = new Map<string, string[]>();
  for (const e of edges) {
    const tk = key(e.target, e.targetHandle);
    const sk = key(e.source, e.sourceHandle);
    const pk = `${sk}->${tk}`;
    if (!targetBuckets.has(tk)) targetBuckets.set(tk, []);
    if (!sourceBuckets.has(sk)) sourceBuckets.set(sk, []);
    if (!pairBuckets.has(pk)) pairBuckets.set(pk, []);
    targetBuckets.get(tk)!.push(e.id);
    sourceBuckets.get(sk)!.push(e.id);
    pairBuckets.get(pk)!.push(e.id);
  }
  for (const e of edges) {
    const tk = key(e.target, e.targetHandle);
    const sk = key(e.source, e.sourceHandle);
    const tBucket = targetBuckets.get(tk)!;
    const sBucket = sourceBuckets.get(sk)!;
    const pBucket = pairBuckets.get(`${sk}->${tk}`)!;
    const data = (e.data || {}) as Record<string, unknown>;
    data.targetBundleIndex = tBucket.indexOf(e.id);
    data.targetBundleSize = tBucket.length;
    data.sourceBundleIndex = sBucket.indexOf(e.id);
    data.sourceBundleSize = sBucket.length;
    data.pairBundleIndex = pBucket.indexOf(e.id);
    data.pairBundleSize = pBucket.length;
    e.data = data;
  }
}

const GROUP_PADDING = { top: 50, bottom: 30, left: 20, right: 20 };
const NODE_WIDTH = 170;
const NODE_HEIGHT = 80;

/**
 * Auto-size composition group nodes to fit their children.
 * Mutates the nodes array in place.
 */
export function autoSizeGroups(nodes: Node[]) {
  // Find all group nodes (compositionNode type)
  const groups = nodes.filter((n) => n.type === "compositionNode");

  for (const group of groups) {
    const children = nodes.filter((n) => n.parentId === group.id);
    if (children.length === 0) continue;

    // Compute bounding box of children (positions are relative to parent)
    let maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      const x = child.position.x;
      const y = child.position.y;
      const w = (child.style?.width as number) || NODE_WIDTH;
      const h = (child.style?.height as number) || NODE_HEIGHT;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }

    // Expand group to fit children + padding (never shrink below minimums)
    group.style = {
      ...group.style,
      width: Math.max(250, maxX + GROUP_PADDING.right),
      height: Math.max(150, maxY + GROUP_PADDING.bottom),
    };
  }
}

// #697/#713: in the flat / PyTorch view, reconstruct each origin composition as
// an INSET frame (#427) that *contains* its hoisted members — so the box
// accurately bounds the composition (members laid out together by
// layoutInsetInternals) and members are drag-constrained to it (extent:
// 'parent'). Only the flat / PyTorch views tag nodes with a compPath, so in the
// nested view this is a no-op. Returns nodes with frames added + members
// reparented. Frames are typed `compositionNode` with `inset: true` so the
// existing INSET layout machinery handles containment and sizing.
function reframeClusters(nodes: Node[]): Node[] {
  const cleanSeg = (s: string) => s.replace(/-\d+$/, "");
  const hasMembers = nodes.some(
    (n) =>
      n.type === "mechanismNode" &&
      ((n.data as { compPath?: string[] } | undefined)?.compPath?.length ?? 0) > 0,
  );
  if (!hasMembers) return nodes;

  const frameById = new Map<string, Node>();
  const ensureFrame = (path: string[]): string => {
    const id = `cluster::${path.join("␟")}`;
    if (frameById.has(id)) return id;
    const parentPath = path.slice(0, -1);
    const parentId = parentPath.length ? ensureFrame(parentPath) : undefined;
    frameById.set(id, {
      id,
      type: "compositionNode",
      position: { x: 0, y: 0 },
      data: { label: cleanSeg(path[path.length - 1]), inset: true, varName: id, childCount: 0 },
      style: { width: 280, height: 200, zIndex: 0 },
      selectable: false,
      draggable: false,
      ...(parentId ? { parentId, extent: "parent" as const } : {}),
    });
    return id;
  };

  const reparented = nodes.map((n) => {
    if (n.type !== "mechanismNode") return n;
    const path = (n.data as { compPath?: string[] } | undefined)?.compPath;
    if (!path || path.length === 0) return n;
    const frameId = ensureFrame(path);
    return { ...n, parentId: frameId, extent: "parent" as const };
  });

  // Frames first so React Flow mounts a parent before its children.
  return [...frameById.values(), ...reparented];
}

export interface ParamMeta {
  value: unknown;
  default: unknown;
  isDefault: boolean;
  editable: boolean;
  source: string; // e.g. "Logistic", "TransferMechanism", or "inherited"
}

// One snapshot emitted by PsyNeuLink's `_debugger` hook during a run.
// The shape varies by `category` — the rest of the keys are treated as
// opaque metadata so consumers can render new categories without a
// schema change here. See backend `_build_snapshot` for the producer side.
export interface DebuggerSnapshot {
  category: string;
  trial_num?: number | null;
  node?: string | null;
  execution_set?: string[];
  output?: unknown;
  outputs?: unknown;
  [key: string]: unknown;
}

export interface MechanismData {
  label: string;
  varName: string;
  type: string;
  roles: string[];
  // #11 / PsyNeuLink#12: ``element_names`` carries the model-intrinsic
  // per-element labels straight from the port object when set. Backend
  // omits the key entirely when the port doesn't carry labels, so a
  // missing ``element_names`` here is meaningful — the resolver
  // falls through to the sidecar.
  inputPorts: { name: string; shape: number[]; element_names?: string[] | null }[];
  outputPorts: { name: string; shape: number[]; element_names?: string[] | null }[];
  parameterPorts: { name: string; shape: number[] }[];
  params: Record<string, ParamMeta | unknown>;
  function?: { type: string; params: Record<string, ParamMeta | unknown>; validTypes?: string[] } | null;
  line?: number;
  isController?: boolean;
  isObjectiveMechanism?: boolean;
  // #659/#660: in flat view, the path of nested composition(s) this node was
  // hoisted out of (outermost-first). Empty/absent for top-level nodes.
  compPath?: string[];
  // #230: PyTorch view only — the node runs but is excluded from the gradient
  // calculation (e.g. an EM STORE node).
  excludeFromGradientCalc?: boolean;
}

interface ModelState {
  // File
  filePath: string | null;
  source: string;
  // The source as last known on disk (set when a model is loaded or saved).
  // `source !== savedSource` means the in-memory buffer has unsaved edits.
  savedSource: string;
  // Where unsaved edits are executed from (#1029). The canvas is built by
  // executing a file, so previewing edits means writing them somewhere — just
  // never over the user's model. Null whenever the buffer matches disk, which
  // is why `selectExecPath` falls back to filePath.
  previewPath: string | null;
  // When the loaded model was opened from a local .pnlproject bundle (#348),
  // this holds that bundle's path. Save re-zips the working files back into
  // it instead of just writing the working .py. null for plain .py models.
  bundleOrigin: string | null;
  // Name of the bundled reference model currently loaded (matches
  // /api/reference-models `name`), or null if the open model isn't a reference
  // model. Cleared on every load via setFilePath; re-set right after by
  // loadReference — so it can never go stale (#830). Mirrors bundleOrigin.
  currentReference: string | null;

  // Graph (React Flow)
  nodes: Node[];
  edges: Edge[];

  // Line map: varName → line number in .py file
  lineMap: Record<string, number>;

  // Compositions metadata
  compositionNames: string[];
  activeComposition: string | null;
  // #763: executionModes is the per-composition capability matrix from the
  // backend (structure x install availability). Absent on models loaded by an
  // older backend, so consumers must tolerate undefined.
  compositionMeta: Record<
    string,
    { type: string; isAutodiff: boolean; hasLearning?: boolean; executionModes?: CompositionExecutionModeInfo[]; learningProfile?: LearningProfile | null }
  >;
  // #515: varName → canonical display label (the composition's name=
  // attribute, cleaned of -N suffixes; falls back to the varName). Keys like
  // activeComposition stay varName-based — surfaces that *show* a composition
  // should render through this map so the status bar, toolbar chip, selector,
  // and breadcrumb all agree.
  compositionDisplayNames: Record<string, string>;

  // #426 Flat list of every composition (top-level and nested) for the toolbar
  // selector. `value` is the key to select by (varName for top-level, cleaned
  // name for nested — matching activeComposition / focusedComposition keys);
  // `depth` drives indentation; `nested` routes a pick to focus vs activate.
  compositionOptions: { value: string; label: string; depth: number; nested: boolean }[];

  // #426 Focus mode: when set, the named nested composition renders full-canvas
  // as the graph root (instead of the outermost composition). `focusPath` is the
  // ancestor chain from the outermost composition down to the focused one,
  // driving the breadcrumb bar. Both reset to null/[] when focus is cleared.
  focusedComposition: string | null;
  focusPath: { name: string; label: string }[];

  // Semantic element-name labels from the optional `<model>.labels.yaml`
  // sidecar (#361 Layer 3). Shape mirrors the YAML so the resolver in
  // `utils/labels.ts` can walk it directly. Null when no sidecar exists.
  modelLabels: ModelLabels | null;

  // #407: list of sidecar files alongside the .py. Populated from the
  // /api/model/load response. Each entry: { kind, name }.
  bundle: BundleEntry[];
  // #483: the model's named layout / settings-profile variants — ordered
  // lists with one active each, merged on the backend from disk + index.
  // Null until the first /model/load. Drives the variant dropdown.
  sidecars: SidecarView | null;
  // The currently-shown file in the code editor. "source" means the .py
  // (i.e., the `source` field); any other kind is a sidecar whose raw
  // content lives in `sidecarContent`.
  selectedBundleKind: string;
  // Raw text of the currently-selected sidecar (irrelevant when
  // selectedBundleKind === "source"). Null = not yet fetched.
  sidecarContent: string | null;
  // The last-saved snapshot of the sidecar — for dirty detection.
  sidecarSavedContent: string | null;
  // Language hint from the backend (yaml | json) for syntax cues.
  sidecarLanguage: string | null;

  // #409 bidirectional sync. Two channels, both nullable:
  //  - yamlCursorContext: editor → Inspector. The current (node, port)
  //    the user is hovering in the labels.yaml view; PortsSection
  //    highlights the matching row.
  //  - yamlScrollIntent: Inspector → editor. After a port-label save,
  //    Inspector asks the editor to scroll to + briefly flash that
  //    entry's line. ``ts`` makes consecutive identical intents trigger
  //    a fresh useEffect (same {node,port} but updated reference).
  yamlCursorContext: { node: string; port: string | null; kind: "input" | "output" | "shorthand" } | null;
  yamlScrollIntent: { node: string; port: string; kind: "input" | "output"; ts: number } | null;

  // Scheduling
  gscConditions: GSCInfo[];
  basicConditions: BasicConditionEntry[];
  terminationConditions: Record<string, ConditionInfo>;
  schedulerConfig: SchedulerConfig;

  // Execution trace (from model runs)
  executionTrace: string[][];
  executionCounts: Record<string, number>;
  traceStep: number | null;  // null = no trace active, number = current step

  // Step indices into `executionTrace` at which each trial starts, e.g.
  // [0, n0, n0+n1, ...]. A single-element list means per-trial nav is not
  // available (older PsyNeuLink build without the `_debugger` hook).
  executionTrialBoundaries: number[];

  // Debugger snapshots captured live via PsyNeuLink's `_debugger` hook
  // (Phase 2A of #247). Empty when the PsyNeuLink build lacks `_debugger`.
  // Shape per entry varies by category, so kept lenient.
  debuggerSnapshots: DebuggerSnapshot[];

  // Per-step node output values derived from debuggerSnapshots (#312), so
  // MechanismNode can show the active node's value while stepping. Built
  // once in setDebuggerSnapshots rather than re-derived per node.
  traceStepValues: StepNodeValues;

  // Whether the PsyNeuLink build that produced the last run exposes the
  // `_debugger` hook (#475). null = no run yet; false = hook-less build
  // (per-node values / snapshots unavailable, trial nav is an estimated
  // split). Drives the "basic support" notes on the run panel + trace bar.
  debuggerHookAvailable: boolean | null;
  // #767: what stepping means for the mode this trace was captured under.
  // "full" = the scheduler ran and the hook recorded it; "synthesized" =
  // reconstructed from the torch path; "degraded" = the run happened but the
  // trace didn't. null before any run.
  steppingSupport: { level: string; reason: string | null } | null;

  // Model errors and diagnostics (from introspection)
  modelError: string | null;
  modelErrorLine: number | null;
  /**
   * The graph on screen is the last one that built, not the current file
   * (#1030).
   *
   * A file under edit is broken for much of the time it is being edited — half
   * a mechanism typed, an import not yet added — and every intermediate save
   * reaches us. Tearing the canvas down for each one makes it flicker, and
   * rebuilding from nothing loses the layout.
   *
   * Holding the graph is only safe if we say so: otherwise you are looking at a
   * diagram that no longer matches the file, with nothing to tell you.
   */
  graphIsStale: boolean;
  /**
   * The source that produced the graph currently on screen (#1154).
   *
   * Only PsyNeuView can answer "what code is this diagram of" — an IDE's local
   * history knows its own snapshots but not which one we last introspected
   * successfully. Recorded at the moment a model builds, which is the same
   * instant `graphIsStale` clears.
   *
   * Session-only and read-only: a diagnostic, not a recovery mechanism.
   */
  lastGoodSource: string | null;
  /** When `lastGoodSource` was recorded, so the distance is visible. */
  lastGoodAt: number | null;
  /**
   * The errors of the statements the build on screen skipped (#615), so a
   * preview can tell a statement an edit broke from one that was always
   * skipped, such as a library model's driver line (#1367).
   */
  shownSkippedErrors: string[];
  /// Bumped each time the user asks to be taken to the model error. (#1103)
  /// A counter rather than a boolean so repeated clicks each re-trigger the
  /// jump — the editor scrolls on the value changing, and a flag would only
  /// work the first time.
  errorRevealNonce: number;
  partialExecution: boolean;
  diagnostics: any | null;
  starImportConverted: boolean;

  // Dangling projections (statically detected — references to undefined vars)
  danglingProjections: DanglingProjectionInfo[];
  /** Connections PsyNeuLink refused to make, e.g. on a shape mismatch (#1235). */
  brokenProjections: BrokenProjectionInfo[];

  // Run inputs and training sets the model declares itself (#1216)
  inputSets: InputSet[];

  // Selection
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // Transient scheduler-authoring gesture (#385). When set, the canvas is in
  // "pick a node" mode: the next node click completes a scheduler condition —
  // the clicked node becomes the dependency — instead of selecting. The owner
  // is the node whose context menu started the gesture. null when idle.
  pendingConditionGesture: {
    ownerNodeId: string;
    ownerVarName: string;
    ownerLabel: string;
    conditionType: string;
  } | null;

  // Transient projection-authoring gesture (#311). When set, the canvas is in
  // "pick the source" mode: a projection was dropped from the palette onto a
  // receiver node, and the next node click names the sender. The dropped type
  // is the projection class to create. null when idle.
  pendingProjectionGesture: {
    receiverNodeId: string;
    receiverVarName: string;
    receiverLabel: string;
    projType: string;
  } | null;

  // Cursor-driven highlight (lighter than selection — tracks code-editor cursor
  // position so the user can see which canvas element the current line belongs
  // to without losing their manual selection in the Inspector).
  cursorHighlightedNodeId: string | null;
  cursorHighlightedEdgeId: string | null;

  // Code editor cursor target (line number to scroll to)
  cursorTargetLine: number | null;

  // Active param line in code editor (highlighted while Inspector field is focused)
  activeParamLine: number | null;

  // Layout
  autoLayout: boolean;
  // #659: the positions map from the last loaded layout sidecar, kept so saves
  // can merge over it and preserve positions for not-currently-rendered nodes.
  lastLayoutPositions: Record<string, { x: number; y: number }>;

  // WebSocket
  ws: WebSocket | null;

  // Actions
  setFilePath: (path: string) => void;
  // #906: force the next loadModelFromServer to re-derive Auto/Custom from the
  // sidecar, even when re-opening the *same* file path (an explicit Open should
  // respect the model's saved/curated layout, unlike a same-file source reload).
  markFreshOpen: () => void;
  setSource: (source: string) => void;
  setBundleOrigin: (path: string | null) => void;
  setCurrentReference: (name: string | null) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setPendingConditionGesture: (g: ModelState["pendingConditionGesture"]) => void;
  setPendingProjectionGesture: (g: ModelState["pendingProjectionGesture"]) => void;
  setCursorHighlightedNodeId: (id: string | null) => void;
  setCursorHighlightedEdgeId: (id: string | null) => void;
  setCursorTargetLine: (line: number | null) => void;
  setActiveParamLine: (line: number | null) => void;
  setWebSocket: (ws: WebSocket) => void;
  setActiveComposition: (name: string) => void;
  setFocusedComposition: (name: string | null) => void;
  setAutoLayout: (on: boolean) => void;
  setExecutionTrace: (trace: string[][], counts: Record<string, number>, boundaries?: number[], numTrials?: number) => void;
  setTraceStep: (step: number | null) => void;
  setDebuggerSnapshots: (snapshots: DebuggerSnapshot[]) => void;
  setDebuggerHookAvailable: (available: boolean | null) => void;
  setSteppingSupport: (support: { level: string; reason: string | null } | null) => void;
  clearTrace: () => void;
  // #404: update the cached sidecar labels without re-loading the model.
  // Used by the Inspector when the user edits a port display label —
  // POST /api/model/save-labels writes to disk, this updates the store
  // so the pill / Run State / value-at-step section rerender immediately.
  setModelLabels: (labels: ModelLabels | null) => void;
  // #407: bundle picker state.
  setBundle: (bundle: BundleEntry[]) => void;
  // #483: variant view + applying a switched variant.
  setSidecars: (sidecars: SidecarView | null) => void;
  // Refetch the merged variant view (after a create/rename/delete/reorder).
  refreshSidecars: () => Promise<void>;
  // Re-place existing canvas nodes from a layout variant's positions map,
  // without re-introspecting the model (keeps selection/trace/focus intact).
  applyLayoutPositions: (positions: Record<string, { x: number; y: number }>) => void;
  // Make a variant active on disk and re-apply it: layouts re-place the
  // canvas, settings swap the labels overlay. Refreshes the view after.
  switchVariant: (kind: SidecarKind, name: string) => Promise<void>;
  // Set (or, with "inherit", clear) the model's sidecar placement and migrate
  // its files. Returns the migration result so the caller can surface any
  // both-locations conflicts (#933).
  setPlacement: (placement: PlacementLocation | "inherit") => Promise<MigrationResult | null>;
  setSelectedBundleKind: (kind: string) => void;
  setSidecarContent: (content: string | null, language?: string | null) => void;
  setSidecarSavedContent: (content: string | null) => void;
  // #409 sync setters.
  setYamlCursorContext: (ctx: ModelState["yamlCursorContext"]) => void;
  setYamlScrollIntent: (intent: ModelState["yamlScrollIntent"]) => void;
  /// Ask the editor to scroll to, select, and focus the model error line.
  revealModelError: () => void;
  loadModelFromServer: (
    modelData: any,
    layout?: any,
    sidecarLabels?: ModelLabels | null,
    // #407: list of sidecar files alongside the .py. Populates the
    // code editor's file picker; defaults to source-only.
    bundle?: BundleEntry[],
    // #483: the merged named-variant view from /model/load.
    sidecars?: SidecarView | null,
    // #1029: `markSaved: false` adopts the graph without claiming the buffer
    // matches disk. Used only by previews, which build a model from unsaved
    // text; every other load is authoritative and marks the buffer clean.
    opts?: { markSaved?: boolean },
  ) => void;
  /**
   * Adopt a graph built from unsaved editor content, leaving it unsaved.
   * `builtSource` is the text the preview was built from: typing can go on
   * while a preview is out, so the buffer at reply time may be newer (#1347).
   *
   * Returns whether the edit built. When it did not, the graph on screen is
   * held, with the stale banner (#1030, #1367).
   */
  applyPreviewModel: (modelData: any, previewPath: string, builtSource?: string) => boolean;
  /**
   * Write any unsaved editor buffer to disk (#1029).
   *
   * Inspector and canvas edits are applied by the backend to the file *on
   * disk*, so they must not run against a stale file while the code editor
   * holds newer text — the edit would be computed from source the user is no
   * longer looking at. Those actions are deliberate, and deliberate actions
   * write, so committing the buffer first is the consistent behavior.
   *
   * Resolves false if the write failed; callers should not proceed.
   */
  flushBuffer: () => Promise<boolean>;
}

// #614: set when a genuinely new model is opened (setFilePath sees a changed
// path), consumed by the next loadModelFromServer to decide the initial layout
// mode from the model's saved sidecar. Reloads/toggles keep filePath stable, so
// they leave this false and preserve the current Auto/Custom choice.
let pendingFreshOpenLayout = false;
// #47: which set of saved positions the last build read — the nested view's
// or the flat/PyTorch view's. Switching between them re-picks Auto/Custom
// like a fresh open: a view with nothing saved has no custom layout to keep,
// and staying in Custom there would hide the automatic layout (#33).
let lastPositionsView: "nested" | "flat" | null = null;
// The last model error put in the activity log (#1287): a file under edit
// reports the same error on every keystroke, and once is enough.
let lastRecordedModelError: string | null = null;

/// Drop the undo history when a new model is opened. (#1091)
///
/// The history stack was never cleared, so snapshots from an earlier model
/// stayed on it. Pressing undo enough times walked the user out of the model
/// they were editing and into a previous one — believing they were editing one
/// file and finding themselves in another, with no obvious way back.
///
/// This sits alongside clearTrace() for the same reason: a different file is a
/// different model, and the previous model's artifacts have no meaning here.
function resetHistoryForNewModel() {
  useHistoryStore.getState().clear();
}

export const useModelStore = create<ModelState>((set, get) => ({
  filePath: null,
  source: "",
  savedSource: "",
  previewPath: null,
  bundleOrigin: null,
  currentReference: null,
  nodes: [],
  edges: [],
  lineMap: {},
  compositionNames: [],
  activeComposition: null,
  compositionMeta: {},
  compositionDisplayNames: {},
  compositionOptions: [],
  focusedComposition: null,
  focusPath: [],
  modelLabels: null,
  bundle: [],
  sidecars: null,
  selectedBundleKind: "source",
  sidecarContent: null,
  sidecarSavedContent: null,
  sidecarLanguage: null,
  yamlCursorContext: null,
  yamlScrollIntent: null,
  gscConditions: [],
  basicConditions: [],
  terminationConditions: {},
  schedulerConfig: {},
  executionTrace: [],
  executionCounts: {},
  traceStep: null,
  executionTrialBoundaries: [],
  debuggerSnapshots: [],
  traceStepValues: new Map(),
  debuggerHookAvailable: null,
  steppingSupport: null,
  modelError: null,
  modelErrorLine: null,
  graphIsStale: false,
  lastGoodSource: null,
  lastGoodAt: null,
  shownSkippedErrors: [],
  errorRevealNonce: 0,
  partialExecution: false,
  diagnostics: null,
  starImportConverted: false,
  danglingProjections: [],
  brokenProjections: [],
  inputSets: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  pendingConditionGesture: null,
  pendingProjectionGesture: null,
  cursorHighlightedNodeId: null,
  cursorHighlightedEdgeId: null,
  cursorTargetLine: null,
  activeParamLine: null,
  autoLayout: true,
  lastLayoutPositions: {},
  ws: null,

  // Clears bundleOrigin: every fresh load routes through setFilePath, and
  // only opening a .pnlproject (which calls setBundleOrigin right after)
  // should leave an origin set. This keeps a stale origin from a previously
  // opened bundle from making the next plain-.py Save re-zip into it (#348).
  setFilePath: (path) => {
    const changed = path !== get().filePath;
    // The activity log (#1287): an explicit Open — a new path, or the same one
    // opened again (markFreshOpen ran first). A same-file reload is neither.
    if (changed || pendingFreshOpenLayout) record("model", `${changed ? "Opened" : "Reopened"} ${path}`, { path });
    // A different file is a new model: re-apply collapse-by-default to its
    // nested compositions and wipe the previous model's run artifacts so the
    // Run panel starts clean. Same-file reloads (source edits, collapse
    // toggles) deliberately keep filePath stable and must not trip this — they
    // should preserve an existing run's results (#395, #433).
    if (changed) {
      useGraphSettings.getState().resetCollapseSeed();
      get().clearTrace();
      pendingFreshOpenLayout = true; // #614: next load picks layout mode from sidecar
      resetHistoryForNewModel(); // #1091
    }
    set({ filePath: path, bundleOrigin: null, currentReference: null });
  },
  // #906: an explicit Open (reference model, library example, file import) should
  // always re-pick the layout mode from the freshly-loaded sidecar — otherwise a
  // model re-opened while already loaded (same path) keeps a stale Auto/Custom
  // choice and ignores its curated layout. Same-file *reloads* (source edits,
  // collapse toggles) deliberately do NOT call this, preserving their layout mode.
  markFreshOpen: () => {
    pendingFreshOpenLayout = true;
    // An explicit Open is a new model even when the path is unchanged, so the
    // previous session's undo entries must not survive it either (#1091).
    resetHistoryForNewModel();
  },
  flushBuffer: async () => {
    const { filePath, source, savedSource, bundleOrigin } = get();
    if (!filePath || source === savedSource) return true;
    const endpoint = bundleOrigin ? "/api/model/save-project" : "/api/model/save-source";
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // base_source: what we believe is on disk, so the server refuses to
        // write over a change made elsewhere since (#1). Inspector and canvas
        // edits flush typed code first; without it, an outside edit was
        // overwritten with no prompt.
        body: JSON.stringify(
          bundleOrigin
            ? { file_path: filePath, source, bundle_path: bundleOrigin }
            : { file_path: filePath, source, base_source: savedSource },
        ),
      });
      if (resp.status === 409) {
        // Changed on disk: ask, exactly as Save does, instead of writing.
        const err = await resp.json().catch(() => null);
        const detail = err?.detail;
        if (detail && typeof detail.disk_source === "string") {
          useExternalChangeStore.getState().setPending({
            filePath,
            source: detail.disk_source,
            model: detail.disk_model,
          });
        }
        record("model", `Save refused, changed on disk: ${filePath}`, { path: filePath, status: 409 });
        return false;
      }
      if (!resp.ok) {
        record("model", `Save failed: ${filePath}`, { path: filePath, status: resp.status });
        return false;
      }
      const data = await resp.json();
      record("model", `Saved ${filePath}`, { path: filePath, ...(bundleOrigin ? { bundle: bundleOrigin } : {}) });
      // Authoritative: reconciles savedSource and drops the preview.
      get().loadModelFromServer(data.model, data.layout);
      return true;
    } catch (e) {
      record("model", `Save failed: ${filePath}`, { path: filePath, reason: String(e) });
      return false;
    }
  },

  applyPreviewModel: (modelData, previewPath, builtSource) => {
    // A statement the edit broke was skipped and the rest built (#615): the
    // graph would quietly lose what was just typed. Hold the graph and say so,
    // as for a syntax error (#1367). Only for an edit: a file opened or saved
    // that way is shown as it builds, skipped statements and all.
    const dangling: { line: number }[] = modelData?.danglingProjections || [];
    const broken = modelData?.error
      ? null
      : newlyBrokenStatement(
          modelData?.skippedStatements,
          get().shownSkippedErrors,
          new Set(dangling.map((d) => d.line)),
        );
    if (broken && get().nodes.length > 0) {
      set({
        modelError: broken.error,
        modelErrorLine: broken.line,
        graphIsStale: true,
        previewPath,
      });
      return false;
    }
    // Adopt the graph, keep the buffer dirty: these edits are not on disk.
    get().loadModelFromServer(modelData, undefined, undefined, undefined, undefined, {
      markSaved: false,
    });
    set({ previewPath });
    // The load records the buffer *now* as the last good source; the text that
    // actually built is the one sent. Autosave writes only code seen to build
    // (#1347), so a keystroke typed while the preview was out must not count.
    if (builtSource !== undefined && !modelData?.error) set({ lastGoodSource: builtSource });
    return !modelData?.error;
  },

  setSource: (source) => set({ source }),
  setBundleOrigin: (path) => set({ bundleOrigin: path }),
  setCurrentReference: (name) => set({ currentReference: name }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setSelectedNodeId: (id) => {
    set({ selectedNodeId: id, selectedEdgeId: null });
  },
  setSelectedEdgeId: (id) => {
    set({ selectedEdgeId: id, selectedNodeId: null });
  },
  setPendingConditionGesture: (g) => set({ pendingConditionGesture: g }),
  setPendingProjectionGesture: (g) => set({ pendingProjectionGesture: g }),
  setCursorHighlightedNodeId: (id) =>
    set({ cursorHighlightedNodeId: id, cursorHighlightedEdgeId: null }),
  setCursorHighlightedEdgeId: (id) =>
    set({ cursorHighlightedEdgeId: id, cursorHighlightedNodeId: null }),
  setCursorTargetLine: (line) => set({ cursorTargetLine: line }),
  setActiveParamLine: (line) => set({ activeParamLine: line }),
  setActiveComposition: (name) => set({ activeComposition: name }),
  setFocusedComposition: (name) => set({ focusedComposition: name }),
  setAutoLayout: (on) => set({ autoLayout: on }),
  setExecutionTrace: (trace, counts, boundaries, numTrials) => set({
    executionTrace: trace,
    executionCounts: counts,
    traceStep: trace.length > 0 ? 0 : null,
    // #470: on builds without the `_debugger` hook the backend can't supply
    // per-trial boundaries, so derive them from numTrials to keep trial-level
    // stepping working instead of silently vanishing.
    executionTrialBoundaries: deriveTrialBoundaries(trace.length, numTrials, boundaries),
  }),
  setTraceStep: (step) => set({ traceStep: step }),
  setDebuggerSnapshots: (snapshots) => set({ debuggerSnapshots: snapshots, traceStepValues: buildStepNodeValues(snapshots) }),
  setDebuggerHookAvailable: (available) => set({ debuggerHookAvailable: available }),
  setSteppingSupport: (support) => set({ steppingSupport: support }),
  setModelLabels: (labels) => set({ modelLabels: labels }),
  setBundle: (bundle) => set({ bundle }),
  setSidecars: (sidecars) => set({ sidecars }),
  refreshSidecars: async () => {
    const filePath = get().filePath;
    if (!filePath) return;
    try {
      set({ sidecars: await listSidecars(filePath) });
    } catch {
      // Transient list failure shouldn't blow away the current view.
    }
  },
  applyLayoutPositions: (positions) => {
    const nodes = get().nodes.map((n) => {
      // Layout files key positions by the node's PsyNeuLink varName (same
      // key save-layout writes); fall back to the React Flow node id.
      const vn = (n.data as any)?.varName || n.id;
      const p = positions[vn] ?? positions[n.id];
      return p ? { ...n, position: { x: p.x, y: p.y } } : n;
    });
    set({ nodes });
  },
  switchVariant: async (kind, name) => {
    const filePath = get().filePath;
    if (!filePath) return;
    await apiSetActiveVariant(filePath, kind, name);
    // Pull the now-active variant's parsed content and apply it in place —
    // no /model/load, so the run trace, selection, and focus all survive.
    const resolved = await resolveSidecars(filePath);
    if (kind === "layout") {
      const pos = resolved.layout?.positions;
      if (pos) get().applyLayoutPositions(pos);
    } else {
      get().setModelLabels((resolved.labels as ModelLabels | null) ?? null);
    }
    await get().refreshSidecars();
  },
  setPlacement: async (placement) => {
    const filePath = get().filePath;
    if (!filePath) return null;
    // The response already carries the refreshed view (with the new effective
    // placement), so set it directly rather than a second list round-trip.
    const view = await apiSetPlacement(filePath, placement);
    set({ sidecars: view });
    return view.migration ?? null;
  },
  setSelectedBundleKind: (kind) => set({ selectedBundleKind: kind }),
  setSidecarContent: (content, language) =>
    set({
      sidecarContent: content,
      sidecarLanguage: language ?? null,
    }),
  setSidecarSavedContent: (content) => set({ sidecarSavedContent: content }),
  setYamlCursorContext: (ctx) => set({ yamlCursorContext: ctx }),
  setYamlScrollIntent: (intent) => set({ yamlScrollIntent: intent }),
  revealModelError: () =>
    set((state) => ({ errorRevealNonce: state.errorRevealNonce + 1 })),
  clearTrace: () => set({ executionTrace: [], executionCounts: {}, traceStep: null, executionTrialBoundaries: [], debuggerSnapshots: [], traceStepValues: new Map(), debuggerHookAvailable: null, steppingSupport: null }),
  setWebSocket: (ws) => set({ ws }),

  loadModelFromServer: (
    modelData: any,
    layout?: any,
    sidecarLabels?: ModelLabels | null,
    bundle?: BundleEntry[],
    sidecars?: SidecarView | null,
    opts?: { markSaved?: boolean },
  ) => {
    const markSaved = opts?.markSaved !== false;

    // A model that did not build must not take the graph down with it (#1030).
    //
    // Both doors reach here: an external save from an IDE, and typing in our
    // own editor. Either way, when the file is mid-edit the introspection
    // fails and `compositions` comes back empty — applying that clears the
    // canvas and discards the layout, then rebuilds a moment later when the
    // next keystroke parses. The result is flicker, and a lost arrangement.
    //
    // Keep what we have and record the error instead. The source still
    // updates, so the editor mirrors the file; only the graph is held.
    //
    // Only when there *is* something to hold: a broken file opened cold has no
    // previous graph, and showing an empty canvas is then the honest answer.
    const brokenModel = Boolean(modelData?.error);
    // Shown to the user in the diagnostics bar, so it goes in the activity
    // log (#1287) — the message only, never the source; once per distinct error.
    if (brokenModel && modelData.error !== lastRecordedModelError) {
      lastRecordedModelError = modelData.error;
      record("error", `Model error: ${String(modelData.error).slice(0, 300)}`, { line: modelData.errorLine ?? null });
    }
    const builtNothing = !modelData?.compositions?.length;
    const haveAGraph = get().nodes.length > 0;
    if (brokenModel && builtNothing && haveAGraph) {
      set({
        modelError: modelData.error,
        modelErrorLine: modelData.errorLine || null,
        graphIsStale: true,
        // Still the buffer's baseline: the file on disk is what we were handed,
        // broken or not, so the editor must not come back marked dirty against
        // the previous text.
        ...(markSaved ? { savedSource: get().source, previewPath: null } : {}),
      });
      return;
    }

    // Stash sidecar labels as soon as a load comes in; the resolver in
    // utils/labels.ts is the single consumer. Null overrides preserve the
    // "no labels" state on reload (#361 Layer 3). Parameter renamed from
    // `labels` to avoid shadowing the unrelated `LabelEntry[]` local used
    // by the edge-label stagger pass further down in this function.
    set({
      modelLabels: sidecarLabels ?? null,
      // #407: bundle list + reset the picker back to source on every load
      // (a newly opened file probably isn't the same as whatever the user
      // had selected before).
      bundle: bundle ?? [],
      // #483: merged variant view. Undefined (older callers) leaves the
      // previous view; explicit null clears it.
      ...(sidecars !== undefined ? { sidecars } : {}),
      selectedBundleKind: "source",
      sidecarContent: null,
      sidecarSavedContent: null,
      sidecarLanguage: null,
    });
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const lineMap: Record<string, number> = modelData.lineMap || {};
    // #719: the flat / PyTorch (clustered) view stores its positions in a
    // separate namespace (frame-relative coords) so they don't collide with the
    // nested view's. Read whichever matches the active view.
    const isFlatView = useGraphSettings.getState().flat || useGraphSettings.getState().pytorch;
    const savedPositions = (isFlatView ? layout?.flatPositions : layout?.positions) || {};

    // #614: on a genuinely fresh open, restore the model's saved layout —
    // open in Custom when the sidecar carries positions, Auto otherwise. Only
    // fires for new-file opens (flagged in setFilePath); reloads, source edits,
    // and Auto/Custom toggles keep filePath stable and preserve the current
    // mode, so this never fights the toggle.
    const positionsView = isFlatView ? "flat" : "nested";
    const viewChanged = lastPositionsView !== null && lastPositionsView !== positionsView;
    lastPositionsView = positionsView;
    if (pendingFreshOpenLayout || viewChanged) {
      pendingFreshOpenLayout = false;
      set({ autoLayout: Object.keys(savedPositions).length === 0 });
    }

    // Track all composition names, default to the outermost one
    const allComps = modelData.compositions || [];
    const compNames = allComps.map((c: any) => c.varName);

    // Node names from PNL may have -N suffixes, so compare cleaned names.
    const cleanN = (s: string) => s.replace(/-\d+$/, "");

    // Build flat varName → metadata map, recursing into nested compositions.
    // Used to gate the PyTorch view checkbox on AutodiffComposition presence.
    // Alongside it, the #515 display-name map: one canonical label per
    // composition (the name= attribute, varName fallback) so every surface
    // shows the same thing.
    const compositionMeta: Record<
      string,
      { type: string; isAutodiff: boolean; hasLearning?: boolean; executionModes?: CompositionExecutionModeInfo[]; learningProfile?: LearningProfile | null }
    > = {};
    const compositionDisplayNames: Record<string, string> = {};
    const walkComp = (c: any) => {
      if (!c || c.kind !== "composition") return;
      compositionMeta[c.varName || c.name] = {
        type: c.compositionType || "Composition",
        isAutodiff: !!c.isAutodiff,
        hasLearning: !!c.hasLearning,
        executionModes: c.executionModes,
        learningProfile: c.learningProfile ?? null,
      };
      compositionDisplayNames[c.varName || c.name] = cleanN(c.name || c.varName);
      for (const node of c.nodes || []) walkComp(node);
    };
    for (const c of allComps) walkComp(c);

    // Find the outermost composition: the one whose name doesn't appear
    // as a child node inside any other composition.
    const nestedNames = new Set<string>();
    const nestedCompLabels: string[] = [];
    for (const comp of allComps) {
      for (const node of (comp.nodes || [])) {
        if (node.kind === "composition") {
          nestedNames.add(node.varName || node.name);
          nestedNames.add(cleanN(node.varName || node.name));
          // Dispatch + the expand toggle key compositions by cleaned name.
          nestedCompLabels.push(cleanN(node.name));
        }
      }
    }
    // Collapse nested compositions on first sight so big models (e.g. EGO's
    // EMComposition) open as a single super-node instead of an exploded
    // chain. The expand button reverses it per-session (#395).
    useGraphSettings.getState().seedDefaultCollapsed(nestedCompLabels);
    const outermostComp = compNames.find((n: string) => !nestedNames.has(n) && !nestedNames.has(cleanN(n)));

    const currentActive = get().activeComposition;
    const activeComp = currentActive && compNames.includes(currentActive)
      ? currentActive
      : outermostComp || compNames[0] || null;

    // #426 Flat selector options: top-level compositions first, then nested
    // ones indented beneath their parent. Top-level value is the varName (the
    // activeComposition key); nested value is the cleaned name (the
    // focusedComposition key), so a pick routes straight to the right action.
    const compositionOptions: { value: string; label: string; depth: number; nested: boolean }[] = [];
    const walkOptions = (comps: any[], depth: number) => {
      for (const c of comps) {
        const nm = c.varName || c.name;
        // PNL also lists nested compositions as top-level entries in
        // modelData.compositions. Skip those at the top level — they're emitted
        // (indented, routed to focus mode) under their real parent on recursion.
        if (depth === 0 && (nestedNames.has(nm) || nestedNames.has(cleanN(nm)))) continue;
        const isNestedNode = depth > 0;
        compositionOptions.push({
          value: isNestedNode ? cleanN(c.name || c.varName) : (c.varName || c.name),
          label: cleanN(c.name || c.varName),
          depth,
          nested: isNestedNode,
        });
        walkOptions((c.nodes || []).filter((n: any) => n.kind === "composition"), depth + 1);
      }
    };
    walkOptions(allComps, 0);

    // #426 Focus mode: if a nested composition is focused, render IT as the
    // graph root instead of the active top-level composition. Locate it (and
    // its ancestor trail, for the breadcrumb) anywhere in the comp tree. The
    // focus key is the cleaned name — the same key CompositionNode collapse and
    // seedDefaultCollapsed use. A stale focus (name no longer present, e.g. a
    // different model was loaded) silently falls back to the normal view.
    const focused = get().focusedComposition;
    const locateComp = (
      comps: any[],
      targetClean: string,
      trail: { name: string; label: string }[],
    ): { comp: any; path: { name: string; label: string }[] } | null => {
      for (const c of comps) {
        const clean = cleanN(c.name || c.varName);
        const myTrail = [...trail, { name: clean, label: clean }];
        if (clean === targetClean) return { comp: c, path: myTrail };
        const childComps = (c.nodes || []).filter((n: any) => n.kind === "composition");
        const r = locateComp(childComps, targetClean, myTrail);
        if (r) return r;
      }
      return null;
    };
    // PNL also lists nested compositions as top-level entries in
    // modelData.compositions. Search only the *true* top-level comps so the
    // ancestor trail is always built through a nested comp's real parent —
    // otherwise locateComp may short-circuit on the spurious duplicate and
    // return a trail missing the parent (e.g. "inner" with no "outer").
    const trueTopLevel = allComps.filter((c: any) => {
      const nm = c.varName || c.name;
      return !nestedNames.has(nm) && !nestedNames.has(cleanN(nm));
    });
    const focusHit = focused ? locateComp(trueTopLevel, focused, []) : null;
    const resolvedFocus = focusHit ? focused : null;
    // #513 A model's sole top-level composition *is* the full-model canvas, so
    // the leading "⌂ Full model" button already represents it. Drop that
    // redundant first crumb so the trail reads "Full model › EM" instead of
    // "Full model › EGO › EM". Multi-root models keep the full ancestor trail.
    const resolvedFocusPath = focusHit
      ? trueTopLevel.length <= 1
        ? focusHit.path.slice(1)
        : focusHit.path
      : [];

    // Filter to the focused composition, else the active composition.
    const compositions = focusHit
      ? [focusHit.comp]
      : activeComp
      ? allComps.filter((c: any) => c.varName === activeComp)
      : allComps;

    const cleanName = (name: string) => name.replace(/-\d+$/, "");

    const findVarName = (nodeName: string) => {
      for (const [varName] of Object.entries(lineMap)) {
        if (varName === nodeName || varName === cleanName(nodeName)) {
          return varName;
        }
      }
      return cleanName(nodeName);
    };

    const getPosition = (name: string, autoX: number, autoY: number) => {
      const varName = findVarName(name);
      if (savedPositions[varName]) return savedPositions[varName];
      if (savedPositions[name]) return savedPositions[name];
      return { x: autoX, y: autoY };
    };

    // Recursively process a composition's nodes and edges.
    // Top-level: left-to-right flow. Inside groups: top-to-bottom flow.
    const processComposition = (
      comp: any,
      parentId: string | undefined,
      offsetX: number,
      offsetY: number
    ) => {
      const compNodes = comp.nodes || [];
      const compProjs = comp.projections || [];
      const isNested = !!parentId;

      // Topological sort
      const nodeNames = compNodes.map((n: any) => n.name);
      const inDegree: Record<string, number> = {};
      const adjacency: Record<string, string[]> = {};
      nodeNames.forEach((n: string) => { adjacency[n] = []; inDegree[n] = 0; });
      for (const proj of compProjs) {
        const s = proj.sender?.mechanism, t = proj.receiver?.mechanism;
        if (s && t && s in adjacency && t in inDegree) {
          adjacency[s].push(t);
          inDegree[t]++;
        }
      }
      const topoOrder: string[] = [];
      const queue = nodeNames.filter((n: string) => inDegree[n] === 0);
      while (queue.length > 0) {
        const n = queue.shift()!;
        topoOrder.push(n);
        for (const nb of adjacency[n]) { inDegree[nb]--; if (inDegree[nb] === 0) queue.push(nb); }
      }
      for (const n of nodeNames) { if (!topoOrder.includes(n)) topoOrder.push(n); }

      // Place nodes sequentially
      let cursorX = offsetX;
      let cursorY = offsetY;

      for (const name of topoOrder) {
        const nodeData = compNodes.find((n: any) => n.name === name);
        if (!nodeData) continue;

        if (nodeData.kind === "composition") {
          const childCount = (nodeData.nodes || []).length;
          const collapsed = useGraphSettings.getState().collapsedCompositions.has(cleanName(name));
          const isInset = useGraphSettings.getState().insetCompositions.has(cleanName(name));

          const interfacePorts = compositionInterfacePorts(nodeData);

          if (collapsed) {
            // Render as a single mechanism-like node. Surface the composition's
            // CIM ports so its top-level edges have handles to attach to (#644).
            nodes.push({
              id: name,
              type: "mechanismNode",
              position: getPosition(name,
                isNested ? offsetX : cursorX,
                isNested ? cursorY : offsetY
              ),
              data: {
                label: cleanName(name),
                varName: findVarName(name),
                type: "Composition",
                roles: nodeData.roles || [],
                inputPorts: interfacePorts.inputPorts,
                outputPorts: interfacePorts.outputPorts,
                parameterPorts: [],
                params: {},
                function: null,
                line: lineMap[findVarName(name)],
              },
            });
            if (isNested) { cursorY += 140; } else { cursorX += 220; }
          } else {
            // Placeholder size — autoSizeGroups will fix it after children are placed
            const groupW = Math.max(280, childCount * 200 + 60);
            const groupH = Math.max(250, childCount * 140 + 60);

            nodes.push({
              id: name,
              type: "compositionNode",
              position: getPosition(name, cursorX, offsetY),
              style: { width: groupW, height: groupH, zIndex: 0 },
              data: {
                label: cleanName(name),
                varName: findVarName(name),
                childCount,
                inset: isInset,
                line: lineMap[findVarName(name)],
                // Expose CIM ports so top-level edges attach to the group node
                // even while it's expanded (#644).
                inputPorts: interfacePorts.inputPorts,
                outputPorts: interfacePorts.outputPorts,
              },
            });

            // Children inside the group flow TOP-TO-BOTTOM
            processComposition(nodeData, name, 20, 45);

            if (isNested) { cursorY += groupH + 30; } else { cursorX += groupW + 80; }
          }
        } else {
          const nodeConfig: Node = {
            id: name,
            type: "mechanismNode",
            position: getPosition(name,
              isNested ? offsetX : cursorX,
              isNested ? cursorY : offsetY
            ),
            data: {
              label: cleanName(name),
              // Prefer the backend-synthesized handle (#422): it resolves
              // function-scoped nodes whose local var differs from the PNL
              // name, which findVarName (name-based) cannot.
              varName: nodeData.varName || findVarName(name),
              type: nodeData.type,
              roles: nodeData.roles || [],
              inputPorts: nodeData.inputPorts || [],
              outputPorts: nodeData.outputPorts || [],
              parameterPorts: nodeData.parameterPorts || [],
              params: nodeData.params || {},
              function: nodeData.function || null,
              line: nodeData.line ?? lineMap[findVarName(name)],
              // #659: in flat view each hoisted node carries the path of the
              // composition(s) it came from, so layout can anchor it to where
              // that composition lived in the saved (nested) layout.
              compPath: nodeData.compPath,
              excludeFromGradientCalc: nodeData.excludeFromGradientCalc,
            },
          };
          if (parentId) nodeConfig.parentId = parentId;
          nodes.push(nodeConfig);

          if (isNested) { cursorY += 160; } else { cursorX += 240; }
        }
      }

      // Edges
      for (const proj of compProjs) {
        const edgeLabel = proj.varName
          || findVarName(cleanName(proj.name))
          || cleanName(proj.name);

        edges.push({
          id: proj.name,
          source: proj.sender?.mechanism || "",
          target: proj.receiver?.mechanism || "",
          sourceHandle: proj.sender?.port || undefined,
          targetHandle: proj.receiver?.port || undefined,
          label: edgeLabel,
          type: "projectionEdge",
          animated: false,
          style: getEdgeStyle(proj.type),
          markerEnd: getEdgeMarker(proj.type),
          data: {
            label: edgeLabel,
            varName: proj.varName || findVarName(cleanName(proj.name)),
            type: proj.type,
            params: proj.params || {},
            function: proj.function || null,
            sender: proj.sender,
            receiver: proj.receiver,
            matrixShape: proj.matrixShape || null,
            line: lineMap[proj.varName || findVarName(cleanName(proj.name))],
            labelOffset: 0.5, // will be staggered below
          },
        });
      }
    };

    for (const comp of compositions) {
      processComposition(comp, undefined, 0, 80);
    }

    // Add controller nodes and edges if present and enabled
    const { showController } = useGraphSettings.getState();
    for (const comp of compositions) {
      if (!comp.controller || !showController) continue;
      const ctrl = comp.controller;
      const ctrlMech = ctrl.mechanism;
      if (!ctrlMech) continue;

      // Find rightmost node position for controller placement
      const maxX = nodes.reduce((mx, n) => Math.max(mx, n.position.x), 0);
      const maxY = nodes.reduce((mx, n) => Math.max(mx, n.position.y), 0);

      // Controller mechanism node
      nodes.push({
        id: ctrlMech.name,
        type: "mechanismNode",
        position: getPosition(ctrlMech.name, maxX + 300, 80),
        data: {
          label: cleanName(ctrlMech.name),
          varName: findVarName(ctrlMech.name),
          type: ctrlMech.type,
          roles: ["CONTROLLER"],
          inputPorts: ctrlMech.inputPorts || [],
          outputPorts: ctrlMech.outputPorts || [],
          parameterPorts: ctrlMech.parameterPorts || [],
          params: ctrlMech.params || {},
          function: ctrlMech.function || null,
          isController: true,
        },
      });

      // Objective mechanism node
      if (ctrl.objectiveMechanism) {
        const objMech = ctrl.objectiveMechanism;
        nodes.push({
          id: objMech.name,
          type: "mechanismNode",
          position: getPosition(objMech.name, maxX + 300, maxY + 100),
          data: {
            label: cleanName(objMech.name),
            varName: findVarName(objMech.name),
            type: objMech.type,
            roles: ["CONTROLLER_OBJECTIVE"],
            inputPorts: objMech.inputPorts || [],
            outputPorts: objMech.outputPorts || [],
            parameterPorts: objMech.parameterPorts || [],
            params: objMech.params || {},
            function: objMech.function || null,
            isObjectiveMechanism: true,
          },
        });
      }

      // Control projections (controller → controlled nodes)
      for (const proj of ctrl.controlProjections || []) {
        const targetId = proj.receiver?.mechanism;
        if (!targetId || !nodes.find((n) => n.id === targetId)) continue;
        edges.push({
          id: proj.name,
          source: ctrlMech.name,
          target: targetId,
          sourceHandle: proj.sender?.port || undefined,
          targetHandle: proj.receiver?.port || undefined,
          type: "smoothstep",
          animated: false,
          style: { strokeWidth: 2 },
          data: {
            label: cleanName(proj.name),
            type: proj.type || "ControlProjection",
            sender: proj.sender,
            receiver: proj.receiver,
          },
        });
      }

      // Monitor projections (monitored nodes → objective mechanism)
      if (ctrl.objectiveMechanism) {
        for (const proj of ctrl.monitorProjections || []) {
          const sourceId = proj.sender?.mechanism;
          if (!sourceId || !nodes.find((n) => n.id === sourceId)) continue;
          edges.push({
            id: proj.name,
            source: sourceId,
            target: ctrl.objectiveMechanism.name,
            sourceHandle: proj.sender?.port || undefined,
            targetHandle: proj.receiver?.port || undefined,
            type: "smoothstep",
            animated: false,
            style: { strokeWidth: 2 },
            data: {
              label: cleanName(proj.name),
              type: proj.type || "MappingProjection",
              sender: proj.sender,
              receiver: proj.receiver,
            },
          });
        }

        // Objective → Controller edge
        edges.push({
          id: `${ctrl.objectiveMechanism.name}_to_${ctrlMech.name}`,
          source: ctrl.objectiveMechanism.name,
          target: ctrlMech.name,
          type: "smoothstep",
          animated: false,
          style: { strokeWidth: 2 },
          data: {
            label: "objective → controller",
            type: "ControlProjection",
          },
        });
      }
    }

    // Add learning components if present and enabled
    const { showLearning } = useGraphSettings.getState();
    for (const comp of compositions) {
      if (!comp.learning || !showLearning) continue;
      const learning = comp.learning;

      // Find bottom-right position for learning nodes
      const maxX = nodes.reduce((mx, n) => Math.max(mx, n.position.x), 0);
      const minY = nodes.reduce((mn, n) => Math.min(mn, n.position.y), Infinity);

      // Learning mechanism nodes
      let ly = minY;
      for (const mech of learning.mechanisms || []) {
        nodes.push({
          id: mech.name,
          type: "mechanismNode",
          position: getPosition(mech.name, maxX + 300, ly),
          data: {
            label: cleanName(mech.name),
            varName: findVarName(mech.name),
            type: mech.type,
            roles: mech.roles || ["LEARNING"],
            inputPorts: mech.inputPorts || [],
            outputPorts: mech.outputPorts || [],
            parameterPorts: mech.parameterPorts || [],
            params: mech.params || {},
            function: mech.function || null,
          },
        });
        ly += 140;
      }

      // Learning projections
      for (const proj of learning.projections || []) {
        const sourceId = proj.sender?.mechanism;
        const targetId = proj.receiver?.mechanism;
        if (!sourceId || !targetId) continue;
        if (!nodes.find((n) => n.id === sourceId) || !nodes.find((n) => n.id === targetId)) continue;
        edges.push({
          id: proj.name,
          source: sourceId,
          target: targetId,
          sourceHandle: proj.sender?.port || undefined,
          targetHandle: proj.receiver?.port || undefined,
          type: "smoothstep",
          animated: false,
          style: getEdgeStyle(proj.type || "LearningProjection"),
          markerEnd: getEdgeMarker(proj.type || "LearningProjection"),
          data: {
            label: cleanName(proj.name),
            type: proj.type || "LearningProjection",
            sender: proj.sender,
            receiver: proj.receiver,
          },
        });
      }
    }

    // Add inactive projections if toggled on
    const { showInactive } = useGraphSettings.getState();
    if (showInactive) {
      for (const comp of compositions) {
        for (const proj of comp.inactiveProjections || []) {
          const sourceId = proj.sender?.mechanism;
          const targetId = proj.receiver?.mechanism;
          if (!sourceId || !targetId) continue;
          if (!nodes.find((n) => n.id === sourceId) || !nodes.find((n) => n.id === targetId)) continue;
          edges.push({
            id: `inactive_${proj.name}`,
            source: sourceId,
            target: targetId,
            sourceHandle: proj.sender?.port || undefined,
            targetHandle: proj.receiver?.port || undefined,
            type: "smoothstep",
            animated: false,
            style: getEdgeStyle("InactiveProjection"),
            markerEnd: getEdgeMarker("InactiveProjection"),
            data: {
              label: `${cleanName(proj.name)} (inactive)`,
              type: "InactiveProjection",
              sender: proj.sender,
              receiver: proj.receiver,
            },
          });
        }
      }
    }

    // --- Synthesize phantom endpoints + dangling edges (#186) ---
    // Statically-detected projections that reference undefined variables.
    // We add a placeholder "missing" node per unique missing name and route
    // the orphan edge into/out of it, so the broken state is visible on the
    // graph instead of being silently dropped.
    const dangling: DanglingProjectionInfo[] = modelData.danglingProjections || [];
    if (dangling.length > 0) {
      const phantomIds = new Map<string, string>(); // missingName → node id
      const ensurePhantom = (
        missingName: string,
        side: "sender" | "receiver" | "both",
      ): string => {
        const existing = phantomIds.get(missingName);
        if (existing) return existing;
        const id = `__dangling__${missingName}`;
        phantomIds.set(missingName, id);
        nodes.push({
          id,
          type: "danglingNode",
          position: { x: 0, y: 0 }, // Dagre will lay it out
          data: { missingName, side },
        });
        return id;
      };

      for (const d of dangling) {
        const dStyle = getEdgeStyle("DanglingProjection");
        const dMarker = getEdgeMarker("DanglingProjection");
        const tooltipLines = [
          `${d.varName} (${d.type})`,
          d.missingSide === "both"
            ? `Both endpoints missing: ${d.missing.join(", ")}`
            : `Missing ${d.missingSide}: ${d.missing.join(", ")}`,
          d.line ? `Declared at line ${d.line} of the .py file.` : "",
        ].filter(Boolean);
        const tooltip = tooltipLines.join("\n");

        // Resolve actual endpoints to existing node ids when possible,
        // and synthesize a phantom for the missing side.
        const senderMissing = d.missingSide === "sender" || d.missingSide === "both";
        const receiverMissing = d.missingSide === "receiver" || d.missingSide === "both";

        const sourceId = senderMissing
          ? ensurePhantom(d.senderRef ?? "?", "sender")
          : d.senderRef
          ? nodes.find((n) => n.id === d.senderRef || (n.data as any)?.varName === d.senderRef)?.id ?? ensurePhantom(d.senderRef, "sender")
          : ensurePhantom("?", "sender");
        const targetId = receiverMissing
          ? ensurePhantom(d.receiverRef ?? "?", "receiver")
          : d.receiverRef
          ? nodes.find((n) => n.id === d.receiverRef || (n.data as any)?.varName === d.receiverRef)?.id ?? ensurePhantom(d.receiverRef, "receiver")
          : ensurePhantom("?", "receiver");

        edges.push({
          id: `__dangling__${d.varName}`,
          source: sourceId,
          target: targetId,
          type: "projectionEdge",
          animated: false,
          style: dStyle,
          markerEnd: dMarker,
          label: d.varName,
          data: {
            label: d.varName,
            type: "DanglingProjection",
            dangling: d,
            tooltip,
            line: d.line,
          },
        });
      }
    }

    // --- Broken connections (#1235) ---
    // A projection PsyNeuLink refused to make (typically a shape mismatch). Its
    // statement was skipped, so the edge used to just vanish, and the only clue
    // was two nodes no longer joined. Draw it, broken, between the nodes it
    // meant to join, carrying PsyNeuLink's reason.
    const broken: BrokenProjectionInfo[] = modelData.brokenProjections || [];
    const nodeFor = (ref: string | null) =>
      ref ? nodes.find((n) => n.id === ref || (n.data as any)?.varName === ref)?.id : undefined;
    for (const b of broken) {
      const sourceId = nodeFor(b.senderRef);
      const targetId = nodeFor(b.receiverRef);
      if (!sourceId || !targetId) continue;
      const tooltip = [
        `${b.varName} (${b.type}) couldn't be made:`,
        b.error,
        b.line ? `Declared at line ${b.line} of the .py file.` : "",
      ].filter(Boolean).join("\n");
      edges.push({
        id: `__broken__${b.varName}`,
        source: sourceId,
        target: targetId,
        type: "projectionEdge",
        animated: false,
        style: getEdgeStyle("DanglingProjection"),
        markerEnd: getEdgeMarker("DanglingProjection"),
        label: `✗ ${b.varName}`,
        data: {
          label: `✗ ${b.varName}`,
          type: "BrokenProjection",
          broken: b,
          tooltip,
          line: b.line,
        },
      });
    }

    // --- Stagger edge labels to prevent overlap ---
    // Resolve overlaps in pixel space using actual node positions.
    // Each label sits at labelOffset (0-1) along the edge. The label's
    // Y position is: sourceNode.y + (targetNode.y - sourceNode.y) * offset.
    // We enforce a minimum vertical gap between any two labels.
    const LABEL_HEIGHT = 20; // px: font 10 + padding + margin
    const MIN_GAP = LABEL_HEIGHT + 4;

    // Build a list of {edgeIndex, yPos} for all projection edges
    const nodeYMap: Record<string, number> = {};
    for (const n of nodes) {
      nodeYMap[n.id] = n.position.y + (NODE_HEIGHT / 2);
    }

    type LabelEntry = { idx: number; y: number; srcY: number; tgtY: number };
    const labels: LabelEntry[] = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.type !== "projectionEdge") continue;
      const srcY = nodeYMap[e.source] ?? 0;
      const tgtY = nodeYMap[e.target] ?? 0;
      const y = srcY + (tgtY - srcY) * 0.5; // initial midpoint
      labels.push({ idx: i, y, srcY, tgtY });
    }

    // Sort by Y position
    labels.sort((a, b) => a.y - b.y);

    // Push apart labels that are too close (greedy sweep)
    for (let pass = 0; pass < 5; pass++) {
      let moved = false;
      for (let i = 1; i < labels.length; i++) {
        const gap = labels[i].y - labels[i - 1].y;
        if (gap < MIN_GAP) {
          const push = (MIN_GAP - gap) / 2 + 0.5;
          labels[i - 1].y -= push;
          labels[i].y += push;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Convert back to labelOffset (clamped to 0.1-0.9)
    for (const lbl of labels) {
      const span = lbl.tgtY - lbl.srcY;
      if (Math.abs(span) < 1) {
        (edges[lbl.idx].data as any).labelOffset = 0.5;
      } else {
        const offset = Math.max(0.1, Math.min(0.9, (lbl.y - lbl.srcY) / span));
        (edges[lbl.idx].data as any).labelOffset = offset;
      }
    }

    // --- Convert GraphStructureConditions to React Flow edges ---
    const allGscConditions: GSCInfo[] = [];
    for (const comp of compositions) {
      const scheduling = comp.scheduling || [];
      for (const gsc of scheduling) {
        allGscConditions.push(gsc);
        for (const targetNode of gsc.nodes) {
          let source: string, target: string;
          let label: string, color: string;

          switch (gsc.type) {
            case "BeforeNode":
            case "BeforeNodes":
              source = gsc.owner; target = targetNode;
              label = "before"; color = "var(--pnv-gsc-before)";
              break;
            case "AfterNode":
            case "AfterNodes":
              source = targetNode; target = gsc.owner;
              label = "after"; color = "var(--pnv-gsc-after)";
              break;
            case "AddEdgeTo":
              source = gsc.owner; target = targetNode;
              label = "+edge"; color = "var(--pnv-gsc-add-edge)";
              break;
            case "RemoveEdgeFrom":
              source = targetNode; target = gsc.owner;
              label = "−edge"; color = "var(--pnv-gsc-remove-edge)";
              break;
            case "WithNode":
              source = gsc.owner; target = targetNode;
              label = "with"; color = "var(--pnv-gsc-with)";
              break;
            default:
              source = gsc.owner; target = targetNode;
              label = gsc.type; color = "var(--pnv-gsc-other)";
              break;
          }

          // Resolve cleaned names to actual node IDs in the graph
          const sourceNode = nodes.find(
            (n) => n.id === source || cleanName(n.id) === source
              || (n.data as any)?.varName === source
          );
          const targetNodeObj = nodes.find(
            (n) => n.id === target || cleanName(n.id) === target
              || (n.data as any)?.varName === target
          );

          if (sourceNode && targetNodeObj) {
            edges.push({
              // One GSC condition expands to several edges (e.g. AfterNodes on
              // STORE → one edge per retrieved node). The id must include BOTH
              // endpoints: for After/Remove the owner is the constant *target*
              // and the source varies, so a target-only id collides and React
              // Flow garbles all but one of the edges (#651).
              id: gscEdgeId(gsc.id, sourceNode.id, targetNodeObj.id),
              source: sourceNode.id,
              target: targetNodeObj.id,
              type: "gscEdge",
              label,
              animated: true,
              style: {
                stroke: color,
                strokeWidth: 2,
                strokeDasharray: "6 3",
              },
              data: {
                gscType: gsc.type,
                gscId: gsc.id,
                owner: gsc.owner,
                targetNode: targetNode,
                nodes: gsc.nodes,
                params: gsc.params,
                label,
                color,
              },
            });
          }
        }
      }
    }

    const { showCIMs } = useGraphSettings.getState();

    // --- Collect basic conditions, termination, and scheduler config ---
    let allBasicConditions: BasicConditionEntry[] = [];
    let allTerminationConditions: Record<string, ConditionInfo> = {};
    let allSchedulerConfig: SchedulerConfig = {};
    for (const comp of compositions) {
      if (comp.basicConditions) allBasicConditions = allBasicConditions.concat(comp.basicConditions);
      if (comp.terminationConditions) allTerminationConditions = { ...allTerminationConditions, ...comp.terminationConditions };
      if (comp.schedulerConfig) allSchedulerConfig = { ...allSchedulerConfig, ...comp.schedulerConfig };
    }

    // #713: in the flat / PyTorch view, wrap each origin composition's nodes in
    // an INSET frame before layout, so the layout machinery lays the members
    // out together inside an accurately-bounded, drag-constrained box. No-op in
    // the nested view. Mutates the `nodes` array in place so the layout +
    // downstream steps see the framed graph.
    {
      const framed = reframeClusters(nodes);
      if (framed !== nodes) {
        nodes.length = 0;
        nodes.push(...framed);
      }
    }

    // Use saved positions if available, otherwise auto-layout via Dagre.
    // NOTE: CIM nodes are added AFTER layout so Dagre sees the original
    // connected graph and produces a good layout. CIMs overlay on top.
    const hasSavedPositions = Object.keys(savedPositions).length > 0;
    const { autoLayout } = get();

    let layoutNodes: Node[];
    if (autoLayout) {
      // Auto layout: compute positions via the active layout engine (#415).
      try {
        const { layoutStyle, direction } = useGraphSettings.getState();
        layoutNodes = applyLayout(layoutStyle, nodes, edges, { direction });
      } catch {
        layoutNodes = nodes; // fallback if layout fails
      }
    } else {
      // Custom layout: Dagre is the baseline; saved positions override
      // per-node so Custom matches Auto when no sidecar exists, and partial
      // sidecars don't leak the sequential auto-placement from
      // processComposition() into the unsaved nodes (#97).
      let dagred: Node[];
      try {
        const { layoutStyle, direction } = useGraphSettings.getState();
        dagred = applyLayout(layoutStyle, nodes, edges, { direction });
      } catch {
        dagred = nodes; // layout failed → keep processComposition() positions
      }
      if (hasSavedPositions) {
        // Apply saved positions to known nodes; collect the rest as "fresh".
        const fresh: Node[] = [];
        layoutNodes = dagred.map((n) => {
          const varName = (n.data as { varName?: string } | undefined)?.varName;
          const saved =
            (varName && savedPositions[varName]) || savedPositions[n.id];
          if (saved) return { ...n, position: saved };
          fresh.push(n);
          return n;
        });
        // #659: flat-view nodes hoisted out of a nested composition have no
        // saved position of their own. Rather than leave them at Dagre
        // coordinates (computed against the *un-anchored* outer nodes, so they
        // scatter once the outer nodes jump to their custom spots), slot each
        // group of them in at the position its composition occupied in the
        // saved layout — preserving Dagre's relative arrangement among them.
        const byParentComp = new Map<string, Node[]>();
        for (const n of fresh) {
          const path = (n.data as { compPath?: string[] } | undefined)?.compPath;
          const parent = path && path.length ? cleanName(path[path.length - 1]) : null;
          if (!parent) continue;
          (byParentComp.get(parent) ?? byParentComp.set(parent, []).get(parent)!).push(n);
        }
        for (const [parent, members] of byParentComp) {
          const anchor = savedPositions[parent];
          if (!anchor) continue; // composition had no saved position → keep Dagre
          const cx = members.reduce((s, m) => s + m.position.x, 0) / members.length;
          const cy = members.reduce((s, m) => s + m.position.y, 0) / members.length;
          for (const m of members) {
            m.position = {
              x: m.position.x - cx + anchor.x,
              y: m.position.y - cy + anchor.y,
            };
          }
        }
      } else {
        layoutNodes = dagred;
      }
    }

    // Auto-size composition group nodes to fit their children
    autoSizeGroups(layoutNodes);

    // Add CIM nodes AFTER layout so the main graph stays connected.
    // CIM nodes are positioned between their connected nodes using
    // the already-computed layout positions.
    if (showCIMs) {
      const CIM_LABELS: Record<string, string> = {
        INPUT_CIM: "Input CIM",
        OUTPUT_CIM: "Output CIM",
        PARAMETER_CIM: "Param CIM",
      };

      for (const comp of compositions) {
        if (!comp.cim) continue;

        // Find CIMs that have connections
        const connectedCIMs = new Set<string>();
        for (const proj of comp.cim.projections) {
          if (proj.sender?.mechanism) connectedCIMs.add(proj.sender.mechanism);
          if (proj.receiver?.mechanism) connectedCIMs.add(proj.receiver.mechanism);
        }

        // Keep resolved cross-composition edges (solid) alongside CIM edges
        // (dashed) so the graph always looks connected.

        // Position CIMs relative to the composition group node.
        // Input CIM goes above the group, Output CIM below, so they
        // sit naturally in the top-down data flow.
        // Find the composition group node. For top-level compositions,
        // use the first (or only) nested group as the anchor point.
        const groupNode = layoutNodes.find(
          (n) => n.type === "compositionNode"
        );
        const groupX = groupNode?.position.x ?? 0;
        const groupY = groupNode?.position.y ?? 0;
        const groupW = (groupNode?.style?.width as number) ?? 300;
        const groupH = (groupNode?.style?.height as number) ?? 200;

        let cimIdx = 0;
        for (const cimNode of comp.cim.nodes) {
          const cimType = cimNode.cimType || "INPUT_CIM";
          if (!connectedCIMs.has(cimNode.name)) continue;

          // Use saved position if available (from custom layout), else compute.
          // CIM names have PNL numeric suffixes that change each load
          // (e.g., "outer_comp-5 Input_CIM" vs "outer_comp-12 Input_CIM"),
          // so strip the suffix for a stable lookup key.
          const cimStableKey = cimNode.name.replace(/-\d+\s/, " ");
          let pos: { x: number; y: number };
          const saved = savedPositions[cimNode.name] || savedPositions[cimStableKey];
          if (saved && !autoLayout) {
            pos = saved;
          } else if (cimType === "INPUT_CIM") {
            pos = { x: groupX + groupW / 2 - 50 + cimIdx * 140, y: groupY - 60 };
          } else if (cimType === "OUTPUT_CIM") {
            pos = { x: groupX + groupW / 2 - 50 + cimIdx * 140, y: groupY + groupH + 20 };
          } else {
            pos = { x: groupX + groupW + 40, y: groupY + cimIdx * 60 };
          }
          cimIdx++;

          layoutNodes.push({
            id: cimNode.name,
            type: "cimNode",
            position: pos,
            data: {
              label: CIM_LABELS[cimType] || cimType.replace(/_/g, " "),
              cimType,
              type: cimNode.type,
              roles: cimNode.roles || [],
              inputPorts: cimNode.inputPorts || [],
              outputPorts: cimNode.outputPorts || [],
              function: cimNode.function || null,
              params: cimNode.params || {},
            },
          });
        }

        // Add CIM projection edges
        for (const proj of comp.cim.projections) {
          const sourceId = proj.sender?.mechanism;
          const targetId = proj.receiver?.mechanism;
          if (!sourceId || !targetId) continue;
          if (!layoutNodes.find((n) => n.id === sourceId) || !layoutNodes.find((n) => n.id === targetId)) continue;
          edges.push({
            id: `cim_${proj.name}`,
            source: sourceId,
            target: targetId,
            type: "smoothstep",
            animated: false,
            style: getEdgeStyle("CIMProjection"),
            markerEnd: getEdgeMarker("CIMProjection"),
            sourceHandle: proj.sender?.port || undefined,
            targetHandle: proj.receiver?.port || undefined,
            data: { label: cleanName(proj.name), type: "CIMProjection", sender: proj.sender, receiver: proj.receiver },
          });
        }
      }
    }

    // Preserve selection across model rebuilds by remapping IDs via varName
    const { selectedNodeId, selectedEdgeId } = get();
    let newSelectedNodeId = selectedNodeId;
    let newSelectedEdgeId = selectedEdgeId;

    if (selectedNodeId) {
      // Check if the ID still exists in new nodes
      if (!layoutNodes.find((n) => n.id === selectedNodeId)) {
        // Try to find by varName
        const oldNode = get().nodes.find((n) => n.id === selectedNodeId);
        const oldVarName = oldNode ? (oldNode.data as any)?.varName : null;
        if (oldVarName) {
          const match = layoutNodes.find((n) => (n.data as any)?.varName === oldVarName);
          newSelectedNodeId = match ? match.id : null;
        } else {
          newSelectedNodeId = null;
        }
      }
    }

    if (selectedEdgeId) {
      if (!edges.find((e) => e.id === selectedEdgeId)) {
        const oldEdge = get().edges.find((e) => e.id === selectedEdgeId);
        const oldVarName = oldEdge ? (oldEdge.data as any)?.varName : null;
        if (oldVarName) {
          const match = edges.find((e) => (e.data as any)?.varName === oldVarName);
          newSelectedEdgeId = match ? match.id : null;
        } else {
          newSelectedEdgeId = null;
        }
      }
    }

    // Tag each edge with its index/size within port-sharing bundles so
    // ProjectionEdge can fan curves apart at shared endpoints (#278).
    annotateEdgeBundles(edges);

    set({
      ...(markSaved ? { savedSource: get().source, previewPath: null } : {}),
      nodes: layoutNodes, edges, lineMap,
      compositionNames: compNames, activeComposition: activeComp, compositionMeta,
      compositionDisplayNames,
      compositionOptions,
      focusedComposition: resolvedFocus, focusPath: resolvedFocusPath,
      gscConditions: allGscConditions,
      basicConditions: allBasicConditions,
      terminationConditions: allTerminationConditions,
      schedulerConfig: allSchedulerConfig,
      modelError: modelData.error || null,
      modelErrorLine: modelData.errorLine || null,
      // Built, so the canvas is the file again (#1030).
      graphIsStale: false,
      // ...and, when it built cleanly, this is the source it was built from
      // (#1154). Guarded: this path is also reached by a model that failed
      // with no previous graph to hold, and recording that as "the last
      // version that built" would be exactly backwards.
      ...(modelData.error
        ? {}
        : { lastGoodSource: get().source, lastGoodAt: Date.now() }),
      shownSkippedErrors: ((modelData.skippedStatements || []) as SkippedStatement[]).map((st) => st.error),
      partialExecution: modelData.partialExecution || false,
      // #879: fold the load-time messages (top-level `warnings` = version
      // mismatch; `notices` = #848 module-level-driver notes) into the
      // persistent Model Diagnostics bar's channels, so they're reviewable
      // per-model instead of flashing as 2s toasts that vanish (and that only
      // the file-open path surfaced at all — reference/demo/example loads
      // dropped them silently). Done in the store so every load path benefits.
      diagnostics: modelData.diagnostics
        ? {
            ...modelData.diagnostics,
            warnings: [
              ...(modelData.diagnostics.warnings || []),
              ...(modelData.warnings || []),
            ],
            notices: [
              ...(modelData.diagnostics.notices || []),
              ...(modelData.notices || []),
            ],
          }
        : null,
      danglingProjections: dangling,
      brokenProjections: broken,
      inputSets: modelData.inputSets || [],
      selectedNodeId: newSelectedNodeId, selectedEdgeId: newSelectedEdgeId,
      // #659: remember the full saved layout so the next save can merge over
      // it — keeps positions for nodes not currently rendered (e.g. a nested
      // composition's group node while flattened, or its inner nodes while
      // nested), so flat↔nested round-trips don't clobber each other.
      lastLayoutPositions: savedPositions,
    });
    // #282: hydrate dragged-port overrides from the sidecar. Persisted keyed by
    // varName (like positions); remap to the runtime node ids the graph uses.
    const savedPorts = (layout as any)?.portPositions as
      | Record<string, Record<string, number>>
      | undefined;
    if (savedPorts) {
      const varToId: Record<string, string> = {};
      for (const n of layoutNodes) {
        const vn = (n.data as any)?.varName || n.id;
        varToId[vn] = n.id;
      }
      const byId: Record<string, Record<string, number>> = {};
      for (const [vn, ports] of Object.entries(savedPorts)) {
        byId[varToId[vn] || vn] = ports;
      }
      usePortLayout.getState().hydrate(byId);
    } else {
      usePortLayout.getState().clearAll();
    }
    // #1387: each node's value view (list or grid). Only a load that brings a
    // layout decides it: a preview of unsaved edits, or the file watcher's
    // reload, passes none, and the choices on screen stay.
    if (layout !== undefined) useValueViews.getState().hydrate(layout?.valueViews);

    // #1162: hand-shaped edges. Resolved by endpoint rather than by projection
    // name, so a renamed projection keeps its shape; edges whose key more than
    // one edge claims are skipped rather than guessed at.
    const savedRoutes = (layout as any)?.[
      useGraphSettings.getState().flat || useGraphSettings.getState().pytorch
        ? "flatEdgeRoutes"
        : "edgeRoutes"
    ] as EdgeRouteMap | undefined;
    useEdgeAttach
      .getState()
      .hydrate(hydrateRoutes(edges as unknown as RoutableEdge[], savedRoutes));
    // Push snapshot for undo history
    // setTimeout ensures set() above takes effect before snapshot capture
    setTimeout(() => recordAction("Model updated"), 0);
  },
}));

// #431: expose the store on window in dev so E2E verifications can
// drive selection state directly. Production builds strip this branch
// (Vite eliminates ``import.meta.env.DEV`` dead code).
if (typeof window !== "undefined" && (import.meta as any).env?.DEV) {
  (window as any).__modelStore = useModelStore;
}

/**
 * The path to execute for what the user is currently looking at (#1029).
 *
 * `filePath` is the model's identity — it is what sidecars, layouts and labels
 * are keyed to, and what Save writes. It is not always what should be *run*:
 * while the buffer has unsaved edits, running the file on disk would run code
 * the user is not looking at. Run, Learn and Show Graph use this instead.
 */
export const selectExecPath = (s: ModelState): string | null =>
  s.previewPath ?? s.filePath;
