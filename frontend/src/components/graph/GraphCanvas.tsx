/**
 * The main React Flow graph canvas.
 * Renders PsyNeuLink mechanisms as nodes and projections as edges.
 * Handles: drag layout saving, new connections → projections, node deletion.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type OnConnect,
  type OnNodeDrag,
  type Connection,
  type NodeChange,
  addEdge,
} from "@xyflow/react";
import { computeShiftTable, shiftPosition, unshiftPosition } from "@/utils/viewTransform";

import { useModelStore, type MechanismData, autoSizeGroups } from "@/stores/modelStore";
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
import { GSCEdge } from "./GSCEdge";
import { ProjectionEdge } from "./ProjectionEdge";
import { GSCLegend } from "./GSCLegend";
import { TraceControls } from "./TraceControls";
import { ValidationPanel } from "./ValidationPanel";
import { FocusBreadcrumb } from "./FocusBreadcrumb";
import { GraphToolbar } from "./GraphToolbar";
import { PaletteSidebar } from "./PaletteSidebar";
import { NodeContextMenu } from "./NodeContextMenu";
import { OffscreenNodesIndicator } from "./OffscreenNodesIndicator";
import { TourOverlay } from "./TourOverlay";
import { addNodeToModel } from "@/utils/nodeActions";
import { isProjectionType, findDefByType } from "@/constants/pnlTypes";
import { registerCommand } from "@/shortcuts/commands";
import { LastGoodDiff } from "./LastGoodDiff";
import { serializeRoutes, type RoutableEdge } from "@/utils/edgeRoutes";
import { useEdgeAttach } from "@/stores/edgeAttachStore";
import { prunePositions } from "@/utils/prunePositions";
import { useGraphPointerStore } from "@/stores/graphPointerStore";
import { ARROW_CURSOR_VAR, arrowCursorValue, graphPointerClass } from "@/utils/graphCursor";
import { showGraphLoadRequest } from "@/utils/showGraphLoadRequest";

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
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of nodes) {
      // #697/#713: cluster frames are reconstructed each load — never persist.
      if (node.id.startsWith("cluster::")) continue;
      let key = (node.data as MechanismData)?.varName || node.id;
      // CIM nodes have PNL numeric suffixes that change each load;
      // save with a stable key by stripping the suffix.
      if (node.type === "cimNode") {
        key = key.replace(/-\d+\s/, " ");
      }
      positions[key] = { x: node.position.x, y: node.position.y };
    }
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
    const gs = useGraphSettings.getState();
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
    );
    const body = gs.flat || gs.pytorch
      ? { file_path: filePath, flatPositions: merged, flatEdgeRoutes: routes }
      : { file_path: filePath, positions: merged, edgeRoutes: routes };
    fetch("/api/model/save-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, 500);
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
  projType?: string
) {
  const { setStatus, clearStatus } = useStatusStore.getState();
  const projName = `${sourceNode}_to_${targetNode}`.replace(/-\d+/g, "");
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

    const resp = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, changes }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
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
        file_path: filePath,
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
  varName: string,
  setSource: (s: string) => void,
  loadModel: (m: any, l?: any) => void,
  addNotification: (type: any, msg: string) => void,
) {
  const { setStatus, clearStatus } = useStatusStore.getState();
  setStatus(`Removing node: ${varName}...`);
  try {
    const resp = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: filePath,
        changes: { action: "remove_node", var_name: varName },
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
    recordAction(`Deleted node ${varName}`);
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
      body: JSON.stringify({ file_path: filePath, ...showGraphLoadRequest() }),
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
  } | null>(null);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Re-fit the graph when panes are shown/hidden (#226). The canvas resizes
  // as the layout reflows, so without this the graph stays cramped or
  // off-center in its new footprint. Skip the first render — the initial fit
  // is handled by the load effect / ReactFlow's fitView prop.
  const codeVisible = useLayoutStore((s) => s.codeVisible);
  const graphVisible = useLayoutStore((s) => s.graphVisible);
  const bottomVisible = useLayoutStore((s) => s.bottomVisible);
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (!graphVisible) return;
    // Wait for the Allotment reflow to settle before measuring.
    const t = setTimeout(() => fitView({ padding: 0.2 }), 120);
    return () => clearTimeout(t);
  }, [codeVisible, graphVisible, bottomVisible, fitView]);

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
      nodes.map((n) => ({
        ...n,
        position: shiftPosition(n.id, n.position, shiftTable),
      })),
    [nodes, shiftTable],
  );

  // Inverse-transform position changes from React Flow before they hit
  // canonical state — drag deltas arrive in rendered space.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const remapped = changes.map((c) => {
        if (c.type === "position" && c.position) {
          return { ...c, position: unshiftPosition(c.id, c.position, shiftTable) };
        }
        return c;
      });
      onNodesChangeRaw(remapped);
    },
    [onNodesChangeRaw, shiftTable],
  );

  useEffect(() => {
    setNodes(storeNodes);
    // Apply label visibility and dimension annotations to edges
    const displayEdges = storeEdges.map((e) => {
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
    setTimeout(() => fitView({ padding: 0.2 }), 50);
  }, [storeNodes, storeEdges, setNodes, setEdges, fitView, showProjectionLabels, showDimensions]);

  // When user draws a connection between nodes → create a projection
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
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
            body: JSON.stringify({ file_path: filePath, ...showGraphLoadRequest() }),
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
    [filePath, setEdges, setSource, loadModelFromServer]
  );

  const setSelectedEdgeId = useModelStore((s) => s.setSelectedEdgeId);
  const pendingConditionGesture = useModelStore((s) => s.pendingConditionGesture);
  const setPendingConditionGesture = useModelStore((s) => s.setPendingConditionGesture);
  const pendingProjectionGesture = useModelStore((s) => s.pendingProjectionGesture);
  const setPendingProjectionGesture = useModelStore((s) => s.setPendingProjectionGesture);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: any) => {
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
            body: JSON.stringify({ file_path: filePath, ...showGraphLoadRequest() }),
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
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId, setPendingConditionGesture, setPendingProjectionGesture, filePath, setSource, loadModelFromServer]
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
      const label = (node.data as any)?.label || node.id;
      setContextMenu({ nodeId: node.id, nodeLabel: label, nodeType: node.type || "", x: e.clientX, y: e.clientY });
    },
    []
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: any) => {
      setSelectedEdgeId(edge.id);
    },
    [setSelectedEdgeId]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
    setPendingConditionGesture(null);
    setPendingProjectionGesture(null);
  }, [setSelectedNodeId, setSelectedEdgeId, setPendingConditionGesture, setPendingProjectionGesture]);

  // Resize group nodes after drag completes (not during — that blocks dragging)
  const onNodeDrag: OnNodeDrag = useCallback(() => {}, []);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_, node) => {
      // Final resize + save layout
      const currentNodes = [...nodesRef.current];
      autoSizeGroups(currentNodes);
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

  // Delete selected node with Backspace/Delete key
  // Deleting the selection is registered as a command (#1112): the shortcut
  // registry owns the key, this owns what the key does. React Flow's own
  // onKeyDown is no longer used for it, so the binding is in one place and can
  // be shown — or rebound — from Settings.
  const deleteSelectedNode = useCallback(() => {
    const selectedNodeId = useModelStore.getState().selectedNodeId;
    if (!selectedNodeId || !filePath) return;

    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;

    const varName = (node.data as unknown as MechanismData).varName;
    if (confirm(`Delete node "${varName}"?`)) {
      deleteNodeOnServer(filePath, varName, setSource, loadModelFromServer, addNotification);
    }
  }, [filePath, nodes, setSource, loadModelFromServer, addNotification]);

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
      const data = e.dataTransfer.getData("application/psynewview-node");
      if (!data || !filePath) return;
      const { type: mechType, defaults } = JSON.parse(data);

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
    [filePath, setSource, loadModelFromServer, addNotification, setPendingProjectionGesture, screenToFlowPosition]
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
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <PaletteSidebar />
        <div
          ref={containerRef}
          data-testid="graph-canvas-viewport"
          // The pointer over the canvas, nodes and edges (#1301): the class
          // picks the rules in index.css, the variable carries the arrow at
          // the chosen size. React Flow's own cursors apply under "hand".
          className={graphPointerClass(pointer)}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: "relative",
            [ARROW_CURSOR_VAR as string]: arrowCursorValue(pointerSize),
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
                fontSize: 13,
                boxShadow: "var(--pnv-shadow-banner)",
                pointerEvents: "none",
              }}
            >
              Click the node that <b>{pendingConditionGesture.ownerLabel}</b> should
              wait for, then it runs when that node finishes. <span style={{ opacity: 0.8 }}>Esc to cancel.</span>
            </div>
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
                fontSize: 13,
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
              onNodeClick={onNodeClick}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeClick={onEdgeClick}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={!autoLayout}
              minZoom={0.15}
              fitView
            >
              <Background />
              <Controls />
              {/* TODO: Re-add MiniMap as a toggleable overlay with repositioning support */}
            </ReactFlow>
          )}
          {contextMenu && (
            <NodeContextMenu
              nodeId={contextMenu.nodeId}
              nodeLabel={contextMenu.nodeLabel}
              nodeType={contextMenu.nodeType}
              x={contextMenu.x}
              y={contextMenu.y}
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
        fontSize: 13,
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
            cursor: "pointer", fontSize: 12, pointerEvents: "auto",
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
        fontSize: 14,
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
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--pnv-danger)", marginBottom: 8 }}>
            Model Error
          </div>
          <div style={{ fontSize: 13, color: "var(--pnv-text-muted)", lineHeight: 1.6 }}>
            {modelError}
          </div>
          {modelErrorLine && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--pnv-danger)", fontWeight: 600 }}>
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
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--pnv-node-text-strong)", marginBottom: 16 }}>
            PsyNeuView
          </div>
          <div style={{ fontSize: 13, color: "var(--pnv-text-hint)", lineHeight: 2 }}>
            <div>Use <strong>Open</strong> in the toolbar to open a .py file</div>
            <div>or pick one from the <strong>PsyNeuLink Library</strong></div>
            <div>or click <strong>+ New Model</strong> to start from scratch</div>
          </div>
          <div style={{ marginTop: 16, fontSize: 11, color: "var(--pnv-node-text-dim)" }}>
            Supports any PsyNeuLink Python file
          </div>
        </div>
      )}
    </div>
  );
}
