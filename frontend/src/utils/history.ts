/**
 * History utilities — helper to capture the current app state as a snapshot.
 *
 * Call `recordAction("description")` from anywhere to create an undo point.
 * The snapshot includes source, nodes, edges, file path, and positions.
 */

import { useModelStore } from "@/stores/modelStore";
import { useHistoryStore, type SaveMark, type Snapshot } from "@/stores/historyStore";
import type { MechanismData } from "@/stores/modelStore";

/**
 * Capture the current state and push it as a history snapshot.
 * Call this BEFORE the action takes effect to record the "before" state,
 * or AFTER the action with the resulting state.
 *
 * @param description - Human-readable description ("Modified gain in hidden_layer")
 */
export function recordAction(description: string) {
  const store = useModelStore.getState();
  const { source, nodes, edges, filePath } = store;

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
  };

  useHistoryStore.getState().pushSnapshot(snapshot);
}

/**
 * Record the initial state when a model is first loaded.
 * This creates the baseline for undo — the first entry in the stack.
 */
export function recordInitialState() {
  recordAction("Model loaded");
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
