/**
 * The main React Flow graph canvas.
 * Renders PsyNeuLink mechanisms as nodes and projections as edges.
 * Handles: drag layout saving, new connections → projections, node deletion.
 */

import { CanvasContextMenu, EdgeContextMenu } from "./GraphMenus";
import { arrowShaped, reshapeDescription, startShapingArrow } from "@/utils/arrowShapes";
import { PortChooser, type ConnectionOption } from "./PortChooser";
import { ConnectionLine } from "./ConnectionLine";
import { CONNECT_GESTURE, CONNECT_HANDLE, NODE_TARGET_HANDLE } from "./connectHandles";
import { useConnectTargets } from "@/stores/connectTargetsStore";
import { registerVisibleCentre } from "@/utils/graphViewport";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type OnConnect,
  type OnConnectStart,
  type FinalConnectionState,
  type OnNodeDrag,
  type Connection,
  type NodeChange,
  addEdge,
} from "@xyflow/react";
import { useFitGraph } from "@/hooks/useFitGraph";
import { computeShiftTable, shiftPosition, unshiftPosition } from "@/utils/viewTransform";

import { useModelStore, type MechanismData, autoSizeGroups, fitFramesAndMakeRoom, usesFlatPositions } from "@/stores/modelStore";
import { recordAction } from "@/utils/history";
import { useNotificationStore } from "@/stores/notificationStore";
import { useStatusStore } from "@/stores/statusStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { usePaletteStore } from "@/stores/paletteStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { MechanismNode } from "./MechanismNode";
import { CompositionNode } from "./CompositionNode";
import { CIMNode } from "./CIMNode";
import { DanglingNode } from "./DanglingNode";
import { EDGE_MENU_EVENT, GSCEdge } from "./GSCEdge";
import { ProjectionEdge } from "./ProjectionEdge";
import { GSCLegend } from "./GSCLegend";
import { FailedOpenBanner, useFailedOpenShowing } from "./FailedOpenBanner";
import { useSchedulingArrowsStore } from "@/stores/schedulingArrowsStore";
import { TraceControls } from "./TraceControls";
import { ValidationPanel } from "./ValidationPanel";
import { FocusBreadcrumb } from "./FocusBreadcrumb";
import { GraphToolbar } from "./GraphToolbar";
import { PaletteSidebar } from "./PaletteSidebar";
import { NodeContextMenu } from "./NodeContextMenu";
import { OffscreenNodesIndicator } from "./OffscreenNodesIndicator";
import { TourOverlay } from "./TourOverlay";
import { addNodeToModel, deleteProjection, deleteSchedulingCondition, FUNCTION_NEEDS_MECHANISM, functionRefusal, renameProjection, setMechanismFunction } from "@/utils/nodeActions";
import { isFunctionType } from "@/constants/pnlTypes";
import { isProjectionType, findDefByType } from "@/constants/pnlTypes";
import { inNodeLayer } from "./canvasLayers";
import { registerCommand } from "@/shortcuts/commands";
import { useShortcutKeys } from "@/shortcuts/useAppShortcuts";
import { useFitButtonStyleStore } from "@/stores/fitButtonStyleStore";
import { LastGoodDiff } from "./LastGoodDiff";
import { serializeRoutes, type RoutableEdge } from "@/utils/edgeRoutes";
import { positionsOnScreen } from "@/utils/positionsOnScreen";
import { registerArrowShapeCommit } from "@/utils/arrowShapes";
import { useEdgeAttach } from "@/stores/edgeAttachStore";
import { prunePositions } from "@/utils/prunePositions";
import { useGraphPointerStore } from "@/stores/graphPointerStore";
import { graphCursorVars, graphPointerClass } from "@/utils/graphCursor";
import { modelLoadOptions, modelViewOptions } from "@/utils/showGraphLoadRequest";
import { clampIoDrag, tidyIoRows } from "@/utils/ioRows";
import { ioRowsNotApplying, registerCanvasTidy, useIoRowsStore } from "@/stores/ioRowsStore";
import { noteLayoutMove } from "@/utils/layoutMoves";

/** How long after a model opens (or the view switches) the graph may still settle and be re-fitted (#346). */
const FIT_SETTLE_MS = 1500;

/** A Mac, judged as the graph library judges it (by the user agent). */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** #261: Command (Ctrl off the Mac) and Shift both add to or take from the selection. */
const MULTI_SELECT_KEYS = IS_MAC ? ["Meta", "Shift"] : ["Control", "Shift"];

/**
 * #261: on a Mac, Control-click is a secondary click. macOS usually turns it
 * into one before the page sees it, but not always (nor in a browser told it
 * is on a Mac), so a Control-click that arrives as a click is routed to the
 * menu here.
 */
const isMacSecondaryClick = (e: React.MouseEvent | MouseEvent) => IS_MAC && e.ctrlKey && !e.metaKey;

const nodeTypes = {
  mechanismNode: MechanismNode,
  compositionNode: CompositionNode,
  cimNode: CIMNode,
  danglingNode: DanglingNode,
};

const edgeTypes = {
  gscEdge: GSCEdge,
  projectionEdge: ProjectionEdge,
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveLayoutDebounced(filePath: string, nodes: any[]) {
  // Every move the user makes is saved through here: count it, so a layout
  // reload already on its way doesn't put the nodes back (#444).
  noteLayoutMove();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // #697/#713: cluster frames are never saved; CIMs by a stable key.
    const positions = positionsOnScreen(nodes);
    // #659: merge over the last loaded layout so positions for nodes not
    // currently on the canvas survive — e.g. a nested composition's group node
    // while flattened — keeping flat↔nested round-trips intact.
    // #1160: drop entries for nodes the model no longer has, so a name reused
    // later does not inherit a stranger's coordinates. The rules about what it
    // refuses to drop live with the helper, which is where they are tested.
    const store = useModelStore.getState();
    const merged = prunePositions({
      saved: store.lastLayoutPositions,
      current: positions,
      declared: new Set(Object.keys(store.lineMap || {})),
    });
    // Keep the snapshot of what is persisted current (#1163). It was only set
    // on load, so a node dragged a moment ago still read as automatic — and the
    // merge above was working from a stale map too.
    useModelStore.setState({ lastLayoutPositions: merged });
    // #719: flat / PyTorch view positions go to their own namespace so their
    // frame-relative coords never clobber the nested view's.
    // #1162: hand-shaped edges ride along with the positions save. Keyed by
    // endpoint rather than projection name, and only edges the user actually
    // shaped are written — grabbing a handle materialises the router's own
    // corners, and freezing those would stop the edge adapting.
    const ea = useEdgeAttach.getState();
    const routes = serializeRoutes(
      useModelStore.getState().edges as unknown as RoutableEdge[],
      ea.shaped,
      ea.waypoints,
      ea.overrides,
      ea,
    );
    const body = usesFlatPositions()
      ? { file_path: filePath, flatPositions: merged, flatEdgeRoutes: routes }
      : { file_path: filePath, positions: merged, edgeRoutes: routes };
    fetch("/api/model/save-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, 500);
}

/** The arrow (a projection the file declares) under a screen point, if any
 * (#253 stage 3): where a dragged connection from a learning mechanism was
 * let go. Its wide hit path is what the pointer is over. */
export function arrowAt(x: number, y: number): { varName: string; label: string } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!el.classList.contains("projection-edge-hit")) continue;
    const id = el.closest(".react-flow__edge")?.getAttribute("data-id");
    const edge = id ? useModelStore.getState().edges.find((ed) => ed.id === id) : undefined;
    const d = (edge?.data ?? {}) as { varName?: string; label?: string };
    if (edge?.type === "projectionEdge" && d.varName) return { varName: d.varName, label: d.label || d.varName };
  }
  return null;
}

