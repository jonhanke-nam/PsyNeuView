/**
 * History utilities — helper to capture the current app state as a snapshot.
 *
 * Call `recordAction("description")` from anywhere to create an undo point.
 * The snapshot includes source, nodes, edges, file path, and positions.
 */

import { useModelStore } from "@/stores/modelStore";
import { record } from "@/utils/activityLog";
import { useHistoryStore, type SaveMark, type Snapshot } from "@/stores/historyStore";
import type { MechanismData } from "@/stores/modelStore";
import { captureView } from "@/utils/graphView";
import type { Node } from "@xyflow/react";
import { serializeRoutes, type RoutableEdge } from "@/utils/edgeRoutes";
import { useEdgeAttach } from "@/stores/edgeAttachStore";

export interface RecordActionOptions {
  /**
   * Whether the step is an edit the user made to the model, which problem
   * reports list (#177). Defaults to true. False for the app's own steps: a
   * model loading or being rebuilt, and a frame button changing the view
   * (#204), which change what is shown and not the model.
   */
  edit?: boolean;
  /**
   * The step only moves nodes (#219): kept when the positions changed,
   * though the code and the graph did not. See `Snapshot.moves`.
   */
  moves?: boolean;
  /**
   * The step only reshapes arrows (#164): kept when the arrows' routes
   * changed, though the code and the graph did not. See `Snapshot.reshapes`.
   */
  reshapes?: boolean;
  /**
   * The nodes as the canvas has them (#164). The store's nodes don't follow a
   * drag on the canvas, so a step taken there passes the canvas's own.
   */
  nodes?: Node[];
}

/**
 * Capture the current state and push it as a history snapshot.
 * Call this BEFORE the action takes effect to record the "before" state,
 * or AFTER the action with the resulting state.
 *
 * @param description - Human-readable description ("Modified gain in hidden_layer")
 */
export function recordAction(description: string, opts?: RecordActionOptions) {
  // An edit the user made goes in the activity log, for problem reports
  // (#177). The description names what changed, never the new text or value.
  if (opts?.edit !== false) record("edit", description);
  const store = useModelStore.getState();
  const { source, edges, filePath } = store;
  const nodes = opts?.nodes ?? store.nodes;

  // Capture current node positions for layout restore
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const varName = (node.data as unknown as MechanismData)?.varName || node.id;
    positions[varName] = { x: node.position.x, y: node.position.y };
  }

  const snapshot: Snapshot = {
    source,
    nodes: nodes.map((n) => ({ ...n })), // shallow copy
    edges: edges.map((e) => ({ ...e })),
    filePath,
    description,
    timestamp: Date.now(),
    positions,
    // The view the graph was built in, so undo puts it back too (#194).
    view: captureView(),
    // The arrows shaped by hand (#164), as the layout file keeps them, so
    // Undo puts an arrow's shape back.
    edgeRoutes: (() => {
      const ea = useEdgeAttach.getState();
      return serializeRoutes(edges as unknown as RoutableEdge[], ea.shaped, ea.waypoints, ea.overrides);
    })(),
    ...(opts?.moves ? { moves: true } : {}),
    ...(opts?.reshapes ? { reshapes: true } : {}),
  };

  useHistoryStore.getState().pushSnapshot(snapshot);
}

/**
 * Record the initial state when a model is first loaded.
 * This creates the baseline for undo — the first entry in the stack.
 */
export function recordInitialState() {
  recordAction("Model loaded", { edit: false });
}

/**
 * Mark the history with a save of `source` to the model file (#1349).
 *
 * Called once the file has been written. The mark goes on the current step
 * when it holds `source`; otherwise the current state, with `source` as its
 * text, becomes a step that carries it.
 */
export function recordSave(source: string, mark: SaveMark) {
  const store = useModelStore.getState();
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of store.nodes) {
    const varName = (node.data as unknown as MechanismData)?.varName || node.id;
    positions[varName] = { x: node.position.x, y: node.position.y };
  }
  useHistoryStore.getState().markSaved(
    {
      source,
      nodes: store.nodes.map((n) => ({ ...n })),
      edges: store.edges.map((e) => ({ ...e })),
      filePath: store.filePath,
      description: "Saved",
      timestamp: Date.now(),
      positions,
      view: captureView(),
    },
    mark,
  );
}

/**
 * A hook for the end-to-end tests (#558), present only when the browser is
 * driven by automation (`navigator.webdriver`, which Playwright sets): it
 * records code edits as steps without waiting for each to be previewed, so a
 * test can make hundreds of them, and reads what History holds.
 *
 * `freshGraph` gives the step its own copy of the graph, as a real code edit
 * does when the model is rebuilt; without it the step shares the current
 * graph, as a node move does. It is how the memory per step was measured.
 */
export interface UndoTestHook {
  recordCodeEdit: (source: string, description: string, opts?: { freshGraph?: boolean }) => void;
  setBudget: (budget: { fullBytes?: number; totalBytes?: number }) => void;
  stats: () => ReturnType<ReturnType<typeof useHistoryStore.getState>["stats"]>;
  clear: () => void;
  /** The code the editor holds. */
  source: () => string;
}

function copyOf<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.webdriver) {
  const hook: UndoTestHook = {
    recordCodeEdit: (source, description, opts) => {
      const store = useModelStore.getState();
      store.setSource(source);
      if (opts?.freshGraph) {
        store.setNodes(copyOf(store.nodes));
        store.setEdges(copyOf(store.edges));
      }
      recordAction(description);
    },
    setBudget: (budget) => useHistoryStore.getState().setBudget(budget),
    stats: () => useHistoryStore.getState().stats(),
    clear: () => useHistoryStore.getState().clear(),
    source: () => useModelStore.getState().source,
  };
  (window as unknown as { __pnvUndoTest?: UndoTestHook }).__pnvUndoTest = hook;
}