async function createProjectionOnServer(
  filePath: string,
  sourceNode: string,
  targetNode: string,
  compVarName: string,
  setSource: (s: string) => void,
  loadModel: (m: any, l?: any) => void,
  senderPort?: string,
  receiverPort?: string,
  projType?: string,
  // #253 stage 3: a control, gating or learning projection names the kind of
  // port it goes into and, from PsyNeuLink's answer, its own variable.
  extra?: { receiverPortKind?: string; varName?: string },
) {
  const { setStatus, clearStatus } = useStatusStore.getState();
  const projName = extra?.varName || `${sourceNode}_to_${targetNode}`.replace(/-\d+/g, "");
  recordAction(`Added projection ${sourceNode} → ${targetNode}`);
  setStatus(`Adding projection: ${projName}...`);
  try {
    const changes: Record<string, string> = {
      action: "add_projection",
      var_name: projName,
      sender: sourceNode.replace(/-\d+$/, ""),
      receiver: targetNode.replace(/-\d+$/, ""),
      composition: compVarName,
    };
    if (senderPort) changes.sender_port = senderPort;
    if (receiverPort) changes.receiver_port = receiverPort;
    if (projType) changes.type = projType;
    if (extra?.receiverPortKind) changes.receiver_port_kind = extra.receiverPortKind;

    const resp = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, ...modelViewOptions(), changes }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    // #353: if what this wrote doesn't run, the warning names this connection.
    useModelStore.getState().noteGraphEdit("connect", `${changes.sender} to ${changes.receiver}`);
    setSource(data.source);
    loadModel(data.model, data.layout);
  } catch {
    // Silently fail — connection will be reverted on next model load
  } finally {
    clearStatus();
  }
}

// Persist a basic scheduler condition (#385). Mirrors the Inspector's
// add_basic_condition call: the owner runs per `conditionType`, with `args`
// naming any dependency. e.g. WhenFinished + {dependency: "responseLayer"} →
// `comp.scheduler.add_condition(decisionGate, pnl.WhenFinished(responseLayer))`.
async function addBasicConditionOnServer(
  filePath: string,
  composition: string,
  ownerVar: string,
  conditionType: string,
  args: Record<string, unknown>,
  setSource: (s: string) => void,
  loadModel: (m: any, l?: any) => void
) {
  const { setStatus, clearStatus } = useStatusStore.getState();
  setStatus(`Adding condition: ${ownerVar} ${conditionType}...`);
  try {
    const resp = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: filePath, ...modelViewOptions(),
        changes: {
          action: "add_basic_condition",
          composition,
          owner_var: ownerVar,
          condition_type: conditionType,
          args,
        },
      }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    setSource(data.source);
    loadModel(data.model, data.layout);
  } catch {
    // Silently fail — condition will be absent on next model load
  } finally {
    clearStatus();
  }
}

async function deleteNodeOnServer(
  filePath: string,
  varNames: string | string[],
  setSource: (s: string) => void,
  loadModel: (m: any, l?: any) => void,
  addNotification: (type: any, msg: string) => void,
) {
  // #261: several at once is one change to the file, so one Undo.
  const names = Array.isArray(varNames) ? varNames : [varNames];
  const varName = names.join(", ");
  const { setStatus, clearStatus } = useStatusStore.getState();
  setStatus(`Removing ${names.length > 1 ? "nodes" : "node"}: ${varName}...`);
  try {
    const resp = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: filePath, ...modelViewOptions(),
        changes:
          names.length > 1
            ? { action: "remove_nodes", var_names: names }
            : { action: "remove_node", var_name: names[0] },
      }),
    });
    if (!resp.ok) {
      // #1092: this used to `return` silently. React Flow has already taken the
      // node off the canvas by then, so a quiet return left the user looking at
      // a deletion that never reached the file — the graph lying about the code.
      let detail = "the file couldn't be edited";
      try {
        const err = await resp.json();
        if (err?.detail) detail = err.detail;
      } catch {
        // Not JSON; the generic wording stands.
      }
      addNotification("error", `Failed to delete node: ${detail}`);
      await resyncFromFile(filePath, setSource, loadModel);
      return;
    }
    const data = await resp.json();
    setSource(data.source);
    loadModel(data.model, data.layout);
    recordAction(`Deleted ${names.length > 1 ? "nodes" : "node"} ${varName}`);
  } catch (e) {
    addNotification("error", `Failed to delete node: ${e}`);
    await resyncFromFile(filePath, setSource, loadModel);
  } finally {
    clearStatus();
  }
}

/// Re-read the model from disk so a refused edit cannot leave the canvas
/// showing something the file does not contain. (#1092)
async function resyncFromFile(
  filePath: string,
  setSource: (s: string) => void,
  loadModel: (m: any, l?: any) => void,
) {
  try {
    const resp = await fetch("/api/model/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, ...modelLoadOptions() }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    setSource(data.source);
    loadModel(data.model, data.layout);
  } catch {
    // The error notification above already told the user the edit did not take.
  }
}

export function GraphCanvas() {
  const storeNodes = useModelStore((s) => s.nodes);
  const storeEdges = useModelStore((s) => s.edges);
  const filePath = useModelStore((s) => s.filePath);
  const setSource = useModelStore((s) => s.setSource);
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const setSelectedNodeId = useModelStore((s) => s.setSelectedNodeId);
  const autoLayout = useModelStore((s) => s.autoLayout);
  const pointer = useGraphPointerStore((s) => s.pointer);
  const pointerSize = useGraphPointerStore((s) => s.size);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const showProjectionLabels = useGraphSettings((s) => s.showProjectionLabels);
  const showDimensions = useGraphSettings((s) => s.showDimensions);
  // View-state inputs to the rendering transform (refs #288). Reading
  // them via the settings store keeps `nodes` in canonical space; the
  // transform happens only at the React Flow boundary below.
  const showFullTypes = useGraphSettings((s) => s.showFullTypes);
  const direction = useGraphSettings((s) => s.direction);

  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    nodeLabel: string;
    nodeType: string;
    x: number;
    y: number;
    /** #261: the multi-selection the clicked node is part of, when there is one. */
    selection?: { id: string; label: string; varName?: string }[];
  } | null>(null);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const { screenToFlowPosition, getInternalNode, zoomTo } = useReactFlow();
  const fitGraph = useFitGraph();
  // #289: the keys fire the same fit as the button, the canvas menu and the
  // off-screen badge; ⌘0 is actual size, about the canvas's centre, as in
  // Preview.
  const fitKeys = useShortcutKeys("view.fitGraph", "view.fitGraphShift");
  const fitButtonStyle = useFitButtonStyleStore((s) => s.style);
  useEffect(() => registerCommand("graph.fit", fitGraph), [fitGraph]);
  useEffect(
    () => registerCommand("graph.actualSize", () => void zoomTo(1)),
    [zoomTo]
  );
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Re-fit the graph when panes are shown/hidden (#226), or the failed-open strip (#401). The canvas resizes
  // as the layout reflows, so without this the graph stays cramped or
  // off-center in its new footprint. Skip the first render — the initial fit
  // is handled by the load effect / ReactFlow's fitView prop.
  const codeVisible = useLayoutStore((s) => s.codeVisible);
  const graphVisible = useLayoutStore((s) => s.graphVisible);
  const bottomVisible = useLayoutStore((s) => s.bottomVisible);
  // #401: the failed-open strip takes its height from the canvas, so the
  // graph is fitted again when it comes and goes, and no node is cut off.
  const failedOpenShowing = useFailedOpenShowing();
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (!graphVisible) return;
    // Wait for the Allotment reflow to settle before measuring.
    const t = setTimeout(fitGraph, 120);
    return () => clearTimeout(t);
  }, [codeVisible, graphVisible, bottomVisible, failedOpenShowing, fitGraph]);

  // Per-node shift table for the current view state (refs #288). The
  // table is rebuilt whenever the node set or a label-affecting toggle
  // changes; it freezes between those events, so positions don't drift
  // as the user drags.
  const shiftTable = useMemo(
    () => computeShiftTable(nodes, { showFullTypes }, direction),
    [nodes, showFullTypes, direction],
  );

  // Rendered nodes: canonical positions mapped through the shift. This
  // is what React Flow draws; the local `nodes` array stays canonical.
  const displayNodes = useMemo(
    () =>
      // #250: every node above every arrow (canvasLayers explains why).
      nodes.map((n) => inNodeLayer({
        ...n,
        position: shiftPosition(n.id, n.position, shiftTable),
      })),
    [nodes, shiftTable],
  );

  // #219: Settings ▸ Appearance ▸ Keep inputs on the bottom and outputs on
  // top, Also while dragging: inputs and outputs slide along their row, and
  // other nodes stay between the two rows, where the layout has a bottom and
  // a top.
  const ioRows = useIoRowsStore((s) => s.ioRows);
  const layoutStyle = useGraphSettings((s) => s.layoutStyle);
  const keepIoRowsWhileDragging = ioRows === "drag" && !ioRowsNotApplying(layoutStyle, direction);

  // Inverse-transform position changes from React Flow before they hit
  // canonical state — drag deltas arrive in rendered space.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const remapped = changes.map((c) => {
        if (c.type === "position" && c.position) {
          let position = unshiftPosition(c.id, c.position, shiftTable);
          const node = keepIoRowsWhileDragging ? nodesRef.current.find((n) => n.id === c.id) : undefined;
          if (node) position = clampIoDrag(node, position, nodesRef.current);
          return { ...c, position };
        }
        return c;
      });
      onNodesChangeRaw(remapped);
    },
    [onNodesChangeRaw, shiftTable, keepIoRowsWhileDragging],
  );

  // #53: Settings ▸ Appearance can hide scheduling-condition arrows, as
  // show_graph draws none. Filtered here, so switching needs no reload.
  const schedulingArrows = useSchedulingArrowsStore((s) => s.arrows);

  useEffect(() => {
    setNodes(storeNodes);
    // Apply label visibility and dimension annotations to edges
    const shownEdges =
      schedulingArrows === "hidden" ? storeEdges.filter((e) => e.type !== "gscEdge") : storeEdges;
    const displayEdges = shownEdges.map((e) => {
      const d = e.data as any;
      let label: string | undefined;
      if (showProjectionLabels) {
        label = d?.label || (e.label as string);
        if (showDimensions && d?.matrixShape) {
          label = (label || "") + ` (${d.matrixShape.join("x")})`;
        }
      } else if (showDimensions && d?.matrixShape) {
        label = `(${d.matrixShape.join("x")})`;
      }
      return {
        ...e,
        label,
        labelStyle: label ? { fontSize: 10, fontFamily: "monospace", fill: "var(--pnv-text-secondary)" } : undefined,
        labelBgStyle: label ? { fill: "var(--pnv-surface)", fillOpacity: 0.85 } : undefined,
        labelBgPadding: label ? [4, 2] as [number, number] : undefined,
        labelBgBorderRadius: label ? 3 : undefined,
      };
    });
    setEdges(displayEdges);
  }, [storeNodes, storeEdges, setNodes, setEdges, showProjectionLabels, showDimensions, schedulingArrows]);

  // #346: fit the graph in view only when what is shown changes: a model
  // opened, a switch of view (nested or not, the composition shown or
  // focused), or a new layout. Adding, moving or deleting a node never moves
  // the view; Fit (the button, ⌘9 / ⌘0) stays a separate action. This used to
  // fit after every change to the nodes, so an added node seemed to land in
  // the wrong place as the whole graph zoomed and shifted under it.
  const graphFitSeq = useModelStore((s) => s.graphFitSeq);
  const activeComposition = useModelStore((s) => s.activeComposition);
  const focusedComposition = useModelStore((s) => s.focusedComposition);
  const fitKey = `${graphFitSeq}|${activeComposition}|${focusedComposition}|${layoutStyle}|${direction}`;
  // A newly shown graph can settle over the next moments (the Layered layout
  // runs again once boxes are measured, #72), so changes just after keep
  // fitting; later ones are edits and leave the view alone.
  const fittedRef = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    if (storeNodes.length === 0) return;
    const now = Date.now();
    const last = fittedRef.current;
    if (last && last.key === fitKey) {
      if (now - last.at > FIT_SETTLE_MS) return;
    } else {
      fittedRef.current = { key: fitKey, at: now };
    }
    setTimeout(fitGraph, 50);
  }, [fitKey, storeNodes, fitGraph]);

  // When user draws a connection between nodes → create a projection
  // #253: a connection dragged from a node's connector to anywhere on
  // another node. What it connects is PsyNeuLink's answer, not a guess:
  // one option is made at once, several ask which input, a refusal says why.
  const [portChooser, setPortChooser] = useState<{
    x: number; y: number; sender: string; receiver: string; receiverLabel: string; ask?: string; options: ConnectionOption[];
  } | null>(null);
  // `onArrow`: dropped on an arrow (#253 stage 3, a learning mechanism trains
  // its matrix); `targetId` is then the arrow's variable, not a node id.
  const connectFromDrag = useCallback(async (sourceId: string, targetId: string, onArrow?: { x: number; y: number; label: string }) => {
    if (!filePath) return;
    const node = (id: string) => nodesRef.current.find((n) => n.id === id);
    const varOf = (id: string) => ((node(id)?.data as any)?.varName as string) || id;
    const sender = varOf(sourceId), receiver = onArrow ? targetId : varOf(targetId);
    const resp = await fetch("/api/model/connection-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, sender, receiver }),
    });
    if (!resp.ok) {
      addNotification("error", "Couldn't work out what to connect.");
      return;
    }
    const data = await resp.json();
    if (data.refused) {
      addNotification("info", data.refused);
      return;
    }
    const options: ConnectionOption[] = data.options || [];
    if (options.length === 1) {
      void makeDraggedConnection(options[0].sender || sender, options[0].receiver || receiver, options[0]);
      return;
    }
    const el = onArrow ? null : document.querySelector(`.react-flow__node[data-id="${CSS.escape(targetId)}"]`);
    const box = el?.getBoundingClientRect();
    setPortChooser({
      x: onArrow ? onArrow.x : box ? box.left + box.width / 2 : 200,
      y: onArrow ? onArrow.y + 6 : box ? box.bottom + 6 : 200,
      sender, receiver, ask: data.ask, options,
      receiverLabel: onArrow ? onArrow.label : ((node(targetId)?.data as any)?.label as string) || receiver,
    });
  }, [filePath, addNotification]);
  const makeDraggedConnection = useCallback(async (sender: string, receiver: string, o: ConnectionOption) => {
    if (!filePath) return;
    const resp = await fetch("/api/model/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, ...modelLoadOptions() }),
    });
    const data = await resp.json();
    // Into a collapsed composition, PsyNeuLink names the composition holding
    // both ends; otherwise the model's first one, as before.
    const compVarName = o.composition || data.model?.compositions?.[0]?.varName;
    if (!compVarName) return;
    createProjectionOnServer(
      filePath, sender, receiver, compVarName, setSource, loadModelFromServer,
      o.sender_port, o.receiver_port, o.type,
      { receiverPortKind: o.receiver_port_kind, varName: o.var_name },
    );
  }, [filePath, setSource, loadModelFromServer]);

  // #253: while a connection is dragged from a node's connector, PsyNeuLink
  // says which nodes it could be dropped on; they light up, the rest dim.
  const onConnectStart: OnConnectStart = useCallback((_e, { nodeId, handleId }) => {
    if (!filePath || !nodeId || handleId !== CONNECT_HANDLE) return;
    const n = nodesRef.current.find((x) => x.id === nodeId);
    const sender = ((n?.data as any)?.varName as string) || nodeId;
    useConnectTargets.getState().start(sender);
    void fetch("/api/model/connection-targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, sender }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.targets) useConnectTargets.getState().answer(sender, data.targets); })
      .catch(() => {});
  }, [filePath]);
  // #253 stage 3: a drag from a node's connector let go on an arrow rather
  // than a node: a learning mechanism trains that arrow's matrix (anything
  // else is refused, with PsyNeuLink's reason). Arrows aren't React Flow
  // drop targets, so the arrow is the one under the pointer.
  const onConnectEnd = useCallback((e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    useConnectTargets.getState().clear();
    if (state.toNode || state.fromHandle?.id !== CONNECT_HANDLE || !state.fromNode) return;
    const pt = "changedTouches" in e ? e.changedTouches[0] : e;
    if (!pt) return;
    const arrow = arrowAt(pt.clientX, pt.clientY);
    if (!arrow) return;
    void connectFromDrag(state.fromNode.id, arrow.varName, { x: pt.clientX, y: pt.clientY, label: arrow.label });
  }, [connectFromDrag]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target
          && (connection.sourceHandle === CONNECT_HANDLE || connection.targetHandle === NODE_TARGET_HANDLE)) {
        void connectFromDrag(connection.source, connection.target);
        return;
      }
      // Optimistic: add edge locally
      setEdges((eds) => addEdge(connection, eds));

      // Then persist to .py file
      if (filePath && connection.source && connection.target) {
        const senderPort = connection.sourceHandle || undefined;
        const receiverPort = connection.targetHandle || undefined;
        // Need composition varName
        const loadAndConnect = async () => {
          const resp = await fetch("/api/model/load", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: filePath, ...modelLoadOptions() }),
          });
          const data = await resp.json();
          const compVarName = data.model?.compositions?.[0]?.varName;
          if (compVarName) {
            createProjectionOnServer(
              filePath,
              connection.source!,
              connection.target!,
              compVarName,
              setSource,
              loadModelFromServer,
              senderPort,
              receiverPort
            );
          }
        };
        loadAndConnect();
      }
    },
    [filePath, setEdges, setSource, loadModelFromServer, connectFromDrag]
  );

  const setSelectedEdgeId = useModelStore((s) => s.setSelectedEdgeId);
  const pendingConditionGesture = useModelStore((s) => s.pendingConditionGesture);
  const setPendingConditionGesture = useModelStore((s) => s.setPendingConditionGesture);
  const pendingProjectionGesture = useModelStore((s) => s.pendingProjectionGesture);
  const setPendingProjectionGesture = useModelStore((s) => s.setPendingProjectionGesture);

  // #252: a component picked up in the panel goes where the graph is clicked.
  const armed = usePaletteStore((s) => s.armed);
  // #348/#349: a function isn't a node. It goes onto a mechanism, as its
  // function=, and is never written into the code by itself. Picked up and
  // clicked, or dragged and dropped (#354): the same checks, the same change.
  // True when the function was put on the mechanism.
  const putFunctionOn = useCallback((fnType: string, onNode?: { id: string; type?: string; data?: any }): boolean => {
    if (!filePath) return false;
    if (onNode?.type !== "mechanismNode") {
      addNotification("warning", FUNCTION_NEEDS_MECHANISM);
      return false;
    }
    const d = onNode.data;
    const refusal = functionRefusal(d, fnType);
    if (refusal) {
      addNotification("warning", refusal);
      return false;
    }
    void setMechanismFunction(
      filePath, d?.varName || onNode.id, d?.label || d?.varName || onNode.id, fnType,
      setSource, loadModelFromServer, addNotification,
    );
    usePaletteStore.getState().addRecentlyUsed(fnType);
    return true;
  }, [filePath, setSource, loadModelFromServer, addNotification]);

  const placeArmed = useCallback((e: React.MouseEvent | MouseEvent, onNode?: { id: string; type?: string; parentId?: string; data?: any }): boolean => {
    const pick = usePaletteStore.getState().armed;
    if (!pick || !filePath) return false;
    if (isFunctionType(pick.type)) {
      // Refused, the pick stays; put on, it is put down unless Option is held.
      if (putFunctionOn(pick.type, onNode) && !e.altKey) usePaletteStore.getState().setArmed(null);
      return true;
    }
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // Inside a composition, it goes into that composition: the frame of the
    // node clicked, or else the innermost open frame around the point. (Open
    // frames are click-through, #250, so a click inside one reaches the canvas
    // or an arrow, not the frame.) Its position is then kept relative to the
    // frame, as every node inside one is.
    const frameAt = (): string | undefined => {
      let best: { id: string; area: number } | undefined;
      for (const n of nodesRef.current) {
        if (n.type !== "compositionNode") continue;
        const inode = getInternalNode(n.id);
        const w = inode?.measured?.width, h = inode?.measured?.height;
        if (!inode || !w || !h) continue;
        const { x, y } = inode.internals.positionAbsolute;
        if (at.x < x || at.x > x + w || at.y < y || at.y > y + h) continue;
        if (!best || w * h < best.area) best = { id: n.id, area: w * h };
      }
      return best?.id;
    };
    const frameId =
      onNode?.type === "compositionNode" ? onNode.id : onNode?.parentId ?? frameAt();
    const frame = frameId ? getInternalNode(frameId) : undefined;
    // A frame's id can carry the view's prefix ("cluster::inner"); the file
    // knows the composition by its own name.
    const composition = (frame?.data as { varName?: string } | undefined)?.varName?.replace(/^cluster::/, "");
    const origin = composition ? frame!.internals.positionAbsolute : null;
    addNodeToModel(
      filePath, pick.type, pick.defaults, setSource, loadModelFromServer, addNotification,
      origin ? { x: at.x - origin.x, y: at.y - origin.y } : at,
      composition,
    );
    usePaletteStore.getState().addRecentlyUsed(pick.type);
    // Option (Alt) keeps it picked up, for putting down several.
    if (!e.altKey) usePaletteStore.getState().setArmed(null);
    return true;
  }, [filePath, setSource, loadModelFromServer, addNotification, screenToFlowPosition, getInternalNode, putFunctionOn]);
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") usePaletteStore.getState().setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);
  // Anything added with no point chosen goes in the middle of what's showing.
  useEffect(() => {
    registerVisibleCentre(() => {
      const pane = containerRef.current?.querySelector(".react-flow__pane")?.getBoundingClientRect();
      if (!pane || pane.width === 0) return null;
      return screenToFlowPosition({ x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 });
    });
    return () => registerVisibleCentre(null);
  }, [screenToFlowPosition]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: any) => {
      // #252: a component picked up goes where you click, on a node too, and
      // into the composition clicked inside.
      if (placeArmed(_, node)) return;
      // If a projection gesture is armed (#311), a projection was dropped onto
      // a receiver node and this click names the sender. Clicking the receiver
      // itself cancels (no self-projection from this gesture).
      const projGesture = useModelStore.getState().pendingProjectionGesture;
      if (projGesture) {
        setPendingProjectionGesture(null);
        if (node.id === projGesture.receiverNodeId) return;
        const senderVar = (node.data as any)?.varName || node.id;
        const connectAndCreate = async () => {
          const resp = await fetch("/api/model/load", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: filePath, ...modelLoadOptions() }),
          });
          const data = await resp.json();
          const compVarName = data.model?.compositions?.[0]?.varName;
          if (compVarName && filePath) {
            createProjectionOnServer(
              filePath,
              senderVar,
              projGesture.receiverVarName,
              compVarName,
              setSource,
              loadModelFromServer,
              undefined,
              undefined,
              projGesture.projType
            );
          }
        };
        connectAndCreate();
        return;
      }

      // If a scheduler-condition gesture is armed (#385), this click names the
      // dependency rather than selecting. Clicking the owner itself cancels.
      const gesture = useModelStore.getState().pendingConditionGesture;
      if (gesture) {
        setPendingConditionGesture(null);
        if (node.id === gesture.ownerNodeId) return;
        const targetVar = (node.data as any)?.varName || node.id;
        const comp =
          useModelStore.getState().activeComposition ||
          useModelStore.getState().compositionNames[0];
        if (comp && filePath) {
          recordAction(
            `${gesture.ownerVarName} ${gesture.conditionType}(${targetVar})`
          );
          addBasicConditionOnServer(
            filePath,
            comp,
            gesture.ownerVarName,
            gesture.conditionType,
            { dependency: targetVar },
            setSource,
            loadModelFromServer
          );
        }
        return;
      }
      // #261: a plain click on a node inside a multi-selection selects just
      // that node, as in Finder. The graph library keeps the group (so it can
      // be dragged together); a click, not a drag, is the user picking one.
      if (!(_.metaKey || _.ctrlKey || _.shiftKey) && nodesRef.current.some((n) => n.selected && n.id !== node.id)) {
        setNodes((ns) => ns.map((n) => (n.selected === (n.id === node.id) ? n : { ...n, selected: n.id === node.id })));
      }
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId, setPendingConditionGesture, setPendingProjectionGesture, filePath, setSource, loadModelFromServer, setNodes, placeArmed]
  );

  // Esc cancels an armed condition gesture.
  useEffect(() => {
    if (!pendingConditionGesture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingConditionGesture(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingConditionGesture, setPendingConditionGesture]);

  // Esc cancels an armed projection gesture (#311).
  useEffect(() => {
    if (!pendingProjectionGesture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingProjectionGesture(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingProjectionGesture, setPendingProjectionGesture]);

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: any) => {
      e.preventDefault();
      // #261: a secondary click on an unselected node makes it the selection,
      // so the menu is about what is selected; inside a selection, the
      // selection stays.
      if (!node.selected) {
        setNodes((ns) => ns.map((n) => (n.selected === (n.id === node.id) ? n : { ...n, selected: n.id === node.id })));
        setEdges((es) => es.map((ed) => (ed.selected ? { ...ed, selected: false } : ed)));
        setSelectedNodeId(node.id);
      }
      setGraphMenu(null);
      const label = (node.data as any)?.label || node.id;
      // Inside a multi-selection, the menu acts on all of it (#261).
      const selected = node.selected ? nodesRef.current.filter((n) => n.selected) : [];
      const selection =
        selected.length > 1
          ? selected.map((n) => ({ id: n.id, label: (n.data as any)?.label || n.id, varName: (n.data as any)?.varName }))
          : undefined;
      setContextMenu({ nodeId: node.id, nodeLabel: label, nodeType: node.type || "", x: e.clientX, y: e.clientY, selection });
    },
    [setNodes, setEdges, setSelectedNodeId]
  );

  // #261: an arrow's menu and the canvas's, so everything on the graph has one.
  const [graphMenu, setGraphMenu] = useState<
    | {
        kind: "edge"; edgeId: string; source: string; target: string; name: string; x: number; y: number;
        /** A projection's variable, when the file declares it (#261: Rename, Delete). */
        varName?: string;
        /** A scheduling arrow's condition (#261: Edit condition, Delete). */
        gsc?: { owner: string; gscType: string; target: string };
      }
    | { kind: "pane"; x: number; y: number }
    | null
  >(null);
  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: any) => {
      e.preventDefault();
      setContextMenu(null);
      setSelectedEdgeId(edge.id);
      const name = typeof edge.data?.label === "string" ? edge.data.label : (typeof edge.label === "string" ? edge.label : edge.id);
      const d = edge.data ?? {};
      const gsc = edge.type === "gscEdge" && d.owner && d.gscType && d.targetNode
        ? { owner: d.owner, gscType: d.gscType, target: d.targetNode }
        : undefined;
      const varName = edge.type === "projectionEdge" && d.varName && d.varName in useModelStore.getState().lineMap ? d.varName : undefined;
      setGraphMenu({ kind: "edge", edgeId: edge.id, source: edge.source, target: edge.target, name, x: e.clientX, y: e.clientY, varName, gsc });
    },
    [],
  );
  // #261: a scheduling arrow's label asks for the arrow's menu (GSCEdge).
  useEffect(() => {
    const open = (ev: Event) => {
      const { edgeId, x, y } = (ev as CustomEvent<{ edgeId: string; x: number; y: number }>).detail;
      const edge = useModelStore.getState().edges.find((ed) => ed.id === edgeId);
      if (edge) onEdgeContextMenu({ preventDefault() {}, clientX: x, clientY: y } as React.MouseEvent, edge);
    };
    window.addEventListener(EDGE_MENU_EVENT, open);
    return () => window.removeEventListener(EDGE_MENU_EVENT, open);
  }, [onEdgeContextMenu]);
  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    // Never the web view's own menu (Reload, Inspect Element) on the graph.
    e.preventDefault();
    setContextMenu(null);
    setGraphMenu({ kind: "pane", x: e.clientX, y: e.clientY });
  }, []);
  const selectOnly = useCallback((nodeIds: string[] | "all") => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: nodeIds === "all" || nodeIds.includes(n.id) })));
    setEdges((es) => es.map((ed) => (ed.selected ? { ...ed, selected: false } : ed)));
    if (nodeIds !== "all" && nodeIds.length === 1) setSelectedNodeId(nodeIds[0]);
  }, [setNodes, setEdges, setSelectedNodeId]);

  const onEdgeClick = useCallback(
    (e: React.MouseEvent, edge: any) => {
      // #252: while placing a component, a click on an arrow puts it down
      // there, as on a node or the canvas; it doesn't select the arrow.
      if (placeArmed(e)) return;
      setSelectedEdgeId(edge.id);
    },
    [setSelectedEdgeId, placeArmed]
  );

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    if (placeArmed(e)) return;
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
    setPendingConditionGesture(null);
    setPendingProjectionGesture(null);
  }, [placeArmed, setSelectedNodeId, setSelectedEdgeId, setPendingConditionGesture, setPendingProjectionGesture]);

  // Resize group nodes after drag completes (not during — that blocks dragging).
  // Counted while it moves, not only when dropped: a layout reload landing
  // mid-drag would otherwise snap the node back under the pointer (#444).
  const onNodeDrag: OnNodeDrag = useCallback(() => noteLayoutMove(), []);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_, node, dragged) => {
      // Final resize + save layout. Copies, so React Flow draws what moves below.
      const currentNodes = nodesRef.current.map((n) => ({ ...n }));
      // #208: an open frame never covers an outer node, whichever of them was
      // dragged. Moved now and saved below, or the next rebuild would do it.
      if (usesFlatPositions()) autoSizeGroups(currentNodes);
      else fitFramesAndMakeRoom(currentNodes, new Set(dragged.map((n) => n.id)));
      setNodes(currentNodes);

      // Record position change for undo
      const label = (node.data as any)?.label || node.id;
      recordAction(`Moved node ${label}`);

      if (filePath) {
        saveLayoutDebounced(filePath, currentNodes);
      }
    },
    [filePath, setNodes]
  );

  // #164: an arrow bent, an end moved, a route reset. One History step, and
  // saved on its own: the layout file gets the arrow's route, with the nodes
  // where they are on screen (in Auto the reshape has just made the layout
  // Custom, and these are the places it keeps). Steps take the canvas's
  // nodes: the store's don't follow a drag, nor always a fit after a load.
  useEffect(
    () =>
      registerArrowShapeCommit({
        before: () =>
          recordAction("Positions before reshaping an arrow", {
            edit: false,
            moves: true,
            nodes: nodesRef.current.map((n) => ({ ...n })),
          }),
        done: (description, fromAuto) => {
          const onScreen = nodesRef.current.map((n) => ({ ...n }));
          recordAction(description, { reshapes: true, fromAuto, nodes: onScreen });
          if (filePath) saveLayoutDebounced(filePath, onScreen);
        },
      }),
    [filePath],
  );

  // #219: the Layout menu's Tidy inputs and outputs. The canvas holds the
  // positions as dragged, so it tidies them here. Recorded as two History
  // steps at most: the positions before (only if they differ from the step
  // already there, as after a drag, which the model store hasn't caught up
  // with) and the tidied ones, so one Undo puts them back.
  useEffect(
    () =>
      registerCanvasTidy({
        nodes: () => nodesRef.current,
        tidy: () => {
          const before = nodesRef.current.map((n) => ({ ...n }));
          const { nodes: tidied, moved } = tidyIoRows(before);
          if (moved.length === 0) return;
          const after = tidied.map((n) => ({ ...n }));
          if (usesFlatPositions()) autoSizeGroups(after);
          else fitFramesAndMakeRoom(after);
          const store = useModelStore.getState();
          store.setNodes(before);
          recordAction("Positions before tidying", { edit: false, moves: true });
          store.setNodes(after);
          recordAction("Tidied inputs and outputs", { moves: true });
          if (filePath) saveLayoutDebounced(filePath, after);
        },
      }),
    [filePath],
  );

  // Delete the selected nodes with the Delete shortcut (Backspace; #261: all of them)
  // Deleting the selection is registered as a command (#1112): the shortcut
  // registry owns the key, this owns what the key does. React Flow's own
  // onKeyDown is no longer used for it, so the binding is in one place and can
  // be shown — or rebound — from Settings.
  // #261: delete an arrow, from its menu or the Delete shortcut.
  const deleteEdge = useCallback(
    async (m: { name: string; varName?: string; gsc?: { owner: string; gscType: string; target: string } }) => {
      const what = m.gsc ? `the ${m.gsc.gscType} condition on ${m.gsc.owner}` : `projection "${m.name}"`;
      if (!confirm(`Delete ${what}?`)) return;
      const err = m.gsc
        ? await deleteSchedulingCondition(m.gsc.owner, m.gsc.gscType, m.gsc.target)
        : m.varName
          ? await deleteProjection(m.varName, m.name)
          : null;
      if (err) addNotification("error", `Couldn't delete ${what}: ${err}`);
    },
    [addNotification],
  );

  // #261: the whole selection, when several nodes are selected.
  const deleteNodes = useCallback(
    (varNames: string[]) => {
      if (!filePath || varNames.length === 0) return;
      const question =
        varNames.length === 1
          ? `Delete node "${varNames[0]}"?`
          : `Delete ${varNames.length} nodes (${varNames.join(", ")})?`;
      if (confirm(question)) {
        void deleteNodeOnServer(filePath, varNames, setSource, loadModelFromServer, addNotification);
      }
    },
    [filePath, setSource, loadModelFromServer, addNotification],
  );
  const deleteSelectedNode = useCallback(() => {
    const { selectedNodeId, selectedEdgeId } = useModelStore.getState();
    // #261: with an arrow selected and no node, the shortcut deletes the arrow.
    if (!selectedNodeId && selectedEdgeId) {
      const edge = edges.find((ed) => ed.id === selectedEdgeId);
      const d = (edge?.data ?? {}) as { label?: string; varName?: string; owner?: string; gscType?: string; targetNode?: string };
      if (!edge) return;
      const gsc = edge.type === "gscEdge" && d.owner && d.gscType && d.targetNode
        ? { owner: d.owner, gscType: d.gscType, target: d.targetNode }
        : undefined;
      const varName = edge.type === "projectionEdge" && d.varName && d.varName in useModelStore.getState().lineMap ? d.varName : undefined;
      if (gsc || varName) void deleteEdge({ name: d.label ?? edge.id, varName, gsc });
      return;
    }
    const many = nodes.filter((n) => n.selected && (n.data as unknown as MechanismData)?.varName);
    const chosen = many.length > 1 ? many : nodes.filter((n) => n.id === selectedNodeId);
    deleteNodes(chosen.map((n) => (n.data as unknown as MechanismData).varName).filter(Boolean));
  }, [nodes, edges, deleteEdge, deleteNodes]);

  useEffect(
    () => registerCommand("graph.deleteSelection", deleteSelectedNode),
    [deleteSelectedNode]
  );

  // Handle drop from palette
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const data = e.dataTransfer.getData("application/psyneuview-node");
      if (!data || !filePath) return;
      const { type: mechType, defaults } = JSON.parse(data);
      usePaletteStore.getState().setDraggingFunction(null);

      // #354: a function dropped goes onto the mechanism it is dropped on,
      // as when it is picked up and the mechanism clicked (#348).
      if (isFunctionType(mechType)) {
        const id = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)
          ?.closest(".react-flow__node")
          ?.getAttribute("data-id");
        putFunctionOn(mechType, id ? nodesRef.current.find((n) => n.id === id) : undefined);
        return;
      }

      // #311: a projection isn't a node — it connects two. Drop it onto the
      // intended receiver and arm a one-click gesture to pick the sender,
      // rather than failing through the add_node path.
      if (isProjectionType(mechType)) {
        const targetEl = (
          document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        )?.closest(".react-flow__node");
        const receiverNodeId = targetEl?.getAttribute("data-id") || null;
        const label = findDefByType(mechType)?.label || mechType;
        if (!receiverNodeId) {
          addNotification(
            "info",
            `Drop a ${label} projection onto a target node, then click its source — or drag between node ports to connect.`
          );
          return;
        }
        const receiverNode = nodesRef.current.find((n) => n.id === receiverNodeId);
        const receiverVarName =
          (receiverNode?.data as MechanismData | undefined)?.varName || receiverNodeId;
        const receiverLabel =
          (receiverNode?.data as any)?.label || receiverVarName;
        // The on-canvas banner (below) carries the instruction; no toast here.
        setPendingProjectionGesture({
          receiverNodeId,
          receiverVarName,
          receiverLabel,
          projType: mechType,
        });
        usePaletteStore.getState().addRecentlyUsed(mechType);
        return;
      }

      // #1159: convert the drop point to flow coordinates and carry it through,
      // so the node appears where it was dropped rather than where Dagre would
      // have put it. The projection branch above uses the same point to find a
      // receiver; this is the plain-node case, which used to discard it.
      addNodeToModel(
        filePath, mechType, defaults, setSource, loadModelFromServer, addNotification,
        screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      );
      usePaletteStore.getState().addRecentlyUsed(mechType);
    },
    [filePath, setSource, loadModelFromServer, addNotification, setPendingProjectionGesture, screenToFlowPosition, putFunctionOn]
  );

  // Defer rendering ReactFlow until the container has non-zero dimensions.
  // Allotment assigns dimensions asynchronously, so on first render the
  // container is 0×0, which triggers React Flow's "parent needs width/height" warning.
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setReady(true);
          observer.disconnect();
        }
      }
    });
    observer.observe(containerRef.current);
    // Check immediately in case it already has dimensions
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setReady(true);
      observer.disconnect();
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-testid="graph-canvas"
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}
      tabIndex={0}
    >
      <GraphToolbar />
      {/* #401: a strip above the canvas, never a layer over the graph. */}
      <FailedOpenBanner />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <PaletteSidebar />
        <div
          ref={containerRef}
          data-testid="graph-canvas-viewport"
          // The pointer over the canvas, nodes and edges (#1301): the class
          // picks the rules in index.css, the variables carry the chosen image
          // (arrow, hand, crosshair or ring, #40) at the chosen size, its
          // pressed look, the closed hand for a drag, and the pointer over a
          // control point (never the hand).
          // #252: a crosshair while a component waits to be put down.
          className={graphPointerClass(pointer) + (armed ? " graph-placing" : "")}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: "relative",
            ...graphCursorVars(pointer, pointerSize),
          } as CSSProperties}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <GSCLegend />
          <TraceControls />
          <ValidationPanel />
          <FocusBreadcrumb />
          {ready && <OffscreenNodesIndicator />}
          {ready && <TourOverlay />}
          {pendingConditionGesture && (
            <div
              style={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 20,
                background: "var(--pnv-gesture-condition)",
                color: "var(--pnv-on-primary)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: "var(--pnv-fs-13)",
                boxShadow: "var(--pnv-shadow-banner)",
                pointerEvents: "none",
              }}
            >
              Click the node that <b>{pendingConditionGesture.ownerLabel}</b> should
              wait for, then it runs when that node finishes. <span style={{ opacity: 0.8 }}>Esc to cancel.</span>
            </div>
          )}
          {armed && (
            <div
              data-testid="place-component-hint"
              style={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 20,
                background: "var(--pnv-primary)",
                color: "var(--pnv-on-primary)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: "var(--pnv-fs-13)",
                boxShadow: "var(--pnv-shadow-banner)",
                pointerEvents: "none",
              }}
            >
              {isFunctionType(armed.type) ? (
                <>
                  Click a mechanism to give it this function (<b>{armed.label}</b>).{" "}
                  <span style={{ opacity: 0.8 }}>Esc to cancel.</span>
                </>
              ) : (
                <>
                  Click where the new <b>{armed.label}</b> should go.{" "}
                  <span style={{ opacity: 0.8 }}>Option-click to put down several. Esc to cancel.</span>
                </>
              )}
            </div>
          )}
          {portChooser && (
            <PortChooser
              x={portChooser.x}
              y={portChooser.y}
              receiver={portChooser.receiverLabel}
              ask={portChooser.ask}
              options={portChooser.options}
              onPick={(o) => { void makeDraggedConnection(o.sender || portChooser.sender, o.receiver || portChooser.receiver, o); setPortChooser(null); }}
              onClose={() => setPortChooser(null)}
            />
          )}
          {pendingProjectionGesture && (
            <div
              style={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 20,
                background: "var(--pnv-gesture-projection)",
                color: "var(--pnv-on-primary)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: "var(--pnv-fs-13)",
                boxShadow: "var(--pnv-shadow-banner)",
                pointerEvents: "none",
              }}
            >
              Click the source node to connect into{" "}
              <b>{pendingProjectionGesture.receiverLabel}</b>.{" "}
              <span style={{ opacity: 0.8 }}>Esc to cancel.</span>
            </div>
          )}
          {/* Empty state when no nodes exist */}
          {ready && nodes.length === 0 && (
            <EmptyGraphMessage />
          )}
          {ready && nodes.length > 0 && <StaleGraphBanner />}
          {ready && (
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              // #317: a click never connects; a drag past a few pixels does.
              {...CONNECT_GESTURE}
              connectionLineComponent={ConnectionLine}
              onNodeClick={(e, n) => (isMacSecondaryClick(e) ? onNodeContextMenu(e, n) : onNodeClick(e, n))}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeContextMenu={onEdgeContextMenu}
              onPaneContextMenu={onPaneContextMenu}
              // #261: Shift-click extends the selection as Command-click does
              // (Ctrl-click off the Mac); Shift-drag still draws a box.
              multiSelectionKeyCode={MULTI_SELECT_KEYS}
              onEdgeClick={(e, ed) => (isMacSecondaryClick(e) ? onEdgeContextMenu(e, ed) : onEdgeClick(e, ed))}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={(e) => (isMacSecondaryClick(e) ? onPaneContextMenu(e) : onPaneClick(e))}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={!autoLayout}
              // #62: low enough that Fit always shows the whole graph; at 0.15
              // a large model (EGO) didn't fit a normal-size canvas.
              minZoom={0.02}
              fitView
              // #290: no library credit in the canvas corner; React Flow is
              // credited in Settings ▸ About instead, as its licence allows.
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              {/* #52: our own Fit, framing edges too. The built-in one queues a
                  node-only fit that would land after ours, so it is hidden;
                  CSS keeps this button in its place above the lock. */}
              <Controls showFitView={false}>
                {/* #289: the corner-brackets icon by default (it needs no
                    translation), or the word "Fit" (Settings ▸ Appearance ▸
                    Canvas controls). The same 26px square as the buttons
                    above and below it either way. */}
                <ControlButton
                  className="react-flow__controls-fitview pnv-controls-fit"
                  onClick={fitGraph}
                  title={`Fit the graph to the window${fitKeys ? ` (${fitKeys})` : ""}`}
                  aria-label="Fit the graph to the window"
                >
                  {fitButtonStyle === "word" ? (
                    <span className="pnv-controls-fit-label">Fit</span>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30">
                      <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
                    </svg>
                  )}
                </ControlButton>
              </Controls>
              {/* TODO: Re-add MiniMap as a toggleable overlay with repositioning support */}
            </ReactFlow>
          )}
          {graphMenu?.kind === "edge" && (
            <EdgeContextMenu
              x={graphMenu.x}
              y={graphMenu.y}
              shaped={(useEdgeAttach.getState().waypoints[graphMenu.edgeId]?.length ?? 0) > 0
                || !!useEdgeAttach.getState().handles[graphMenu.edgeId]}
              onSelectSender={() => { selectOnly([graphMenu.source]); setGraphMenu(null); }}
              onSelectReceiver={() => { selectOnly([graphMenu.target]); setGraphMenu(null); }}
              onResetShape={() => {
                // The same as double-clicking a shaped arrow (#164): one step.
                startShapingArrow();
                useEdgeAttach.getState().clearWaypoints(graphMenu.edgeId);
                arrowShaped(reshapeDescription(graphMenu.name, "reset"));
                setGraphMenu(null);
              }}
              name={graphMenu.name}
              onRename={graphMenu.varName ? (nn) => renameProjection(graphMenu.varName!, graphMenu.name, nn) : undefined}
              onEditCondition={graphMenu.gsc ? () => { setSelectedEdgeId(graphMenu.edgeId); setGraphMenu(null); } : undefined}
              onDelete={graphMenu.varName || graphMenu.gsc ? () => { const m = graphMenu; setGraphMenu(null); deleteEdge(m); } : undefined}
              onClose={() => setGraphMenu(null)}
            />
          )}
          {graphMenu?.kind === "pane" && (
            <CanvasContextMenu
              x={graphMenu.x}
              y={graphMenu.y}
              onSelectAll={() => { selectOnly("all"); setGraphMenu(null); }}
              onFit={() => { fitGraph(); setGraphMenu(null); }}
              onShowComponents={() => { usePaletteStore.getState().setOpen(true); setGraphMenu(null); }}
              onClose={() => setGraphMenu(null)}
            />
          )}
          {contextMenu && (
            <NodeContextMenu
              nodeId={contextMenu.nodeId}
              nodeLabel={contextMenu.nodeLabel}
              nodeType={contextMenu.nodeType}
              x={contextMenu.x}
              y={contextMenu.y}
              selection={contextMenu.selection}
              onDeleteNodes={deleteNodes}
              onSelectOnly={(id) => {
                setNodes((ns) => ns.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
                setSelectedNodeId(id);
              }}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Says the graph is the last one that built, not the current file (#1030).
 *
 * Holding a stale graph is only defensible if it is labelled: otherwise the
 * canvas quietly stops matching the file and nothing says so. Anchored to the
 * top rather than centred, and click-through unless there is a line to jump
 * to, because the graph underneath is still worth reading and panning.
 */
function StaleGraphBanner() {
  const [showDiff, setShowDiff] = useState(false);
  const graphIsStale = useModelStore((s) => s.graphIsStale);
  const modelError = useModelStore((s) => s.modelError);
  const lastGoodSource = useModelStore((s) => s.lastGoodSource);
  const modelErrorLine = useModelStore((s) => s.modelErrorLine);
  const revealModelError = useModelStore((s) => s.revealModelError);

  if (!graphIsStale) return null;

  return (
    <>
    <div
      role="status"
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 6,
        maxWidth: 520,
        padding: "8px 14px",
        borderRadius: 6,
        background: "var(--pnv-warning-tint)",
        border: "1px solid var(--pnv-warning-tag-border)",
        color: "var(--pnv-warning-text-on-tint)",
        fontSize: "var(--pnv-fs-13)",
        lineHeight: 1.5,
        boxShadow: "var(--pnv-shadow-frame)",
        pointerEvents: modelErrorLine ? "auto" : "none",
        cursor: modelErrorLine ? "pointer" : undefined,
      }}
      onClick={modelErrorLine ? revealModelError : undefined}
      title={modelErrorLine ? `Go to line ${modelErrorLine}` : undefined}
    >
      <b>Showing the last version that built.</b>{" "}
      The file does not run right now, so the graph has not been updated.
      {modelError ? (
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          {modelError}
          {modelErrorLine ? ` (line ${modelErrorLine})` : ""}
        </div>
      ) : null}
      {lastGoodSource !== null && (
        <button
          onClick={(e) => {
            // The banner itself may jump to the error line; this must not.
            e.stopPropagation();
            setShowDiff(true);
          }}
          style={{
            marginTop: 6, border: "1px solid var(--pnv-warning-tag-border)", background: "var(--pnv-surface)",
            color: "var(--pnv-warning-text-on-tint)", borderRadius: 4, padding: "2px 8px",
            cursor: "pointer", fontSize: "var(--pnv-fs-12)", pointerEvents: "auto",
          }}
        >
          Compare with that version
        </button>
      )}
    </div>
      {showDiff && <LastGoodDiff onClose={() => setShowDiff(false)} />}
    </>
  );
}

function EmptyGraphMessage() {
  const modelError = useModelStore((s) => s.modelError);
  const filePath = useModelStore((s) => s.filePath);
  const modelErrorLine = useModelStore((s) => s.modelErrorLine);
  const revealModelError = useModelStore((s) => s.revealModelError);

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        textAlign: "center",
        color: "var(--pnv-text-hint)",
        fontSize: "var(--pnv-fs-14)",
        zIndex: 5,
        maxWidth: 400,
        pointerEvents: "none",
      }}
    >
      {modelError ? (
        // #1103: clickable, so the error takes you to the line it happened on.
        // The container sets pointerEvents: "none" so the canvas stays
        // draggable behind this overlay, which is why it is re-enabled here
        // rather than on the parent.
        <div
          onClick={modelErrorLine ? revealModelError : undefined}
          onKeyDown={
            modelErrorLine
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    revealModelError();
                  }
                }
              : undefined
          }
          role={modelErrorLine ? "button" : undefined}
          tabIndex={modelErrorLine ? 0 : undefined}
          title={modelErrorLine ? `Go to line ${modelErrorLine}` : undefined}
          style={{
            pointerEvents: modelErrorLine ? "auto" : "none",
            cursor: modelErrorLine ? "pointer" : undefined,
          }}
        >
          <div style={{ fontSize: "var(--pnv-fs-16)", fontWeight: 600, color: "var(--pnv-danger)", marginBottom: 8 }}>
            Model Error
          </div>
          <div style={{ fontSize: "var(--pnv-fs-13)", color: "var(--pnv-text-muted)", lineHeight: 1.6 }}>
            {modelError}
          </div>
          {modelErrorLine && (
            <div style={{ marginTop: 10, fontSize: "var(--pnv-fs-12)", color: "var(--pnv-danger)", fontWeight: 600 }}>
              Go to line {modelErrorLine} →
            </div>
          )}
        </div>
      ) : filePath ? (
        <div style={{ color: "var(--pnv-node-text-dim)" }}>
          No model to display. Check the code editor for errors.
        </div>
      ) : (
        <div style={{ pointerEvents: "auto" }}>
          <div style={{ fontSize: "var(--pnv-fs-18)", fontWeight: 600, color: "var(--pnv-node-text-strong)", marginBottom: 16 }}>
            PsyNeuView
          </div>
          <div style={{ fontSize: "var(--pnv-fs-13)", color: "var(--pnv-text-hint)", lineHeight: 2 }}>
            <div>Use <strong>Open</strong> in the toolbar to open a .py file</div>
            <div>or pick one from the <strong>PsyNeuLink Library</strong></div>
            <div>or click <strong>+ New Model</strong> to start from scratch</div>
          </div>
          <div style={{ marginTop: 16, fontSize: "var(--pnv-fs-11)", color: "var(--pnv-node-text-dim)" }}>
            Supports any PsyNeuLink Python file
          </div>
        </div>
      )}
    </div>
  );
}
