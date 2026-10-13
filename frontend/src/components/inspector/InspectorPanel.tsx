/**
 * Property inspector panel.
 * Shows editable properties for the currently selected node.
 * Edits are sent to the backend, which updates the .py file and re-introspects.
 */

import { useCallback, useState, useEffect, useRef } from "react";
import { useModelStore } from "@/stores/modelStore";
import type { MechanismData, ParamMeta } from "@/stores/modelStore";
import { useRunResults, type RunResults } from "@/stores/runResultsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useStatusStore } from "@/stores/statusStore";
import { useLoadTimingStore } from "@/stores/loadTimingStore";
import { useUIStore } from "@/stores/uiStore";
import { recordAction } from "@/utils/history";
import { findGscEdgeId } from "@/utils/gscEdgeId";
import { renameNode } from "@/utils/nodeActions";
import { formatTraceValue } from "@/utils/traceValues";
import {
  resolveOutputLabels,
  resolveInputLabels,
  labeledValueLines,
  expandMultiPort,
  formatLabeledValue,
  resolvePortDisplayName,
  type ModelLabels,
} from "@/utils/labels";
import { getEnumChoices, matchEnumChoice } from "@/constants/paramEnums";
import type { EnumChoiceSet } from "@/constants/paramEnums";
import type { GSCInfo, BasicConditionEntry, ConditionInfo } from "@/types/model";
import { edgeOrigin, nodeOrigin, originHint, originLabel, type LayoutOrigin } from "@/utils/layoutOrigin";
import { useEdgeAttach } from "@/stores/edgeAttachStore";
import { Button } from "@/components/common/Button";

/**
 * Scroll the code editor to the line where a parameter is defined.
 */
/** Find the line number for a param and set both scroll target and active highlight. */
function scrollToParam(varName: string, paramName: string, context: string) {
  const { source, lineMap, setCursorTargetLine, setActiveParamLine } = useModelStore.getState();
  const declLine = lineMap[varName];
  if (!declLine) return;

  const lines = source.split("\n");
  const startIdx = declLine - 1;
  const paramPattern = new RegExp(`\\b${paramName}\\s*=`);
  const funcPattern = /function\s*=\s*pnl\.\w+\(/;

  const goToLine = (line: number) => {
    setCursorTargetLine(line);
    setActiveParamLine(line);
  };

  if (context === "function") {
    let funcLine = -1;
    for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
      if (funcPattern.test(lines[i])) { funcLine = i; break; }
    }
    if (funcLine >= 0) {
      for (let i = funcLine; i < Math.min(funcLine + 10, lines.length); i++) {
        if (paramPattern.test(lines[i])) { goToLine(i + 1); return; }
      }
      goToLine(funcLine + 1);
      return;
    }
  }

  for (let i = startIdx; i < Math.min(startIdx + 30, lines.length); i++) {
    if (paramPattern.test(lines[i])) { goToLine(i + 1); return; }
  }
  goToLine(declLine);
}

/** Clear the param-level highlight in the code editor. */
function clearParamHighlight() {
  useModelStore.getState().setActiveParamLine(null);
}

/** Type guard: is this a rich ParamMeta object? */
function isParamMeta(val: unknown): val is ParamMeta {
  return val !== null && typeof val === "object" && "value" in (val as any) && "editable" in (val as any);
}

/**
 * Optimistic source update: apply the param change to the source string
 * in the frontend immediately, without waiting for the backend.
 * Returns the updated source, or null if we can't compute it.
 */
export function applyOptimisticUpdate(
  source: string,
  varName: string,
  paramName: string,
  newValue: string,
  context: string,
  isDefault: boolean,
): string | null {
  const lines = source.split("\n");
  // Find the variable declaration
  let declStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^${varName}\\s*=\\s*pnl\\.\\w+\\(`).test(lines[i])) {
      declStart = i;
      break;
    }
  }
  if (declStart < 0) return null;

  // For function context, find the function=pnl.XXX(...) line
  const searchStart = context === "function"
    ? lines.findIndex((l, i) => i >= declStart && /function\s*=\s*pnl\.\w+\(/.test(l))
    : declStart;
  if (searchStart < 0) return null;

  const paramPattern = new RegExp(`(\\b${paramName}\\s*=\\s*)`);

  if (isDefault) {
    // Remove the param — find and delete it
    for (let i = searchStart; i < Math.min(searchStart + 15, lines.length); i++) {
      if (paramPattern.test(lines[i])) {
        // Simple removal: delete the line or the param from the line
        const line = lines[i];
        // If param is the only thing on this line (indented), remove the whole line
        const stripped = line.trim();
        if (stripped.startsWith(paramName + "=") || stripped.startsWith(paramName + " =")) {
          // Remove this line and any trailing comma from previous line
          lines.splice(i, 1);
          if (i > 0) {
            lines[i - 1] = lines[i - 1].replace(/,\s*$/, "");
          }
          return lines.join("\n");
        }
        // Param is inline — remove it with surrounding comma
        const replaced = line
          .replace(new RegExp(`,\\s*${paramName}\\s*=\\s*[^,)]+`), "")
          .replace(new RegExp(`${paramName}\\s*=\\s*[^,)]+,?\\s*`), "");
        lines[i] = replaced;
        return lines.join("\n");
      }
    }
    return null;
  }

  // Replace existing param value
  for (let i = searchStart; i < Math.min(searchStart + 15, lines.length); i++) {
    if (paramPattern.test(lines[i])) {
      // A list, tuple or dict value (a projection's matrix) can hold commas
      // and run over several lines, which the one-line replace below can't
      // see the end of: it replaced `[[1` and left `, 4], [2, 5]]` behind,
      // and the buffer flush saved that broken file before the backend's
      // edit ran (#45). Leave those to the backend, which tracks brackets.
      const after = lines[i].slice(lines[i].search(paramPattern)).replace(paramPattern, "");
      if (/^[[({]/.test(after.trimStart()) || /^[[({]/.test(newValue.trimStart())) return null;
      lines[i] = lines[i].replace(
        new RegExp(`(\\b${paramName}\\s*=\\s*)[^,)\\n]+`),
        `$1${newValue}`
      );
      return lines.join("\n");
    }
  }

  // Param not in source yet — insert it
  if (context === "function") {
    // Insert into the function call: pnl.XXX(existing) → pnl.XXX(existing, param=val)
    for (let i = searchStart; i < Math.min(searchStart + 5, lines.length); i++) {
      const closingIdx = lines[i].lastIndexOf(")");
      if (closingIdx >= 0 && lines[i].includes("pnl.")) {
        const before = lines[i].substring(0, closingIdx);
        const after = lines[i].substring(closingIdx);
        const separator = before.trim().endsWith("(") ? "" : ", ";
        lines[i] = before + separator + paramName + "=" + newValue + after;
        return lines.join("\n");
      }
    }
  }

  return null; // couldn't compute — fall back to backend
}

async function sendParamUpdate(
  filePath: string,
  varName: string,
  paramName: string,
  newValue: string,
  context: string,
  isDefault: boolean = false,
  skipIntrospect: boolean = false,
  signal?: AbortSignal,
  // Class of the owner's function, e.g. "DriftDiffusionAnalytical". Sent so
  // the backend can write the default in when the declaration has no
  // `function=` at all — a palette-added mechanism is bare, while the
  // Inspector still shows its inherited parameters (#1200).
  functionClass?: string,
) {
  // #1029: these endpoints edit the file on disk, so unsaved editor
  // text must reach it first or the edit is computed from stale source.
  await useModelStore.getState().flushBuffer();
  const resp = await fetch("/api/model/update-param", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: filePath,
      var_name: varName,
      param_name: paramName,
      new_value: newValue,
      context,
      is_default: isDefault,
      skip_introspect: skipIntrospect,
      function_class: functionClass,
    }),
    signal,
  });
  const text = await resp.text();
  if (!text) throw new Error("Server returned empty response (may be reloading)");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Server returned invalid JSON (may be reloading)"); }
  if (!resp.ok) throw new Error(data.detail || "Update failed");
  return data;
}

async function sendFunctionTypeUpdate(
  filePath: string,
  varName: string,
  newFunctionClass: string,
  signal?: AbortSignal,
) {
  // #1029: these endpoints edit the file on disk, so unsaved editor
  // text must reach it first or the edit is computed from stale source.
  await useModelStore.getState().flushBuffer();
  const resp = await fetch("/api/model/update-function-type", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: filePath,
      var_name: varName,
      new_function_class: newFunctionClass,
    }),
    signal,
  });
  const text = await resp.text();
  if (!text) throw new Error("Server returned empty response (may be reloading)");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Server returned invalid JSON (may be reloading)"); }
  if (!resp.ok) throw new Error(data.detail || "Function-type update failed");
  return data;
}

type PortKind = "input" | "output";

async function sendPortRename(
  filePath: string,
  varName: string,
  portKind: PortKind,
  currentNames: string[],
  oldName: string,
  newName: string,
  signal?: AbortSignal,
) {
  // #1029: these endpoints edit the file on disk, so unsaved editor
  // text must reach it first or the edit is computed from stale source.
  await useModelStore.getState().flushBuffer();
  const resp = await fetch("/api/model/rename-port", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: filePath,
      var_name: varName,
      port_kind: portKind,
      current_names: currentNames,
      old_name: oldName,
      new_name: newName,
    }),
    signal,
  });
  const text = await resp.text();
  if (!text) throw new Error("Server returned empty response (may be reloading)");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Server returned invalid JSON (may be reloading)"); }
  if (!resp.ok) throw new Error(data.detail || "Port rename failed");
  return data;
}

async function sendPortAdd(
  filePath: string,
  varName: string,
  portKind: PortKind,
  currentNames: string[],
  newName: string,
  signal?: AbortSignal,
) {
  // #1029: these endpoints edit the file on disk, so unsaved editor
  // text must reach it first or the edit is computed from stale source.
  await useModelStore.getState().flushBuffer();
  const resp = await fetch("/api/model/add-port", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: filePath,
      var_name: varName,
      port_kind: portKind,
      current_names: currentNames,
      new_name: newName,
    }),
    signal,
  });
  const text = await resp.text();
  if (!text) throw new Error("Server returned empty response (may be reloading)");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Server returned invalid JSON (may be reloading)"); }
  if (!resp.ok) throw new Error(data.detail || "Port add failed");
  return data;
}

async function sendPortRemove(
  filePath: string,
  varName: string,
  portKind: PortKind,
  currentNames: string[],
  portName: string,
  signal?: AbortSignal,
) {
  // #1029: these endpoints edit the file on disk, so unsaved editor
  // text must reach it first or the edit is computed from stale source.
  await useModelStore.getState().flushBuffer();
  const resp = await fetch("/api/model/remove-port", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: filePath,
      var_name: varName,
      port_kind: portKind,
      current_names: currentNames,
      port_name: portName,
    }),
    signal,
  });
  const text = await resp.text();
  if (!text) throw new Error("Server returned empty response (may be reloading)");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Server returned invalid JSON (may be reloading)"); }
  if (!resp.ok) throw new Error(data.detail || "Port remove failed");
  return data;
}

// AbortController for cancelling stale param update requests
let paramUpdateController: AbortController | null = null;
let functionTypeController: AbortController | null = null;
let portController: AbortController | null = null;

// ─── Main Component ──────────────────────────────────────────────

// Clickable scheduler-mode badge (#381). Toggles the active composition's
// scheduler between STANDARD and EXACT_TIME and persists via the
// set_scheduler_mode structural change, then re-introspects.
export function SchedulerModeToggle({ mode, fontPx }: { mode: string; fontPx: number }) {
  const next = mode === "STANDARD" ? "EXACT_TIME" : "STANDARD";
  const onClick = async () => {
    const { filePath, setSource, loadModelFromServer, activeComposition, compositionNames } =
      useModelStore.getState();
    const comp = activeComposition || compositionNames[0];
    if (!filePath || !comp) return;
    recordAction(`Set scheduler mode → ${next}`);
    try {
      const resp = await fetch("/api/model/structural-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: filePath,
          changes: { action: "set_scheduler_mode", composition: comp, mode: next },
        }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      setSource(data.source);
      loadModelFromServer(data.model, data.layout);
    } catch {
      useNotificationStore.getState().addNotification("error", "Failed to change scheduler mode");
    }
  };
  return (
    <button
      onClick={onClick}
      title={`Scheduling mode: ${mode}. Click to switch to ${next}.`}
      style={{
        fontSize: fontPx, fontWeight: 600, fontFamily: "monospace",
        color: "var(--pnv-on-primary)", background: mode === "STANDARD" ? "var(--pnv-primary)" : "var(--pnv-warning)",
        padding: "1px 8px", borderRadius: 8, border: "none", cursor: "pointer",
      }}
    >
      {mode}
    </button>
  );
}

export function InspectorPanel() {
  const selectedNodeId = useModelStore((s) => s.selectedNodeId);
  // #1163: what the sidecar holds, so the panel can say whether this node's
  // position is recorded or computed.
  const lastLayoutPositions = useModelStore((s) => s.lastLayoutPositions);
  // #1163: which edges the user shaped, as opposed to merely grabbed.
  const shapedEdges = useEdgeAttach((s) => s.shaped);
  const selectedEdgeId = useModelStore((s) => s.selectedEdgeId);
  const loadTiming = useLoadTimingStore((s) => s.last);
  const nodes = useModelStore((s) => s.nodes);
  const edges = useModelStore((s) => s.edges);
  // Inline node rename in the header (#612).
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  // Leaving a node cancels an in-progress rename.
  useEffect(() => {
    setEditingName(false);
    setRenameError(null);
  }, [selectedNodeId]);
  // #336 gap 2: when a trace is active, the Mechanism Inspector renders
  // a "Value at this step" section for the selected node — so a user
  // who clicked into a node for its config also sees its dynamic state
  // without leaving the tab.
  const traceStep = useModelStore((s) => s.traceStep);
  const traceStepValues = useModelStore((s) => s.traceStepValues);
  const modelLabels = useModelStore((s) => s.modelLabels);
  const filePath = useModelStore((s) => s.filePath);
  const setSource = useModelStore((s) => s.setSource);
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const fontScale = useUIStore((s) => s.inspectorFontScale);
  const zoomIn = useUIStore((s) => s.zoomIn);
  const zoomOut = useUIStore((s) => s.zoomOut);

  const s = (base: number) => Math.round(base * fontScale);

  const handleParamChange = useCallback(
    async (
      varName: string,
      paramName: string,
      newValue: string,
      context: string | "projection" | "projection_function",
      defaultValue?: unknown,
    ) => {
      if (!filePath) return;

      // Record state before change for undo
      recordAction(`Modified ${paramName} in ${varName}`);

      // Numeric-aware default comparison: "0" matches "0.0", "1" matches "1.0", etc.
      const isDefault = (() => {
        if (defaultValue === null || defaultValue === undefined) return false;
        const defaultStr = typeof defaultValue === "object" ? JSON.stringify(defaultValue) : String(defaultValue);
        if (newValue === defaultStr) return true;
        // Try numeric comparison
        const numNew = Number(newValue);
        const numDef = Number(defaultStr);
        if (!isNaN(numNew) && !isNaN(numDef)) return numNew === numDef;
        return false;
      })();

      // Step 1: Optimistic update — apply to code editor immediately
      const currentSource = useModelStore.getState().source;
      const optimistic = applyOptimisticUpdate(currentSource, varName, paramName, newValue, context, isDefault);
      if (optimistic) {
        setSource(optimistic);
        if (!isDefault) {
          setTimeout(() => scrollToParam(varName, paramName, context), 10);
        }
      }

      // Step 2: Persist to file AND re-introspect in background.
      // Cancel any previous in-flight request (avoids piling up stale requests
      // when uvicorn reloads after each file write).
      if (paramUpdateController) paramUpdateController.abort();
      paramUpdateController = new AbortController();
      const { signal } = paramUpdateController;

      try {
        // Which function class this mechanism uses, for the case where the
        // declaration has no `function=` yet (#1200). Read from the model
        // rather than threaded through every caller, since the node already
        // carries it.
        const owner = useModelStore
          .getState()
          .nodes.find((n) => (n.data as { varName?: string } | undefined)?.varName === varName);
        const functionClass = (owner?.data as { function?: { type?: string } | null } | undefined)
          ?.function?.type;

        const data = await sendParamUpdate(
          filePath, varName, paramName, newValue, context, isDefault, false, signal,
          context === "function" ? functionClass : undefined,
        );
        // Reconcile source from backend (canonical)
        if (data.source) {
          setSource(data.source);
        }
        // Update Inspector metadata from re-introspection
        if (data.model) {
          loadModelFromServer(data.model, data.layout);
        }
      } catch (e: any) {
        // Silently ignore aborted requests and transient server-reload errors.
        // The optimistic update already handled the UI; the backend will
        // catch up on the next successful request or on Save (Cmd+S).
        if (e.name === "AbortError") return;
        if (e.message?.includes("reloading")) {
          console.warn("Param persist deferred (server reloading):", e.message);
          return;
        }
        // Only show errors for genuine failures
        setSource(currentSource);
        addNotification("error", `Parameter update failed: ${e.message}`);
      }
    },
    [filePath, setSource, loadModelFromServer, addNotification]
  );

  const handleFunctionTypeChange = useCallback(
    async (varName: string, newFunctionClass: string) => {
      if (!filePath) return;

      recordAction(`Changed function of ${varName} to ${newFunctionClass}`);

      if (functionTypeController) functionTypeController.abort();
      functionTypeController = new AbortController();
      const { signal } = functionTypeController;

      try {
        const data = await sendFunctionTypeUpdate(filePath, varName, newFunctionClass, signal);
        if (data.source) setSource(data.source);
        if (data.model) loadModelFromServer(data.model, data.layout);
      } catch (e: any) {
        if (e.name === "AbortError") return;
        if (e.message?.includes("reloading")) {
          console.warn("Function-type persist deferred (server reloading):", e.message);
          return;
        }
        addNotification("error", `Function change failed: ${e.message}`);
      }
    },
    [filePath, setSource, loadModelFromServer, addNotification]
  );

  const runPortOp = useCallback(
    async (label: string, op: (signal: AbortSignal) => Promise<any>) => {
      if (!filePath) return;
      recordAction(label);
      if (portController) portController.abort();
      portController = new AbortController();
      try {
        const data = await op(portController.signal);
        if (data.source) setSource(data.source);
        if (data.model) loadModelFromServer(data.model, data.layout);
      } catch (e: any) {
        if (e.name === "AbortError") return;
        if (e.message?.includes("reloading")) {
          console.warn("Port op deferred (server reloading):", e.message);
          return;
        }
        addNotification("error", `${label} failed: ${e.message}`);
      }
    },
    [filePath, setSource, loadModelFromServer, addNotification]
  );

  const handlePortRename = useCallback(
    (varName: string, portKind: PortKind, currentNames: string[], oldName: string, newName: string) =>
      runPortOp(
        `Renamed ${portKind} port ${oldName} → ${newName} on ${varName}`,
        (signal) => sendPortRename(filePath!, varName, portKind, currentNames, oldName, newName, signal),
      ),
    [runPortOp, filePath]
  );

  const handlePortAdd = useCallback(
    (varName: string, portKind: PortKind, currentNames: string[], newName: string) =>
      runPortOp(
        `Added ${portKind} port ${newName} to ${varName}`,
        (signal) => sendPortAdd(filePath!, varName, portKind, currentNames, newName, signal),
      ),
    [runPortOp, filePath]
  );

  // Rename a node's display name (#612). Renames the PNL `name=`; collisions
  // against existing node names come back as a 400 shown inline in the header.
  const handleNodeRename = useCallback(
    async (varName: string, currentName: string, newName: string) => {
      if (!newName.trim() || newName.trim() === currentName) {
        setEditingName(false);
        return;
      }
      const err = await renameNode(varName, currentName, newName);
      if (err) {
        setRenameError(err);
      } else {
        setEditingName(false);
        setRenameError(null);
      }
    },
    [],
  );

  const handlePortRemove = useCallback(
    (varName: string, portKind: PortKind, currentNames: string[], portName: string) =>
      runPortOp(
        `Removed ${portKind} port ${portName} from ${varName}`,
        (signal) => sendPortRemove(filePath!, varName, portKind, currentNames, portName, signal),
      ),
    [runPortOp, filePath]
  );

  // #404: persist a port display-name override into the sidecar
  // `<model>.labels.yaml`. Sidecar-only — never touches model.py. Empty
  // `newLabel` clears the override (removes the field, and the row from
  // the YAML if nothing else remains).
  const setModelLabels = useModelStore((s) => s.setModelLabels);
  // #409: scroll-intent setter — Inspector tells the editor to jump
  // to the line for a port we just edited.
  const setYamlScrollIntent = useModelStore((s) => s.setYamlScrollIntent);
  const handlePortDisplayLabel = useCallback(
    async (varName: string, portKind: PortKind, portName: string, newLabel: string) => {
      if (!filePath) return;
      const current = useModelStore.getState().modelLabels ?? {};
      // Deep-ish copy so we don't mutate the store directly before the
      // network round-trip confirms the new state.
      const next: Record<string, any> = JSON.parse(JSON.stringify(current));
      const portsKey = portKind === "input" ? "input_ports" : "output_ports";
      next[varName] = next[varName] ?? {};
      next[varName][portsKey] = next[varName][portsKey] ?? {};
      const trimmed = newLabel.trim();
      if (trimmed) {
        next[varName][portsKey][portName] = next[varName][portsKey][portName] ?? {};
        next[varName][portsKey][portName].display_name = trimmed;
      } else {
        // Remove just the display_name; preserve any element_names that
        // were set alongside it.
        if (next[varName][portsKey][portName]) {
          delete next[varName][portsKey][portName].display_name;
          if (Object.keys(next[varName][portsKey][portName]).length === 0) {
            delete next[varName][portsKey][portName];
          }
          if (Object.keys(next[varName][portsKey]).length === 0) {
            delete next[varName][portsKey];
          }
          if (Object.keys(next[varName]).length === 0) {
            delete next[varName];
          }
        }
      }
      try {
        const resp = await fetch("/api/model/save-labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_path: filePath, labels: next }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          addNotification(
            "error",
            `Failed to save display label: ${err.detail ?? resp.statusText}`,
          );
          return;
        }
        const data = await resp.json();
        setModelLabels(data.labels ?? null);
        // #409: if the user is viewing labels.yaml in the code editor,
        // scroll + flash the line that was just edited. The editor
        // refetches the file when modelLabels changes, so the intent
        // resolves AFTER the new content lands. ts forces useEffect
        // re-firing when the same (node, port) is edited twice in a row.
        setYamlScrollIntent({ node: varName, port: portName, kind: portKind, ts: Date.now() });
      } catch (e: any) {
        addNotification("error", `Failed to save display label: ${e.message}`);
      }
    },
    [filePath, setModelLabels, setYamlScrollIntent, addNotification],
  );

  const gscConditions = useModelStore((s) => s.gscConditions);
  const basicConditions = useModelStore((s) => s.basicConditions);
  const setSelectedNodeId = useModelStore((s) => s.setSelectedNodeId);
  const setSelectedEdgeId = useModelStore((s) => s.setSelectedEdgeId);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  const schedulerConfig = useModelStore((s) => s.schedulerConfig);
  const terminationConditions = useModelStore((s) => s.terminationConditions);

  if (!selectedNode && !selectedEdge) {
    // The Scheduler tab (#380) is the single home for scheduler content; the
    // Inspector's empty state always shows the model overview so the two tabs
    // never render the same panel (#450).
    const diagnostics = useModelStore.getState().diagnostics;
    const compNames = useModelStore.getState().compositionNames;
    const activeComp = useModelStore.getState().activeComposition;
    if (diagnostics && filePath) {
        return (
          <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: s(17), fontWeight: 600 }}>
                {activeComp || compNames[0] || "Model Overview"}
              </span>
              {diagnostics.pnlVersion && (
                <span style={{ fontSize: s(11), color: "var(--pnv-text-faint)" }}>PsyNeuLink {diagnostics.pnlVersion}</span>
              )}
            </div>
            <div style={{ fontSize: s(12), color: "var(--pnv-text-secondary)", lineHeight: 2 }}>
              <div><strong>Compositions:</strong> {diagnostics.compositionCount}</div>
              <div><strong>Mechanisms:</strong> {diagnostics.mechanismCount}</div>
              <div><strong>Projections:</strong> {diagnostics.projectionCount}</div>
              <div><strong>Edges:</strong> {edges.length}</div>
              {diagnostics.editableVars?.length > 0 && (
                <div><strong>Editable:</strong> {diagnostics.editableVars.length} variables</div>
              )}
              {diagnostics.readOnlyVars?.length > 0 && (
                <div style={{ color: "var(--pnv-warning)" }}><strong>View-only:</strong> {diagnostics.readOnlyVars.length} variables</div>
              )}
              {diagnostics.importStyle && (
                <div><strong>Import style:</strong> {diagnostics.importStyle}</div>
              )}
              {diagnostics.isStandardized !== undefined && (
                <div><strong>Format:</strong> {diagnostics.isStandardized ? "standardized" : "free-form"}</div>
              )}
            </div>
            {diagnostics.lineage && (
              <div style={{ marginTop: 10, fontSize: s(11), color: "var(--pnv-text-faint)", borderTop: "1px solid var(--pnv-border-faint)", paddingTop: 8 }}>
                <div style={{ fontWeight: 600, color: "var(--pnv-text-hint)", marginBottom: 4 }} title="Which upstream source this model was vendored from — the exact code being run">
                  Lineage
                </div>
                {diagnostics.lineage.repo && (
                  <div>Vendored from <strong>{diagnostics.lineage.repo}</strong></div>
                )}
                {diagnostics.lineage.sourcePath && (
                  <div>
                    {diagnostics.lineage.url ? (
                      <a
                        href={diagnostics.lineage.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--pnv-primary)", wordBreak: "break-all" }}
                        title="Open the exact upstream source at this commit on GitHub"
                      >
                        {diagnostics.lineage.sourcePath}
                      </a>
                    ) : (
                      <span style={{ wordBreak: "break-all" }}>{diagnostics.lineage.sourcePath}</span>
                    )}
                    {diagnostics.lineage.commit && (
                      <span title={diagnostics.lineage.commitTag || undefined}>
                        {" @ "}{diagnostics.lineage.commit.slice(0, 10)}
                      </span>
                    )}
                  </div>
                )}
                {diagnostics.lineage.vendoredDate && (
                  <div>Vendored {diagnostics.lineage.vendoredDate}</div>
                )}
              </div>
            )}
            {diagnostics.complexity && (
              <div style={{ marginTop: 10, fontSize: s(11), color: "var(--pnv-text-faint)", borderTop: "1px solid var(--pnv-border-faint)", paddingTop: 8 }}>
                <div style={{ fontWeight: 600, color: "var(--pnv-text-hint)", marginBottom: 4 }}>Complexity</div>
                <div>Parameters: {diagnostics.complexity.totalParams}</div>
                <div>Max fan-in: {diagnostics.complexity.maxFanIn} | fan-out: {diagnostics.complexity.maxFanOut}</div>
                {diagnostics.complexity.nestingDepth > 0 && (
                  <div>Nesting depth: {diagnostics.complexity.nestingDepth}</div>
                )}
                {loadTiming && (
                  <div style={{ fontVariantNumeric: "tabular-nums" }}>
                    Load time: {(loadTiming.total / 1000).toFixed(loadTiming.total < 10000 ? 1 : 0)}s
                  </div>
                )}
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: s(11), color: "var(--pnv-text-faint)" }}>
              Select a node or connection to inspect its properties.
            </div>
          </div>
        );
      }
    return (
      <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: s(13) }}>
        Select a node or connection to inspect its properties.
      </div>
    );
  }

  // Shared header with font scale controls
  const renderHeader = (
    label: string,
    type: string,
    line?: number,
    onRename?: (newName: string) => void,
  ) => (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        {onRename && editingName ? (
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename(nameInput);
              else if (e.key === "Escape") {
                setEditingName(false);
                setRenameError(null);
              }
            }}
            onBlur={() => onRename(nameInput)}
            style={{
              fontSize: s(17), fontWeight: 600, fontFamily: "inherit",
              padding: "0 2px", border: "1px solid var(--pnv-primary)", borderRadius: 3, minWidth: 80,
            }}
          />
        ) : (
          <span
            style={{ fontSize: s(17), fontWeight: 600, cursor: onRename ? "text" : "default" }}
            title={onRename ? "Double-click to rename" : undefined}
            onDoubleClick={
              onRename
                ? () => {
                    setNameInput(label);
                    setRenameError(null);
                    setEditingName(true);
                  }
                : undefined
            }
          >
            {label}
          </span>
        )}
        <span style={{ fontSize: s(12), color: "var(--pnv-text-hint)" }}>{type}</span>
        {line && (
          <span style={{ fontSize: s(11), color: "var(--pnv-text-faint)" }}>line {line}</span>
        )}
        {/* #1163: which parts of the layout are yours and which adapt. */}
        {selectedNode && (
          <LayoutOriginChip
            origin={nodeOrigin(selectedNode, lastLayoutPositions)}
            kind="node"
            scale={s}
          />
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <Button kind="small" onClick={zoomOut} title="Decrease font size">A-</Button>
          <Button kind="small" onClick={zoomIn} title="Increase font size">A+</Button>
        </span>
      </div>

      {onRename && renameError && (
        <div style={{ color: "var(--pnv-danger)", fontSize: s(11), marginTop: -6, marginBottom: 8 }}>
          {renameError}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: s(11), color: "var(--pnv-text-faint)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderLeft: "3px solid var(--pnv-customized)", background: "var(--pnv-customized-tint)", borderRadius: 1 }} />
          customized
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--pnv-surface-muted)", border: "1px solid var(--pnv-border-light)", borderRadius: 1 }} />
          at default
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          ↺ reset on hover
        </span>
      </div>
    </>
  );

  // ─── Composition Inspector ───
  if (selectedNode && selectedNode.type === "compositionNode") {
    const compData = selectedNode.data as any;
    return (
      <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: s(17), fontWeight: 600 }}>{compData.label || compData.varName}</span>
          <span style={{ fontSize: s(12), color: "var(--pnv-text-hint)" }}>Composition</span>
          {schedulerConfig.mode && (
            <SchedulerModeToggle mode={schedulerConfig.mode} fontPx={s(11)} />
          )}
          <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            <Button kind="small" onClick={zoomOut} title="Decrease font size">A-</Button>
            <Button kind="small" onClick={zoomIn} title="Increase font size">A+</Button>
          </span>
        </div>

        {/* Execution Order */}
        {schedulerConfig.considerationQueue && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: s(12), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              Execution Order
            </div>
            {schedulerConfig.considerationQueue.map((step, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "4px 8px", marginBottom: 2,
                background: i % 2 === 0 ? "var(--pnv-surface-muted)" : "var(--pnv-surface)", borderRadius: 4,
              }}>
                <span style={{ fontSize: s(11), fontWeight: 700, color: "var(--pnv-text-faint)", minWidth: 28, fontFamily: "monospace" }}>
                  {i + 1}.
                </span>
                <span style={{ fontSize: s(12), fontFamily: "monospace", color: "var(--pnv-text-body)" }}>
                  {step.join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* All conditions */}
        {(basicConditions.length > 0 || gscConditions.length > 0) && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: s(12), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              All Conditions ({basicConditions.length + gscConditions.length})
            </div>
            {basicConditions.map((bc) => (
              <div key={bc.owner} style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "4px 8px", marginBottom: 3,
                background: "var(--pnv-primary-tint)", border: "1px solid var(--pnv-primary-tint-border)", borderRadius: 4,
                cursor: "pointer",
              }}
                onClick={() => {
                  const node = nodes.find((n) => (n.data as any)?.varName === bc.owner);
                  if (node) setSelectedNodeId(node.id);
                }}
              >
                <span style={{ fontSize: s(11), fontWeight: 600, color: "var(--pnv-text-secondary)", minWidth: 60 }}>{bc.owner}</span>
                <span style={{ fontSize: s(11), fontFamily: "monospace", color: "var(--pnv-primary)" }}>
                  {conditionToString(bc.condition)}
                </span>
              </div>
            ))}
            {gscConditions.map((gsc) => {
              const color = GSC_COLORS[gsc.type] || "var(--pnv-gsc-other)";
              return (
                <div key={gsc.id} onClick={() => setSelectedEdgeId(`gsc_${gsc.id}`)} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 8px", marginBottom: 2, cursor: "pointer", borderRadius: 4,
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--pnv-surface-sunken)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: s(10), fontWeight: 600, fontFamily: "monospace", color: "var(--pnv-on-primary)", background: color, padding: "0 5px", borderRadius: 6, lineHeight: "16px" }}>
                    {gsc.type}
                  </span>
                  <span style={{ fontSize: s(11), color: "var(--pnv-text-secondary)" }}>
                    {gsc.owner} → {gsc.nodes.join(", ")}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Termination */}
        <TerminationSection
          terminationConditions={terminationConditions}
          allNodeNames={nodes.filter((n) => n.type === "mechanismNode").map((n) => (n.data as any)?.varName).filter(Boolean)}
          fontScale={fontScale}
        />
      </div>
    );
  }

  // ─── GSC Edge Inspector ───
  if (selectedEdge && (selectedEdge.data as any)?.gscType) {
    const ed = selectedEdge.data as any;
    const gscType = ed.gscType as string;
    const color = ed.color || "var(--pnv-gsc-other)";

    return (
      <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span
            style={{
              fontSize: s(11), fontWeight: 600, fontFamily: "monospace",
              color: "var(--pnv-on-primary)", background: color, padding: "1px 8px",
              borderRadius: 8,
            }}
          >
            {gscType}
          </span>
          <span style={{ fontSize: s(14), fontWeight: 600 }}>Scheduling Condition</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            <Button kind="small" onClick={zoomOut} title="Decrease font size">A-</Button>
            <Button kind="small" onClick={zoomIn} title="Increase font size">A+</Button>
          </span>
        </div>

        {/* Owner */}
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: s(11), color: "var(--pnv-text-faint)", fontWeight: 600 }}>Owner</span>
          <div style={{ fontSize: s(13), marginTop: 2 }}>
            <span
              onClick={() => {
                const ownerNode = nodes.find((n) => (n.data as any)?.varName === ed.owner || n.id === ed.owner);
                if (ownerNode) setSelectedNodeId(ownerNode.id);
              }}
              style={{ color: "var(--pnv-primary)", cursor: "pointer", borderBottom: "1px dotted var(--pnv-primary)" }}
            >
              {ed.owner}
            </span>
          </div>
        </div>

        {/* Target node(s) */}
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: s(11), color: "var(--pnv-text-faint)", fontWeight: 600 }}>
            Target{(ed.nodes?.length || 0) > 1 ? "s" : ""}
          </span>
          <div style={{ fontSize: s(13), marginTop: 2 }}>
            {(ed.nodes || [ed.targetNode]).map((tn: string, i: number) => (
              <span key={tn}>
                {i > 0 && <span style={{ color: "var(--pnv-text-faint)" }}>, </span>}
                <span
                  onClick={() => {
                    const tNode = nodes.find((n) => (n.data as any)?.varName === tn || n.id === tn);
                    if (tNode) setSelectedNodeId(tNode.id);
                  }}
                  style={{ color: "var(--pnv-primary)", cursor: "pointer", borderBottom: "1px dotted var(--pnv-primary)" }}
                >
                  {tn}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Meaning */}
        <div style={{ marginBottom: 12, padding: "6px 10px", background: "var(--pnv-surface-muted)", borderRadius: 6, fontSize: s(12), color: "var(--pnv-text-secondary)" }}>
          {gscType === "BeforeNode" || gscType === "BeforeNodes"
            ? `Ensures ${ed.owner} executes before ${ed.targetNode}`
            : gscType === "AfterNode" || gscType === "AfterNodes"
            ? `Ensures ${ed.owner} executes after ${ed.targetNode}`
            : gscType === "AddEdgeTo"
            ? `Adds a dependency edge from ${ed.owner} to ${ed.targetNode}`
            : gscType === "RemoveEdgeFrom"
            ? `Removes the dependency edge from ${ed.targetNode} to ${ed.owner}`
            : gscType === "WithNode"
            ? `Co-schedules ${ed.owner} with ${ed.targetNode} (same dependencies)`
            : `Custom graph structure condition on ${ed.owner}`}
        </div>

        {/* Operation params */}
        {Object.keys(ed.params || {}).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: s(11), color: "var(--pnv-text-faint)", fontWeight: 600, marginBottom: 4 }}>
              Operations
            </div>
            {Object.entries(ed.params).map(([key, val]) => (
              <div
                key={key}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "3px 6px", marginBottom: 1, fontSize: s(12),
                }}
              >
                <span style={{ color: "var(--pnv-text-secondary)" }}>{key}</span>
                <span style={{ fontFamily: "monospace", color: "var(--pnv-text-body)" }}>
                  {typeof val === "object" ? JSON.stringify(val) : String(val)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Delete button */}
        <div style={{ marginTop: 16, borderTop: "1px solid var(--pnv-border-faint)", paddingTop: 12 }}>
          <Button
            kind="danger" size="compact"
            style={{ fontSize: s(13) }}
            onClick={async () => {
              if (!filePath) return;
              if (!confirm(`Remove this ${gscType} condition?`)) return;
              // Record state before change for undo (#1369).
              recordAction(`Removed ${gscType} condition on ${ed.owner}`);
              try {
                const resp = await fetch("/api/model/structural-change", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    file_path: filePath,
                    changes: {
                      action: "remove_gsc",
                      owner_var: ed.owner,
                      gsc_type: gscType,
                      target_var: ed.targetNode,
                    },
                  }),
                });
                if (!resp.ok) return;
                const data = await resp.json();
                setSource(data.source);
                loadModelFromServer(data.model, data.layout);
              } catch {
                addNotification("error", "Failed to remove condition");
              }
            }}
          >
            Remove Condition
          </Button>
        </div>
      </div>
    );
  }

  // ─── Projection Inspector ───
  if (selectedEdge) {
    const ed = selectedEdge.data as any;
    if (!ed) {
      return (
        <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: s(13) }}>
          No projection data available.
        </div>
      );
    }

    return (
      <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
        {renderHeader(ed.label || selectedEdge.id, ed.type || "Projection", ed.line)}

        {/* Connection info */}
        <div style={{ marginBottom: 12, fontSize: s(12), color: "var(--pnv-text-muted)" }}>
          <span style={{ fontWeight: 500 }}>{ed.sender?.mechanism}</span>
          <span style={{ color: "var(--pnv-text-faint)" }}> → </span>
          <span style={{ fontWeight: 500 }}>{ed.receiver?.mechanism}</span>
        </div>

        {/* #1163: shaped by hand, or routed automatically — the edge half of the
            question the node header answers. */}
        <div style={{ marginBottom: 12 }}>
          <LayoutOriginChip
            origin={edgeOrigin(selectedEdge.id, shapedEdges)}
            kind="edge"
            scale={s}
          />
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {ed.function && (
            <ParamSection
              title={`Function: ${ed.function.type}`}
              params={ed.function.params || {}}
              ownerType={ed.function.type}
              onCommit={(key, newVal, defaultValue) =>
                handleParamChange(ed.varName, key, newVal, "function", defaultValue)
              }
              onFocusParam={(key) => scrollToParam(ed.varName, key, "function")}
              fontScale={fontScale}
            />
          )}

          {Object.keys(ed.params || {}).length > 0 && (
            // The projection's own rows: the ones that edit its declaration.
            // A walkthrough edits a matrix here, not in the function's
            // section, which shows the same `matrix` row (#45).
            <div data-testid="projection-params">
              <ParamSection
                title="Projection Parameters"
                params={ed.params}
                ownerType={ed.type}
                onCommit={(key, newVal, defaultValue) =>
                  handleParamChange(ed.varName, key, newVal, "mechanism", defaultValue)
                }
                onFocusParam={(key) => scrollToParam(ed.varName, key, "mechanism")}
                fontScale={fontScale}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── CIM Inspector ───
  if (selectedNode!.type === "cimNode") {
    const cimData = selectedNode!.data as any;
    const cimEdges = edges.filter(
      (e) => e.source === selectedNode!.id || e.target === selectedNode!.id
    );
    const isInput = cimData.cimType === "INPUT_CIM";
    const isOutput = cimData.cimType === "OUTPUT_CIM";

    // Parse port names to extract the mechanism and port they route to/from.
    // PNL format: "INPUT_CIM_outer_a_InputPort-0" → routes to outer_a's InputPort-0
    //             "OUTPUT_CIM_inner_y_RESULT"      → routes from inner_y's RESULT
    const parsePortRoute = (portName: string) => {
      // Strip the CIM prefix (INPUT_CIM_ or OUTPUT_CIM_)
      const stripped = portName
        .replace(/^INPUT_CIM_/, "")
        .replace(/^OUTPUT_CIM_/, "");
      // Split on the last underscore-separated segment that looks like a port name
      const match = stripped.match(/^(.+?)[-_](\d+)[-_](.+)$/) ||
                    stripped.match(/^(.+?)[-_]([A-Z_]+)$/);
      if (match) {
        const mechName = match[1].replace(/-\d+$/, "");
        const portLabel = match[match.length - 1];
        return { mechanism: mechName, port: portLabel };
      }
      return { mechanism: stripped.replace(/-\d+$/, ""), port: "" };
    };

    return (
      <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: s(17), fontWeight: 600 }}>{cimData.label}</span>
          <span style={{ fontSize: s(12), color: "var(--pnv-text-hint)" }}>CompositionInterfaceMechanism</span>
        </div>

        {/* Port Routes — the key information */}
        {(cimData.inputPorts?.length > 0 || cimData.outputPorts?.length > 0) && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              {isInput ? "Input Routes" : isOutput ? "Output Routes" : "Routes"}
            </div>
            {(isInput ? cimData.inputPorts : cimData.outputPorts || []).map((port: any, i: number) => {
              const route = parsePortRoute(port.name);
              return (
                <div key={i} style={{ fontSize: s(12), color: "var(--pnv-text-secondary)", marginBottom: 6, paddingLeft: 4 }}>
                  {isInput ? (
                    <span>
                      <strong>{route.mechanism}</strong>
                      {route.port && <span style={{ color: "var(--pnv-text-faint)" }}> .{route.port}</span>}
                      <span style={{ color: "var(--pnv-text-faint)" }}> [{port.shape?.join(",")}]</span>
                      <span style={{ color: "var(--pnv-text-faint)" }}> → into composition</span>
                    </span>
                  ) : (
                    <span>
                      <span style={{ color: "var(--pnv-text-faint)" }}>from composition → </span>
                      <strong>{route.mechanism}</strong>
                      {route.port && <span style={{ color: "var(--pnv-text-faint)" }}> .{route.port}</span>}
                      <span style={{ color: "var(--pnv-text-faint)" }}> [{port.shape?.join(",")}]</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Function */}
        {cimData.function && (
          <div style={{ fontSize: s(12), color: "var(--pnv-text-muted)", marginBottom: 8 }}>
            <strong>Function:</strong> {cimData.function.type}
          </div>
        )}

        {/* Connections */}
        {cimEdges.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              Connections
            </div>
            {cimEdges.map((e) => {
              const ed = e.data as any;
              const isOutgoing = e.source === selectedNode!.id;
              return (
                <div key={e.id} style={{ fontSize: s(12), color: "var(--pnv-text-secondary)", marginBottom: 4, paddingLeft: 4 }}>
                  {isOutgoing ? "→" : "←"} {isOutgoing ? e.target : e.source}
                  {ed?.type && <span style={{ color: "var(--pnv-text-faint)" }}> ({ed.type})</span>}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: s(11), color: "var(--pnv-text-faint)", fontStyle: "italic" }}>
          CIMs are internal routing nodes managed by PsyNeuLink that formalize
          a composition&apos;s interface — which data enters through which mechanism
          (Input CIM) and which results exit through which mechanism (Output CIM).
          They are not directly editable.
        </div>
      </div>
    );
  }

  // ─── Composition Inspector ───
  if (selectedNode!.type === "compositionNode") {
    const compData = selectedNode!.data as any;
    const compEdges = edges.filter(
      (e) => e.source === selectedNode!.id || e.target === selectedNode!.id
    );
    const childNodes = nodes.filter((n) => n.parentId === selectedNode!.id);
    // Find CIM nodes associated with this composition
    const cimNodes = nodes.filter(
      (n) => n.type === "cimNode"
    );

    return (
      <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: s(17), fontWeight: 600 }}>{compData.label}</span>
          <span style={{ fontSize: s(12), color: "var(--pnv-text-hint)" }}>Composition</span>
          {compData.line && <span style={{ fontSize: s(11), color: "var(--pnv-text-faint)" }}>line {compData.line}</span>}
        </div>

        <div style={{ fontSize: s(12), color: "var(--pnv-text-muted)", marginBottom: 8 }}>
          <strong>Nodes:</strong> {compData.childCount || childNodes.length}
        </div>

        {childNodes.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              Child Nodes
            </div>
            {childNodes.map((n) => (
              <div
                key={n.id}
                style={{ fontSize: s(12), color: "var(--pnv-text-secondary)", marginBottom: 3, paddingLeft: 4, cursor: "pointer" }}
                onClick={() => useModelStore.getState().setSelectedNodeId(n.id)}
              >
                {(n.data as any)?.label || n.id}
                <span style={{ color: "var(--pnv-text-faint)", marginLeft: 6 }}>{(n.data as any)?.type}</span>
              </div>
            ))}
          </div>
        )}

        {compEdges.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              Cross-Composition Projections
            </div>
            {compEdges.map((e) => {
              const ed = e.data as any;
              const isOutgoing = e.source === selectedNode!.id;
              return (
                <div key={e.id} style={{ fontSize: s(12), color: "var(--pnv-text-secondary)", marginBottom: 3, paddingLeft: 4 }}>
                  {isOutgoing ? "→" : "←"} {isOutgoing ? e.target : e.source}
                  {ed?.label && <span style={{ color: "var(--pnv-text-faint)", marginLeft: 6 }}>{ed.label}</span>}
                </div>
              );
            })}
          </div>
        )}

        {cimNodes.length > 0 && (
          <div>
            <div style={{ fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              Interface Mechanisms (CIMs)
            </div>
            {cimNodes.map((n) => (
              <div
                key={n.id}
                style={{ fontSize: s(12), color: "var(--pnv-text-secondary)", marginBottom: 3, paddingLeft: 4, cursor: "pointer" }}
                onClick={() => useModelStore.getState().setSelectedNodeId(n.id)}
              >
                {(n.data as any)?.label || n.id}
                <span style={{ color: "var(--pnv-text-faint)", marginLeft: 6 }}>{(n.data as any)?.cimType?.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Mechanism Inspector ───
  const data = selectedNode!.data as unknown as MechanismData;
  const currentLineMap = useModelStore.getState().lineMap;
  const isViewOnly = data.varName ? !(data.varName in currentLineMap) : false;
  // A view-only node generated by a learning pathway (objective/target) is
  // view-only by design, not because its declaration is non-standard (#822).
  const generatedVars: string[] =
    useModelStore.getState().diagnostics?.generatedVars ?? [];
  const isGenerated = !!data.varName && generatedVars.includes(data.varName);

  // #336 gap 2: dynamic state at the active trace step. Renders only
  // when (a) the user is in a trace, (b) this node has a snapshot at
  // the active step, and (c) the snapshot has a value. The label
  // resolver from #361 Layer 3 makes the values self-describing.
  const stepEntry =
    traceStep !== null
      ? traceStepValues.get(traceStep)?.[data.varName] ??
        traceStepValues.get(traceStep)?.[data.label]
      : undefined;
  const stepLabels = stepEntry
    ? resolveOutputLabels(modelLabels, data.varName, undefined, data.outputPorts) ??
      resolveOutputLabels(modelLabels, data.label, undefined, data.outputPorts)
    : null;
  const stepLabeledLines = stepEntry
    ? labeledValueLines(stepEntry.value, stepLabels)
    : null;
  // #401: detect multi-port values so a mechanism like LC (one output
  // port per modulated target) renders per-port rather than as one
  // ellipsized blob. Null when single-port; existing rendering applies.
  const stepPorts = stepEntry
    ? expandMultiPort(stepEntry.value, data.outputPorts, data.varName, modelLabels) ??
      expandMultiPort(stepEntry.value, data.outputPorts, data.label, modelLabels)
    : null;

  return (
    <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
      {renderHeader(
        data.label,
        data.type,
        data.line,
        data.varName && !isViewOnly
          ? (nn: string) => handleNodeRename(data.varName, data.label, nn)
          : undefined,
      )}

      {/* #660: provenance — in flat view, show which nested composition this
          node was hoisted out of (outermost › innermost). Hidden for
          top-level nodes and in the per-composition (nested) view. */}
      {data.compPath && data.compPath.length > 0 && (
        <div
          data-testid="flat-provenance"
          style={{
            marginBottom: 12,
            padding: "6px 10px",
            background: "var(--pnv-primary-tint)",
            border: "1px solid var(--pnv-primary-tint-border)",
            borderRadius: 4,
            fontSize: s(11),
            color: "var(--pnv-text-secondary)",
          }}
          title="The nested composition path this node was flattened out of"
        >
          <span style={{ color: "var(--pnv-text-hint)", letterSpacing: 0.3 }}>FROM </span>
          {data.compPath.map((c) => c.replace(/-\d+$/, "")).join("  ›  ")}
        </div>
      )}

      {/* #230: PyTorch view — flag nodes the autodiff machinery runs but
          excludes from the gradient calculation (PNL's brown dotted style). */}
      {data.excludeFromGradientCalc && (
        <div
          data-testid="exclude-from-gradient-calc"
          style={{
            marginBottom: 12,
            padding: "6px 10px",
            background: "var(--pnv-role-no-gradient-tint)",
            border: "1px dashed var(--pnv-role-no-gradient-border)",
            borderRadius: 4,
            fontSize: s(11),
            color: "var(--pnv-role-no-gradient)",
          }}
          title="This node executes but is excluded from the autodiff gradient calculation"
        >
          excluded from gradient calculation
        </div>
      )}

      {stepEntry && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 10px",
            background: "var(--pnv-trace-tint)",
            border: "1px solid var(--pnv-trace-border)",
            borderRadius: 4,
            fontSize: s(12),
            fontFamily: "monospace",
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: s(10), color: "var(--pnv-text-muted)", marginBottom: 4, letterSpacing: 0.3 }}>
            VALUE AT THIS STEP
            {stepEntry.trial !== null && (
              <span style={{ color: "var(--pnv-text-faint)", fontWeight: 400 }}>
                {"  ·  trial "}{stepEntry.trial + 1}
              </span>
            )}
          </div>
          {/* Single-port: show the one port name + shape header. For
              multi-port values (#401) each port gets its own labeled row
              below, so the header just notes the port count. */}
          {stepPorts ? (
            <div style={{ color: "var(--pnv-text-hint)", fontSize: s(11) }}>
              {stepPorts.length} output ports
            </div>
          ) : (data.outputPorts || []).length > 0 ? (
            <div style={{ color: "var(--pnv-text-hint)", fontSize: s(11) }}>
              {data.outputPorts![0].name || "OutputPort-0"} · shape ({(data.outputPorts![0].shape || []).join(",") || "scalar"})
            </div>
          ) : null}
          {stepPorts ? (
            <div style={{ marginTop: 4, color: "var(--pnv-trace-value)", wordBreak: "break-all" }}>
              {stepPorts.map((p) => {
                const lines = labeledValueLines(p.value, p.labels);
                return (
                  <div key={p.portName} style={{ marginTop: 2 }}>
                    {/* #404: render display_name (sidecar) in place of the
                        technical port.name when present; technical name on
                        hover for developer cross-reference. */}
                    <div
                      style={{ color: "var(--pnv-text-hint)", fontSize: s(11) }}
                      title={p.displayName ? `port.name = ${p.portName}` : ""}
                    >
                      {p.displayName ?? p.portName}
                    </div>
                    {lines ? (
                      lines.map((line, i) => (
                        <div key={i} style={{ paddingLeft: 8 }}>
                          {line}
                        </div>
                      ))
                    ) : (
                      <div style={{ paddingLeft: 8 }}>
                        {formatLabeledValue(p.value, p.labels, { maxLen: 1000 })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : stepLabeledLines ? (
            <div style={{ marginTop: 4, color: "var(--pnv-trace-value)" }}>
              {stepLabeledLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 4, color: "var(--pnv-trace-value)", wordBreak: "break-all" }}>
              {formatTraceValue(stepEntry.value, 1000)}
            </div>
          )}
        </div>
      )}

      {/* #465: per-node Trajectory — one row per element with an inline
          sparkline of its value across all trials. Renders only when a run's
          results are loaded and this node was exercised by the run. */}
      <TrajectoryCard
        varName={data.varName}
        label={data.label}
        outputPorts={data.outputPorts}
        sFn={s}
      />

      {isViewOnly && (
        <div style={{
          padding: "6px 10px", marginBottom: 10, borderRadius: 4,
          background: "var(--pnv-surface-muted)", border: "1px solid var(--pnv-border-faint)",
          fontSize: s(11), color: "var(--pnv-text-hint)", lineHeight: 1.5,
        }}>
          {isGenerated ? (
            <>
              This node is <strong>generated by a learning pathway</strong> (e.g. an
              objective or target mechanism created by <code style={{ background: "var(--pnv-surface-sunken)", padding: "0 3px", borderRadius: 2 }}>add_&hellip;_learning_pathway</code>).
              It has no source constructor, so it&rsquo;s <strong>view-only by design</strong> and its
              parameters can&rsquo;t be edited from the GUI.
            </>
          ) : (
            <>
              This node is <strong>view-only</strong>. Its declaration doesn&rsquo;t follow the
              <code style={{ background: "var(--pnv-surface-sunken)", padding: "0 3px", borderRadius: 2 }}>
                var = pnl.Type(...)
              </code> pattern, so parameters can&rsquo;t be edited from the GUI. Edit the code directly.
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {data.function && (
          <ParamSection
            titleNode={
              <FunctionHeader
                currentType={data.function.type}
                validTypes={data.function.validTypes}
                readOnly={isViewOnly}
                onChange={(newType) => handleFunctionTypeChange(data.varName, newType)}
                fontScale={fontScale}
              />
            }
            params={data.function.params || {}}
            ownerType={data.function.type}
            onCommit={isViewOnly ? undefined : (key, newVal, defaultValue) =>
              handleParamChange(data.varName, key, newVal, "function", defaultValue)
            }
            onFocusParam={(key) => scrollToParam(data.varName, key, "function")}
            fontScale={fontScale}
            readOnly={isViewOnly}
          />
        )}

        <ParamSection
          title="Mechanism Parameters"
          params={data.params || {}}
          ownerType={data.type}
          onCommit={isViewOnly ? undefined : (key, newVal, defaultValue) =>
            handleParamChange(data.varName, key, newVal, "mechanism", defaultValue)
          }
          onFocusParam={(key) => scrollToParam(data.varName, key, "mechanism")}
          fontScale={fontScale}
          readOnly={isViewOnly}
        />

        {/* Ports */}
        <PortsSection
          varName={data.varName}
          nodeId={selectedNode!.id}
          inputPorts={data.inputPorts || []}
          outputPorts={data.outputPorts || []}
          parameterPorts={data.parameterPorts || []}
          edges={edges}
          readOnly={isViewOnly}
          fontScale={fontScale}
          modelLabels={modelLabels}
          onRename={handlePortRename}
          onAdd={handlePortAdd}
          onRemove={handlePortRemove}
          onSetDisplayLabel={handlePortDisplayLabel}
          onInputShapeChange={(varName, newShape) =>
            handleParamChange(varName, "input_shapes", newShape, "mechanism", undefined)
          }
        />

        {/* Scheduling Conditions */}
        <SchedulingSection
          varName={data.varName}
          gscConditions={gscConditions}
          basicConditions={basicConditions}
          onSelectGSC={(gscId, node) => {
            // The edge ids name both endpoints (#651), so look the edge up (#1370).
            const edgeId = findGscEdgeId(useModelStore.getState().edges, gscId, node);
            if (edgeId) setSelectedEdgeId(edgeId);
          }}
          fontScale={fontScale}
          filePath={filePath}
          setSource={setSource}
          loadModelFromServer={loadModelFromServer}
          addNotification={addNotification}
          allNodeNames={nodes.filter((n) => n.type === "mechanismNode").map((n) => (n.data as any)?.varName).filter(Boolean)}
        />
      </div>
    </div>
  );
}

// ─── TrajectoryCard (#465) ────────────────────────────────────────
//
// Per-node value-across-trials view: one row per element with an inline SVG
// sparkline + first/last value, scoped to the selected mechanism node. Reads
// from the runResultsStore (populated by RunPanel on successful run).
//
// Why inline SVG: matches the panel's lightweight feel and keeps the trajectory
// view independent of Plotly (which the global Run-panel chart uses). Each row
// is small enough that a chart library would be overkill, and several rows
// together stay fast.

function TrajectoryCard({
  varName,
  label,
  outputPorts,
  sFn,
}: {
  varName: string;
  label: string;
  outputPorts?: MechanismData["outputPorts"];
  sFn: (n: number) => number;
}) {
  const results = useRunResults((s) => s.results);
  const modelLabels = useModelStore((s) => s.modelLabels);
  if (!results) return null;

  // Find this node's log. Backend keys logs by varName but may emit a
  // PNL-internal "-N" suffix on some nodes; strip and match as a fallback.
  const log = findLog(results, varName, label);
  if (!log || !log.values || log.values.length === 0) {
    return (
      <div
        style={{
          marginBottom: 12,
          padding: "6px 10px",
          background: "var(--pnv-surface-muted)",
          border: "1px solid var(--pnv-border-faint)",
          borderRadius: 4,
          fontSize: sFn(11),
          color: "var(--pnv-text-faint)",
        }}
      >
        <div style={{ fontSize: sFn(10), color: "var(--pnv-text-muted)", marginBottom: 2, letterSpacing: 0.3 }}>
          TRAJECTORY
        </div>
        This node was not exercised by the most recent run.
      </div>
    );
  }

  // Per-dim series — same shape logic as ResultsChart so multi-row values
  // ([[x,y]]) and flat ([x,y]) both work.
  const firstTrial = log.values[0];
  const flat: unknown = Array.isArray(firstTrial[0]) ? firstTrial[0] : firstTrial;
  const numDims = Array.isArray(flat) ? flat.length : 1;
  const series: number[][] = Array.from({ length: numDims }, (_, dim) =>
    log.values.map((trialVal) => {
      const row = Array.isArray(trialVal[0]) ? trialVal[0] : trialVal;
      const v = Array.isArray(row) ? row[dim] : row;
      return Number(v ?? 0);
    }),
  );

  // Element labels via #361 Layer 3 resolver (same source as the value pill).
  const labels =
    resolveOutputLabels(modelLabels, varName, undefined, outputPorts) ??
    resolveOutputLabels(modelLabels, label, undefined, outputPorts);

  return (
    <div
      style={{
        marginBottom: 12,
        padding: "8px 10px",
        background: "var(--pnv-surface-muted)",
        border: "1px solid var(--pnv-border-faint)",
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: sFn(10), color: "var(--pnv-text-muted)", marginBottom: 6, letterSpacing: 0.3 }}>
        TRAJECTORY
        <span style={{ color: "var(--pnv-text-faint)", fontWeight: 400 }}>
          {"  ·  "}{log.values.length} trial{log.values.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {series.map((vals, dim) => (
          <TrajectoryRow
            key={dim}
            label={labels?.[dim] ?? `[${dim}]`}
            values={vals}
            sFn={sFn}
          />
        ))}
      </div>
    </div>
  );
}

function TrajectoryRow({
  label,
  values,
  sFn,
}: {
  label: string;
  values: number[];
  sFn: (n: number) => number;
}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 120;
  const H = 18;
  const pad = 2;
  const stepX = (W - 2 * pad) / Math.max(values.length - 1, 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (H - 2 * pad) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          minWidth: 100,
          maxWidth: 140,
          fontSize: sFn(11),
          color: "var(--pnv-text-body)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={label}
      >
        {label}
      </div>
      <svg width={W} height={H} style={{ flexShrink: 0 }}>
        <polyline points={points} fill="none" strokeWidth={1.5} style={{ stroke: "var(--pnv-trace-value)" }} />
        {values.map((v, i) => {
          const x = pad + i * stepX;
          const y = pad + (H - 2 * pad) * (1 - (v - min) / range);
          return <circle key={i} cx={x} cy={y} r={1.5} style={{ fill: "var(--pnv-trace-value)" }} />;
        })}
      </svg>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: sFn(10),
          color: "var(--pnv-text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {fmt(values[0])} → {fmt(values[values.length - 1])}
      </div>
    </div>
  );
}

// Resolve a node's log entry: try the exact varName, then the label, then a
// PNL "-N" suffix strip (some nodes get an internal renumbering on the
// backend that the label resolver and the log emitter occasionally disagree
// on, e.g. `color_input-4`).
function findLog(results: RunResults, varName: string, label: string) {
  if (results.logs[varName]) return results.logs[varName];
  if (results.logs[label]) return results.logs[label];
  for (const [k, v] of Object.entries(results.logs)) {
    if (k.replace(/-\d+$/, "") === varName) return v;
    if (k.replace(/-\d+$/, "") === label) return v;
  }
  return null;
}

// ─── PortsSection ────────────────────────────────────────────────

const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_\-]*$/;
// Accepts: 3 | [3] | [3, 2] | (3,) | (3, 2)
const SHAPE_SPEC_PATTERN = /^(\d+|[\[\(]\s*\d+(\s*,\s*\d+)*\s*,?\s*[\]\)])$/;

function nextDefaultPortName(kind: PortKind, existing: string[]): string {
  const prefix = kind === "input" ? "new_input" : "new_output";
  const used = new Set(existing);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${prefix}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}_${Date.now()}`;
}

function countAttachedProjections(
  nodeId: string,
  portKind: PortKind,
  portName: string,
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[],
): number {
  return edges.filter((e) => {
    if (portKind === "output") {
      return e.source === nodeId && e.sourceHandle === portName;
    }
    return e.target === nodeId && e.targetHandle === portName;
  }).length;
}

/** Says whether the selected thing was placed by the user or computed (#1163).
 *
 * Deliberately quiet: automatic placement is the normal case and usually right,
 * so this is a label, not a warning. The tooltip carries the consequence — that
 * a computed position can move when the model changes, and that dragging it is
 * what makes it stay.
 */
function LayoutOriginChip({
  origin,
  kind,
  scale,
}: {
  origin: LayoutOrigin;
  kind: "node" | "edge";
  scale: (n: number) => number;
}) {
  const placed = origin === "placed";
  return (
    <span
      title={originHint(origin, kind)}
      style={{
        fontSize: scale(10),
        padding: "1px 6px",
        borderRadius: 999,
        border: `1px solid ${placed ? "var(--pnv-success-border)" : "var(--pnv-border-light)"}`,
        background: placed ? "var(--pnv-success-tint)" : "var(--pnv-surface-muted)",
        color: placed ? "var(--pnv-success)" : "var(--pnv-text-faint)",
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      {originLabel(origin, kind)}
    </span>
  );
}

function PortsSection({
  varName,
  nodeId,
  inputPorts,
  outputPorts,
  parameterPorts,
  edges,
  readOnly,
  fontScale,
  modelLabels,
  onRename,
  onAdd,
  onRemove,
  onSetDisplayLabel,
  onInputShapeChange,
}: {
  varName: string;
  nodeId: string;
  // #431: thread ``element_names`` through so PortRow can render
  // model-intrinsic labels (Layer 1) alongside the sidecar overrides.
  inputPorts: { name: string; shape: number[]; element_names?: string[] | null }[];
  outputPorts: { name: string; shape: number[]; element_names?: string[] | null }[];
  parameterPorts: { name: string; shape: number[] }[];
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[];
  readOnly: boolean;
  fontScale: number;
  // #404: sidecar labels, threaded so each PortRow can resolve its
  // own display_name and offer inline editing.
  modelLabels: ModelLabels | null;
  onRename: (varName: string, kind: PortKind, names: string[], oldName: string, newName: string) => void;
  onAdd: (varName: string, kind: PortKind, names: string[], newName: string) => void;
  onRemove: (varName: string, kind: PortKind, names: string[], portName: string) => void;
  onSetDisplayLabel: (varName: string, kind: PortKind, portName: string, newLabel: string) => void;
  onInputShapeChange: (varName: string, newShape: string) => void;
}) {
  const s = (base: number) => Math.round(base * fontScale);
  // #409: cursor context from the YAML editor. Read directly from the
  // store here rather than threading as a prop — it's a UI-effect
  // detail that doesn't belong in InspectorPanel's signature.
  const yamlCursorContext = useModelStore((s) => s.yamlCursorContext);
  const inputNames = inputPorts.map((p) => p.name);
  const outputNames = outputPorts.map((p) => p.name);
  // Single-input-port mechanism: shape is just the input_shapes= kwarg, so
  // we can offer in-place editing. With multiple input ports the shape
  // belongs to one element of input_shapes=[…] and per-port shape rewrite
  // isn't supported here yet — keep that case read-only.
  const inputShapeEditable = !readOnly && inputPorts.length === 1;

  const renderList = (
    kind: PortKind,
    ports: { name: string; shape: number[]; element_names?: string[] | null }[],
    names: string[],
  ) => (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: kind === "output" ? 8 : 0, marginBottom: 2 }}>
        <span style={{ fontSize: s(11), fontWeight: 600, color: "var(--pnv-text-muted)" }}>
          {kind === "input" ? "Inputs" : "Outputs"}
        </span>
        {!readOnly && (
          <Button
            kind="small" size="icon"
            style={{ fontSize: s(11) }}
            onClick={() => {
              const proposed = window.prompt(
                `Name for new ${kind} port on ${varName}:`,
                nextDefaultPortName(kind, names),
              );
              if (proposed === null) return;
              const trimmed = proposed.trim();
              if (!trimmed) return;
              if (!PORT_NAME_PATTERN.test(trimmed)) {
                window.alert(
                  `Invalid port name "${trimmed}". Must start with a letter or underscore and contain only letters, digits, underscores, or hyphens.`
                );
                return;
              }
              if (names.includes(trimmed)) {
                window.alert(`Port "${trimmed}" already exists on ${varName}.`);
                return;
              }
              onAdd(varName, kind, names, trimmed);
            }}
            title={`Add ${kind} port`}
          >
            +
          </Button>
        )}
      </div>
      {ports.map((p) => (
        <PortRow
          key={p.name}
          name={p.name}
          shape={p.shape}
          kind={kind}
          // #404: resolve display label from the sidecar (null if unset).
          // PortRow is only used for input/output ports; parameter ports
          // have their own renderer.
          displayName={resolvePortDisplayName(modelLabels, varName, p.name, kind)}
          // #431: resolve element labels with the same three-layer
          // precedence (model-intrinsic first, then sidecar). Null when
          // unset; PortRow hides the row in that case.
          elementNames={
            kind === "input"
              ? resolveInputLabels(modelLabels, varName, p.name, ports)
              : resolveOutputLabels(modelLabels, varName, p.name, ports)
          }
          onSetDisplayLabel={(newLabel) => onSetDisplayLabel(varName, kind, p.name, newLabel)}
          // #409: light up this row when the YAML cursor is parked on it.
          // Reading the store at render is fine since cursor changes are
          // throttled by CodeMirror's update batching.
          isYamlCursorTarget={
            yamlCursorContext?.node === varName &&
            yamlCursorContext?.port === p.name &&
            yamlCursorContext?.kind === kind
          }
          attachedProjections={countAttachedProjections(nodeId, kind, p.name, edges)}
          canRemove={ports.length > 1}
          readOnly={readOnly}
          shapeEditable={kind === "input" && inputShapeEditable}
          shapeReadOnlyReason={
            kind === "output"
              ? "Output port shape is fixed by the mechanism's function (it indexes into owner.value) — not editable independently."
              : inputPorts.length > 1
                ? "Multi-port input shape editing isn't supported here yet — edit input_shapes= in the source."
                : undefined
          }
          fontScale={fontScale}
          onRename={(newName) => {
            if (newName === p.name) return;
            if (!PORT_NAME_PATTERN.test(newName)) {
              window.alert(
                `Invalid port name "${newName}". Must start with a letter or underscore and contain only letters, digits, underscores, or hyphens.`
              );
              return;
            }
            if (names.includes(newName)) {
              window.alert(`Port "${newName}" already exists on ${varName}.`);
              return;
            }
            onRename(varName, kind, names, p.name, newName);
          }}
          onRemove={() => onRemove(varName, kind, names, p.name)}
          onShapeChange={(newShape) => onInputShapeChange(varName, newShape)}
        />
      ))}
    </>
  );

  return (
    <div style={{ minWidth: 200 }}>
      <div style={{ fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
        Ports
      </div>
      {renderList("input", inputPorts, inputNames)}
      {renderList("output", outputPorts, outputNames)}
      {parameterPorts.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, marginBottom: 2 }}>
            <span style={{ fontSize: s(11), fontWeight: 600, color: "var(--pnv-text-muted)" }}>
              Parameters
            </span>
          </div>
          {parameterPorts.map((p) => (
            <div
              key={p.name}
              style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: 4, marginBottom: 2 }}
            >
              <span style={{ fontSize: s(13) }}>{p.name}</span>
              {p.shape.length > 0 && (
                <span style={{ color: "var(--pnv-text-faint)", fontSize: s(12) }}>
                  [{p.shape.join(", ")}]
                </span>
              )}
            </div>
          ))}
          <div style={{ fontSize: s(11), color: "var(--pnv-text-hint)", marginTop: 4, fontStyle: "italic", lineHeight: 1.4 }}>
            Parameter ports are auto-derived from the Mechanism Parameters above; edit those rows to change values.
          </div>
        </>
      )}
    </div>
  );
}

function PortRow({
  name,
  shape,
  kind,
  displayName,
  elementNames,
  attachedProjections,
  canRemove,
  readOnly,
  shapeEditable,
  shapeReadOnlyReason,
  fontScale,
  onRename,
  onRemove,
  onShapeChange,
  onSetDisplayLabel,
  isYamlCursorTarget,
}: {
  name: string;
  shape: number[];
  kind: PortKind;
  // #404: optional sidecar display-name. Null = use technical port.name.
  displayName: string | null;
  // #431: per-element labels resolved via the three-layer precedence
  // (model-intrinsic > sidecar). Null = unset; row is hidden.
  elementNames: string[] | null;
  attachedProjections: number;
  canRemove: boolean;
  readOnly: boolean;
  shapeEditable: boolean;
  shapeReadOnlyReason?: string;
  fontScale: number;
  onRename: (newName: string) => void;
  onRemove: () => void;
  onShapeChange: (newShape: string) => void;
  // #404: write-back path for the display label. Undefined for kinds
  // we don't expose this affordance on (parameter ports).
  onSetDisplayLabel?: (newLabel: string) => void;
  // #409: when true, the YAML editor's cursor is parked on this port's
  // entry. Render a subtle outline so the user can see the bidirectional
  // sync working as they navigate.
  isYamlCursorTarget?: boolean;
}) {
  const s = (base: number) => Math.round(base * fontScale);
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);

  // Display shape in canonical list form so the edit field round-trips
  // (PNL re-introspection always normalizes to a list).
  const shapeDisplay = shape.length > 0 ? `[${shape.join(", ")}]` : "";
  const [shapeDraft, setShapeDraft] = useState(shapeDisplay);
  const [shapeEditing, setShapeEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (!shapeEditing) setShapeDraft(shapeDisplay);
  }, [shapeDisplay, shapeEditing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setDraft(name);
      return;
    }
    onRename(trimmed);
  };

  const commitShape = () => {
    setShapeEditing(false);
    const trimmed = shapeDraft.trim();
    if (!trimmed || trimmed === shapeDisplay) {
      setShapeDraft(shapeDisplay);
      return;
    }
    if (!SHAPE_SPEC_PATTERN.test(trimmed)) {
      window.alert(
        `Invalid shape "${trimmed}". Use an integer (e.g. 3) or a list/tuple of integers (e.g. [3] or (2, 4)).`
      );
      setShapeDraft(shapeDisplay);
      return;
    }
    onShapeChange(trimmed);
  };

  // #404: separate draft state for the sidecar display label. Sync with
  // upstream `displayName` whenever it changes externally (e.g., after
  // /api/model/save-labels returns).
  const [labelDraft, setLabelDraft] = useState(displayName ?? "");
  const [labelEditing, setLabelEditing] = useState(false);
  useEffect(() => {
    if (!labelEditing) setLabelDraft(displayName ?? "");
  }, [displayName, labelEditing]);
  const commitLabel = () => {
    setLabelEditing(false);
    const trimmed = labelDraft.trim();
    const current = displayName ?? "";
    if (trimmed === current) return;
    onSetDisplayLabel?.(trimmed);
  };

  const shapeTitle = shapeEditable
    ? "Edit the input port shape. Use an integer (e.g. 3) or list/tuple (e.g. [3] or (2, 4))."
    : shapeReadOnlyReason ?? "Shape is derived from the source; edit it there.";

  return (
    <div
      style={{
        paddingLeft: 4,
        marginBottom: 4,
        // #409: subtle outline when the YAML cursor is on this port's
        // entry. Same orange tone as the existing cursor-highlight
        // pattern in MechanismNode (~#06b6d4 cyan would also work, but
        // orange/warning ties it to "this is a sidecar artifact, not
        // a source-code edit").
        borderLeft: isYamlCursorTarget
          ? "3px solid var(--pnv-warning)"
          : "3px solid transparent",
        background: isYamlCursorTarget ? "var(--pnv-warning-tint)" : "transparent",
        borderRadius: 3,
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {readOnly ? (
        <span style={{ fontSize: s(13) }}>{name}</span>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setEditing(true); }}
          onFocus={() => setEditing(true)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setDraft(name); setEditing(false); (e.target as HTMLInputElement).blur(); }
          }}
          style={{
            fontSize: s(13), fontFamily: "inherit",
            padding: "1px 4px", border: "1px solid transparent",
            borderRadius: 3, background: "transparent",
            width: Math.max(80, draft.length * 7 + 14),
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--pnv-border-light)"; }}
          onMouseLeave={(e) => { if (!editing) e.currentTarget.style.borderColor = "transparent"; }}
        />
      )}
      {shapeEditable ? (
        <input
          type="text"
          value={shapeDraft}
          onChange={(e) => { setShapeDraft(e.target.value); setShapeEditing(true); }}
          onFocus={() => setShapeEditing(true)}
          onBlur={commitShape}
          onKeyDown={(e) => {
            if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") {
              setShapeDraft(shapeDisplay);
              setShapeEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          title={shapeTitle}
          placeholder="shape"
          style={{
            fontSize: s(12), fontFamily: "inherit", color: "var(--pnv-text-faint)",
            padding: "1px 4px", border: "1px solid transparent",
            borderRadius: 3, background: "transparent",
            width: Math.max(48, shapeDraft.length * 7 + 14),
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--pnv-border-light)"; }}
          onMouseLeave={(e) => { if (!shapeEditing) e.currentTarget.style.borderColor = "transparent"; }}
        />
      ) : (
        shape.length > 0 && (
          <span title={shapeTitle} style={{ color: "var(--pnv-text-faint)", fontSize: s(12), cursor: "help" }}>
            [{shape.join(", ")}]
          </span>
        )
      )}
      {!readOnly && (
        <Button
          kind="small" size="icon" className="pnv-remove-x"
          disabled={!canRemove}
          title={
            !canRemove
              ? `Cannot remove the last ${kind} port — mechanisms must have at least one.`
              : attachedProjections > 0
                ? `Remove (${attachedProjections} attached projection${attachedProjections === 1 ? "" : "s"} will be orphaned)`
                : "Remove port"
          }
          onClick={() => {
            if (attachedProjections > 0) {
              const ok = window.confirm(
                `Port "${name}" has ${attachedProjections} attached projection${attachedProjections === 1 ? "" : "s"}.\n\n` +
                `Removing it will leave ${attachedProjections === 1 ? "that projection" : "those projections"} referencing a port that no longer exists.\n\nProceed?`
              );
              if (!ok) return;
            }
            onRemove();
          }}
          style={{ marginLeft: "auto", fontSize: s(11), cursor: canRemove ? "pointer" : "not-allowed" }}
        >
          ×
        </Button>
      )}
    </div>
    {/* #431: model-intrinsic element labels (resolved with three-layer
        precedence). Read-only row — sidecar override + source-edit are
        the writeback paths. Hidden when the port has no labels. */}
    {elementNames && elementNames.length > 0 && (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 1,
          marginLeft: 8,
          flexWrap: "wrap",
        }}
        title="Element labels (from PsyNeuLink element_names; sidecar overrides if set)"
      >
        <span style={{ fontSize: s(10), color: "var(--pnv-text-faint)" }}>elements:</span>
        {elementNames.map((label, i) => (
          <span
            key={`${label}-${i}`}
            style={{
              fontSize: s(10),
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              color: "var(--pnv-text-secondary)",
              background: "var(--pnv-surface-sunken)",
              padding: "0 4px",
              borderRadius: 2,
            }}
          >
            {label}
          </span>
        ))}
      </div>
    )}
    {/* #404: optional display-label input. Sidecar-only — saves to
        `<model>.labels.yaml`, never touches model.py. Empty clears the
        override. Hidden for parameter ports (no save-back wired). */}
    {onSetDisplayLabel && (
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1, marginLeft: 8 }}>
        <span style={{ fontSize: s(10), color: "var(--pnv-text-faint)" }}>label:</span>
        <input
          type="text"
          value={labelDraft}
          placeholder="(none)"
          onChange={(e) => { setLabelDraft(e.target.value); setLabelEditing(true); }}
          onFocus={() => setLabelEditing(true)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") {
              setLabelDraft(displayName ?? "");
              setLabelEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          title="Display label for this port (sidecar override). Empty = use PsyNeuLink's port.name."
          style={{
            fontSize: s(11), fontFamily: "inherit", color: "var(--pnv-primary)",
            padding: "1px 4px", border: "1px solid transparent",
            borderRadius: 3, background: "transparent",
            width: Math.max(120, labelDraft.length * 7 + 14),
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--pnv-border-light)"; }}
          onMouseLeave={(e) => { if (!labelEditing) e.currentTarget.style.borderColor = "transparent"; }}
        />
      </div>
    )}
    </div>
  );
}

// ─── FunctionHeader ──────────────────────────────────────────────

function FunctionHeader({
  currentType,
  validTypes,
  readOnly,
  onChange,
  fontScale,
}: {
  currentType: string;
  validTypes?: string[];
  readOnly: boolean;
  onChange: (newType: string) => void;
  fontScale: number;
}) {
  const s = (base: number) => Math.round(base * fontScale);

  // If discovery turned up nothing (or just the current type alone), fall back
  // to plain text so we don't show a one-option dropdown.
  const options = validTypes ?? [];
  const hasChoices = options.length > 1;
  if (!hasChoices || readOnly) {
    return <span>Function: {currentType}</span>;
  }

  const ensureCurrent = options.includes(currentType) ? options : [currentType, ...options];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span>Function:</span>
      <select
        value={currentType}
        onChange={(e) => {
          const next = e.target.value;
          if (next !== currentType) onChange(next);
        }}
        title="Change function class. Function-specific parameters reset to the new class's defaults."
        style={{
          fontSize: s(12),
          fontFamily: "inherit",
          fontWeight: 600,
          padding: "1px 4px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 3,
          background: "var(--pnv-surface)",
          color: "var(--pnv-text-body)",
          cursor: "pointer",
        }}
      >
        {ensureCurrent.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </span>
  );
}

// ─── ParamSection ────────────────────────────────────────────────

function ParamSection({
  title,
  titleNode,
  params,
  ownerType,
  onCommit,
  onFocusParam,
  fontScale,
  readOnly = false,
}: {
  title?: string;
  titleNode?: React.ReactNode;
  params: Record<string, ParamMeta | unknown>;
  /** Class name of the object that owns these params (e.g. "MappingProjection",
   *  "TransferMechanism", "Linear"). Used to look up enum dropdowns from the
   *  paramEnums registry — see #217. */
  ownerType?: string;
  onCommit?: (key: string, newVal: string, defaultValue?: unknown) => void;
  onFocusParam: (key: string) => void;
  fontScale: number;
  readOnly?: boolean;
}) {
  const s = (base: number) => Math.round(base * fontScale);

  const editable: [string, ParamMeta][] = [];
  const inherited: [string, ParamMeta][] = [];
  const legacy: [string, unknown][] = [];

  for (const [key, val] of Object.entries(params)) {
    if (isParamMeta(val)) {
      if (val.editable) editable.push([key, val]);
      else inherited.push([key, val]);
    } else {
      legacy.push([key, val]);
    }
  }

  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
        {titleNode ?? title}
      </div>

      {editable.map(([key, meta]) => {
        const enumSet = getEnumChoices(ownerType, key);
        if (enumSet) {
          return (
            <EnumParamRow
              key={key}
              label={key}
              value={meta.value}
              defaultValue={meta.default}
              isDefault={meta.isDefault}
              choiceSet={enumSet}
              onCommit={readOnly ? undefined : (newVal) => onCommit?.(key, newVal, meta.default)}
              onFocus={() => onFocusParam(key)}
              fontScale={fontScale}
              readOnly={readOnly}
            />
          );
        }
        return (
          <FieldRow
            key={key}
            label={key}
            value={meta.value}
            defaultValue={meta.default}
            isDefault={meta.isDefault}
            onCommit={readOnly ? undefined : (newVal) => onCommit?.(key, newVal, meta.default)}
            onFocus={() => onFocusParam(key)}
            fontScale={fontScale}
            readOnly={readOnly}
          />
        );
      })}

      {legacy.map(([key, val]) => {
        const enumSet = getEnumChoices(ownerType, key);
        if (enumSet) {
          return (
            <EnumParamRow
              key={key}
              label={key}
              value={val}
              choiceSet={enumSet}
              onCommit={readOnly ? undefined : (newVal) => onCommit?.(key, newVal)}
              onFocus={() => onFocusParam(key)}
              fontScale={fontScale}
              readOnly={readOnly}
            />
          );
        }
        return (
          <FieldRow
            key={key}
            label={key}
            value={val}
            onCommit={readOnly ? undefined : (newVal) => onCommit?.(key, newVal)}
            onFocus={() => onFocusParam(key)}
            fontScale={fontScale}
            readOnly={readOnly}
          />
        );
      })}

      {editable.length === 0 && legacy.length === 0 && inherited.length === 0 && (
        <div style={{ color: "var(--pnv-text-faint)", fontSize: s(13) }}>No parameters</div>
      )}

      {inherited.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: s(11), color: "var(--pnv-text-faint)", cursor: "pointer", userSelect: "none", padding: "2px 0" }}>
            Inherited ({inherited.length})
          </summary>
          <div style={{ marginTop: 4 }}>
            {inherited.map(([key, meta]) => (
              <div
                key={key}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "2px 0", gap: 12, opacity: 0.5,
                }}
                title="Inherited — not a constructor parameter"
              >
                <span style={{ color: "var(--pnv-text-faint)", fontSize: s(12), flexShrink: 0 }}>{key}</span>
                <span style={{ fontSize: s(12), fontFamily: "monospace", color: "var(--pnv-text-faint)", textAlign: "right" }}>
                  {meta.value === null || meta.value === undefined ? ""
                    : typeof meta.value === "object" ? JSON.stringify(meta.value)
                    : String(meta.value)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── SchedulingSection ──────────────────────────────────────────

export const GSC_COLORS: Record<string, string> = {
  BeforeNode: "var(--pnv-gsc-before)", BeforeNodes: "var(--pnv-gsc-before)",
  AfterNode: "var(--pnv-gsc-after)", AfterNodes: "var(--pnv-gsc-after)",
  AddEdgeTo: "var(--pnv-gsc-add-edge)",
  RemoveEdgeFrom: "var(--pnv-gsc-remove-edge)",
  WithNode: "var(--pnv-gsc-with)",
};

/** Render a condition tree as a readable string. */
export function conditionToString(cond: ConditionInfo): string {
  if (cond.children) {
    const kids = cond.children.map((c) => conditionToString(c as ConditionInfo)).join(", ");
    if (cond.type === "Not") return `Not(${kids})`;
    return `${cond.type}(${kids})`;
  }
  const args = cond.args?.positional as unknown[] | undefined;
  if (args && args.length > 0) {
    const parts = args.map((a: unknown) => {
      if (a && typeof a === "object" && "_node" in (a as Record<string, unknown>)) {
        return (a as Record<string, unknown>)._node as string;
      }
      return String(a);
    });
    return `${cond.type}(${parts.join(", ")})`;
  }
  return cond.type;
}

const GSC_TYPES = ["BeforeNode", "AfterNode", "AddEdgeTo", "RemoveEdgeFrom", "WithNode"] as const;

function SchedulingSection({
  varName,
  gscConditions,
  basicConditions,
  onSelectGSC,
  fontScale,
  filePath,
  setSource,
  loadModelFromServer,
  addNotification,
  allNodeNames,
}: {
  varName: string;
  gscConditions: GSCInfo[];
  basicConditions: BasicConditionEntry[];
  /** `node`: the target whose row was clicked, to pick its edge (#1370). */
  onSelectGSC: (gscId: string, node?: string) => void;
  fontScale: number;
  filePath: string | null;
  setSource: (s: string) => void;
  loadModelFromServer: (m: any, l?: any) => void;
  addNotification: (type: "error" | "warning" | "info" | "success", msg: string) => void;
  allNodeNames: string[];
}) {
  const s = (base: number) => Math.round(base * fontScale);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState<string>("BeforeNode");
  const [addTarget, setAddTarget] = useState<string>("");
  const [adding, setAdding] = useState(false);
  // Execution-condition builder visibility: false | "add" | "edit".
  const [builderMode, setBuilderMode] = useState<false | "add" | "edit">(false);

  // Other nodes this node could target (exclude self)
  const targetOptions = allNodeNames.filter((n) => n !== varName);

  // Find GSCs where this node is the owner
  const ownerConditions = gscConditions.filter((g) => g.owner === varName);

  // Also find GSCs where this node is a target
  const targetConditions = gscConditions.filter(
    (g) => g.owner !== varName && g.nodes.includes(varName)
  );

  // Find basic condition for this node
  const basicCond = basicConditions.find((b) => b.owner === varName);

  const hasAny = ownerConditions.length > 0 || targetConditions.length > 0 || !!basicCond;

  return (
    <div style={{ minWidth: 180 }}>
      <div style={{
        fontSize: s(13), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6,
        borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3,
      }}>
        Scheduling
      </div>

      {!hasAny && (
        <div style={{ color: "var(--pnv-text-faint)", fontSize: s(12) }}>No scheduling conditions</div>
      )}

      {/* Basic execution condition */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: s(11), color: "var(--pnv-text-faint)", fontWeight: 600 }}>
            Execution condition
          </span>
          {basicCond && filePath && (
            <Button
              kind="small" size="line" className="pnv-remove-x"
              style={{ fontSize: s(11) }}
              onClick={async () => {
                if (!confirm("Remove this execution condition?")) return;
                // Record state before change for undo (#1369).
                recordAction(`Removed execution condition on ${varName}`);
                try {
                  const resp = await fetch("/api/model/structural-change", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      file_path: filePath,
                      changes: { action: "remove_basic_condition", owner_var: varName },
                    }),
                  });
                  if (!resp.ok) return;
                  const data = await resp.json();
                  setSource(data.source);
                  loadModelFromServer(data.model, data.layout);
                } catch { addNotification("error", "Failed to remove condition"); }
              }}
              title="Remove condition"
            >✕</Button>
          )}
        </div>
        {builderMode ? (
          <ConditionBuilder
            varName={varName}
            allNodeNames={allNodeNames}
            initialSpec={builderMode === "edit" && basicCond ? conditionInfoToSpec(basicCond.condition) : undefined}
            filePath={filePath}
            setSource={setSource}
            loadModelFromServer={loadModelFromServer}
            addNotification={addNotification}
            fontScale={fontScale}
            onDone={() => setBuilderMode(false)}
          />
        ) : basicCond ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div
              onClick={() => {
                const { source, setCursorTargetLine, setActiveParamLine } = useModelStore.getState();
                const lines = source.split("\n");
                const condType = basicCond.condition.type;
                const pattern = new RegExp(
                  `\\.scheduler\\.add_condition\\(\\s*${varName}\\b.*\\b${condType}\\b`
                );
                for (let i = 0; i < lines.length; i++) {
                  if (pattern.test(lines[i])) {
                    setCursorTargetLine(i + 1);
                    setActiveParamLine(i + 1);
                    return;
                  }
                }
              }}
              style={{ cursor: "pointer", flex: 1 }}
              title="Click to show in code"
            >
              <ConditionTree condition={basicCond.condition} fontScale={fontScale} />
            </div>
            {filePath && (
              <Button
                kind="small" size="line"
                style={{ fontSize: s(11) }}
                onClick={() => setBuilderMode("edit")}
                title="Edit condition"
              >Edit</Button>
            )}
          </div>
        ) : filePath ? (
          <Button kind="small" size="tall" style={{ fontSize: s(11) }} onClick={() => setBuilderMode("add")}>
            + Add Execution Condition
          </Button>
        ) : null}
      </div>

      {ownerConditions.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: s(11), color: "var(--pnv-text-faint)", fontWeight: 600, marginBottom: 3 }}>
            Graph conditions (owned)
          </div>
          {ownerConditions.map((gsc) => {
            const color = GSC_COLORS[gsc.type] || "var(--pnv-gsc-other)";
            return (
              <div
                key={gsc.id}
                onClick={() => onSelectGSC(gsc.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 6px", marginBottom: 2, borderRadius: 4,
                  cursor: "pointer", background: "var(--pnv-surface-muted)",
                  border: "1px solid var(--pnv-border-faint)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pnv-surface-sunken)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--pnv-surface-muted)")}
              >
                <span style={{
                  fontSize: s(10), fontWeight: 600, fontFamily: "monospace",
                  color: "var(--pnv-on-primary)", background: color, padding: "0 5px",
                  borderRadius: 6, lineHeight: "16px",
                }}>
                  {gsc.type}
                </span>
                <span style={{ fontSize: s(12), color: "var(--pnv-text-secondary)" }}>
                  → {gsc.nodes.join(", ")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {targetConditions.length > 0 && (
        <div>
          <div style={{ fontSize: s(11), color: "var(--pnv-text-faint)", fontWeight: 600, marginBottom: 3 }}>
            Graph conditions (targeting this node)
          </div>
          {targetConditions.map((gsc) => {
            const color = GSC_COLORS[gsc.type] || "var(--pnv-gsc-other)";
            return (
              <div
                key={gsc.id}
                onClick={() => onSelectGSC(gsc.id, varName)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 6px", marginBottom: 2, borderRadius: 4,
                  cursor: "pointer", background: "var(--pnv-surface-muted)",
                  border: "1px solid var(--pnv-border-faint)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pnv-surface-sunken)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--pnv-surface-muted)")}
              >
                <span style={{
                  fontSize: s(10), fontWeight: 600, fontFamily: "monospace",
                  color: "var(--pnv-on-primary)", background: color, padding: "0 5px",
                  borderRadius: 6, lineHeight: "16px",
                }}>
                  {gsc.type}
                </span>
                <span style={{ fontSize: s(12), color: "var(--pnv-text-secondary)" }}>
                  {gsc.owner} →
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Add condition button / form */}
      {filePath && targetOptions.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--pnv-border-faint)", paddingTop: 8 }}>
          {!showAddForm ? (
            <Button
              kind="small" size="tall"
              style={{ fontSize: s(11) }}
              onClick={() => { setShowAddForm(true); setAddTarget(targetOptions[0]); }}
            >
              + Add Graph Condition
            </Button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value)}
                  style={{ fontSize: s(11), padding: "3px 6px", borderRadius: 4, border: "1px solid var(--pnv-border)" }}
                >
                  {GSC_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <select
                  value={addTarget}
                  onChange={(e) => setAddTarget(e.target.value)}
                  style={{ fontSize: s(11), padding: "3px 6px", borderRadius: 4, border: "1px solid var(--pnv-border)" }}
                >
                  {targetOptions.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  kind="primary" size="tall"
                  style={{ fontSize: s(11), cursor: adding ? "wait" : undefined }}
                  disabled={adding || !addTarget}
                  onClick={async () => {
                    if (!filePath || !addTarget) return;
                    setAdding(true);
                    // Record state before change for undo (#1369).
                    recordAction(`Added ${addType} condition on ${varName}`);
                    try {
                      // Need composition varName
                      const compVarName = useModelStore.getState().compositionNames[0];
                      const resp = await fetch("/api/model/structural-change", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          file_path: filePath,
                          changes: {
                            action: "add_gsc",
                            composition: compVarName,
                            owner_var: varName,
                            gsc_type: addType,
                            target_vars: [addTarget],
                          },
                        }),
                      });
                      if (!resp.ok) {
                        const err = await resp.json();
                        addNotification("error", err.detail || "Failed to add condition");
                        return;
                      }
                      const data = await resp.json();
                      setSource(data.source);
                      loadModelFromServer(data.model, data.layout);
                      setShowAddForm(false);
                    } catch {
                      addNotification("error", "Failed to add condition");
                    } finally {
                      setAdding(false);
                    }
                  }}
                >
                  {adding ? "Adding..." : "Add"}
                </Button>
                <Button kind="secondary" size="tall" style={{ fontSize: s(11) }} onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Condition type metadata ────────────────────────────────────

// Flat (non-composite) PsyNeuLink Condition types reachable from the builder.
// Restricted to those exposed at the top-level `pnl.` namespace whose
// constructors take only a dependency node and/or an integer count, so codegen
// (_build_condition_expr) and round-trip are well-defined. Variadic/composite
// types (All/Any/Not/NWhen, WhenFinishedAny/All, AfterNCallsCombined,
// Threshold) and absolute-time types (TimeInterval/TimeTermination) are
// intentionally excluded here — they need richer argument metadata or a nested
// builder, tracked in #383.
const BASIC_CONDITION_TYPES = [
  // Node + N
  { type: "EveryNCalls", label: "EveryNCalls", needsNode: true, needsN: true },
  { type: "AfterNCalls", label: "AfterNCalls", needsNode: true, needsN: true },
  { type: "BeforeNCalls", label: "BeforeNCalls", needsNode: true, needsN: true },
  { type: "AtNCalls", label: "AtNCalls", needsNode: true, needsN: true },
  { type: "AfterCall", label: "AfterCall", needsNode: true, needsN: true },
  // Node only
  { type: "JustRan", label: "JustRan", needsNode: true, needsN: false },
  { type: "WhenFinished", label: "WhenFinished", needsNode: true, needsN: false },
  // Pass / Count
  { type: "AtPass", label: "AtPass", needsNode: false, needsN: true },
  { type: "AfterPass", label: "AfterPass", needsNode: false, needsN: true },
  { type: "BeforePass", label: "BeforePass", needsNode: false, needsN: true },
  { type: "EveryNPasses", label: "EveryNPasses", needsNode: false, needsN: true },
  // Trial / Count
  { type: "AtTrial", label: "AtTrial", needsNode: false, needsN: true },
  { type: "AfterTrial", label: "AfterTrial", needsNode: false, needsN: true },
  { type: "BeforeTrial", label: "BeforeTrial", needsNode: false, needsN: true },
  { type: "AfterNTrials", label: "AfterNTrials", needsNode: false, needsN: true },
  // TimeStep / Count
  { type: "AtTimeStep", label: "AtTimeStep", needsNode: false, needsN: true },
  { type: "AfterTimeStep", label: "AfterTimeStep", needsNode: false, needsN: true },
  { type: "BeforeTimeStep", label: "BeforeTimeStep", needsNode: false, needsN: true },
  { type: "AfterNTimeSteps", label: "AfterNTimeSteps", needsNode: false, needsN: true },
  // Run / Count
  { type: "AtRun", label: "AtRun", needsNode: false, needsN: true },
  { type: "AfterRun", label: "AfterRun", needsNode: false, needsN: true },
  { type: "AfterNRuns", label: "AfterNRuns", needsNode: false, needsN: true },
  // No args
  { type: "Always", label: "Always", needsNode: false, needsN: false },
  { type: "Never", label: "Never", needsNode: false, needsN: false },
  { type: "AllHaveRun", label: "AllHaveRun", needsNode: false, needsN: false },
  { type: "AtTrialStart", label: "AtTrialStart", needsNode: false, needsN: false },
  { type: "AtRunStart", label: "AtRunStart", needsNode: false, needsN: false },
];

// Recursive editable spec for a (possibly composite) condition.
type CondSpec = {
  type: string;
  dependency?: string;
  n?: number;
  children?: CondSpec[];
};

// Composite condition types whose arguments are other conditions. And/Or are
// internal aliases of All/Any, so only the canonical four are exposed.
const COMPOSITE_COND_TYPES = ["All", "Any", "Not", "NWhen"];

function isCompositeType(t: string): boolean {
  return COMPOSITE_COND_TYPES.includes(t);
}

function defaultSpecForType(type: string, nodes: string[]): CondSpec {
  if (type === "Not" || type === "NWhen") {
    const spec: CondSpec = {
      type,
      children: [defaultSpecForType("WhenFinished", nodes)],
    };
    if (type === "NWhen") spec.n = 1;
    return spec;
  }
  if (type === "All" || type === "Any") {
    return { type, children: [] };
  }
  const meta = BASIC_CONDITION_TYPES.find((t) => t.type === type);
  const spec: CondSpec = { type };
  if (meta?.needsNode) spec.dependency = nodes[0] || "";
  if (meta?.needsN) spec.n = 1;
  return spec;
}

// CondSpec -> backend {type, args} (recursive). Composites carry a children
// list; NWhen also carries n. Flat conditions carry dependency and/or n.
function specToChange(spec: CondSpec): { type: string; args: Record<string, unknown> } {
  if (isCompositeType(spec.type)) {
    const args: Record<string, unknown> = {
      children: (spec.children || []).map(specToChange),
    };
    if (spec.type === "NWhen") args.n = spec.n ?? 1;
    return { type: spec.type, args };
  }
  const args: Record<string, unknown> = {};
  if (spec.dependency) args.dependency = spec.dependency;
  if (spec.n !== undefined) args.n = spec.n;
  return { type: spec.type, args };
}

// Introspected ConditionInfo -> editable CondSpec (recursive), for in-place edit.
function conditionInfoToSpec(info: ConditionInfo): CondSpec {
  if (info.children) {
    const spec: CondSpec = {
      type: info.type,
      children: info.children.map((c) => conditionInfoToSpec(c as ConditionInfo)),
    };
    if (info.type === "NWhen" && typeof info.n === "number") spec.n = info.n;
    return spec;
  }
  const spec: CondSpec = { type: info.type };
  const positional = (info.args?.positional as unknown[] | undefined) ?? [];
  for (const a of positional) {
    if (a && typeof a === "object" && "_node" in (a as Record<string, unknown>)) {
      spec.dependency = (a as Record<string, unknown>)._node as string;
    } else if (typeof a === "number") {
      spec.n = a;
    }
  }
  return spec;
}

// A spec is submittable when every composite has the children it needs and
// every flat condition that requires a node actually names one.
function specIsComplete(spec: CondSpec): boolean {
  if (isCompositeType(spec.type)) {
    const children = spec.children || [];
    if (children.length < 1) return false; // All/Any/Not/NWhen all need ≥1 child
    return children.every(specIsComplete);
  }
  const meta = BASIC_CONDITION_TYPES.find((t) => t.type === spec.type);
  if (meta?.needsNode && !spec.dependency) return false;
  return true;
}

const COND_INPUT_STYLE = {
  fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--pnv-border)",
} as const;

// Recursive editor for one CondSpec node. Composites render nested editors for
// their children (All/Any allow add/remove; Not/NWhen hold exactly one).
function ConditionSpecEditor({
  spec,
  onChange,
  allNodeNames,
  fontScale,
  depth = 0,
}: {
  spec: CondSpec;
  onChange: (next: CondSpec) => void;
  allNodeNames: string[];
  fontScale: number;
  depth?: number;
}) {
  const s = (base: number) => Math.round(base * fontScale);
  const meta = BASIC_CONDITION_TYPES.find((t) => t.type === spec.type);
  const composite = isCompositeType(spec.type);
  const variadic = spec.type === "All" || spec.type === "Any";

  return (
    <div style={{
      border: depth > 0 ? "1px solid var(--pnv-border-faint)" : "none",
      borderRadius: 5, padding: depth > 0 ? 6 : 0, marginBottom: depth > 0 ? 4 : 0,
      background: depth > 0 ? "var(--pnv-surface)" : "transparent",
    }}>
      <select
        value={spec.type}
        onChange={(e) => onChange(defaultSpecForType(e.target.value, allNodeNames))}
        style={{ ...COND_INPUT_STYLE, fontSize: s(11), width: "100%" }}
      >
        <optgroup label="Composite">
          {COMPOSITE_COND_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </optgroup>
        <optgroup label="Node + Count">
          {BASIC_CONDITION_TYPES.filter((t) => t.needsNode && t.needsN).map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </optgroup>
        <optgroup label="Node">
          {BASIC_CONDITION_TYPES.filter((t) => t.needsNode && !t.needsN).map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </optgroup>
        <optgroup label="Pass / Count">
          {BASIC_CONDITION_TYPES.filter((t) => !t.needsNode && t.needsN).map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </optgroup>
        <optgroup label="Static">
          {BASIC_CONDITION_TYPES.filter((t) => !t.needsNode && !t.needsN).map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </optgroup>
      </select>

      {/* Flat args */}
      {!composite && (meta?.needsNode || meta?.needsN) && (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          {meta?.needsNode && (
            <select
              value={spec.dependency || ""}
              onChange={(e) => onChange({ ...spec, dependency: e.target.value })}
              style={{ ...COND_INPUT_STYLE, fontSize: s(11), flex: 1 }}
            >
              {allNodeNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          )}
          {meta?.needsN && (
            <input
              type="number"
              min="1"
              value={spec.n ?? 1}
              onChange={(e) => onChange({ ...spec, n: parseInt(e.target.value) || 1 })}
              style={{ ...COND_INPUT_STYLE, fontSize: s(11), width: 50, textAlign: "center" }}
            />
          )}
        </div>
      )}

      {/* NWhen count */}
      {spec.type === "NWhen" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: s(10), color: "var(--pnv-text-hint)" }}>n =</span>
          <input
            type="number"
            min="1"
            value={spec.n ?? 1}
            onChange={(e) => onChange({ ...spec, n: parseInt(e.target.value) || 1 })}
            style={{ ...COND_INPUT_STYLE, fontSize: s(11), width: 50, textAlign: "center" }}
          />
        </div>
      )}

      {/* Composite children */}
      {composite && (
        <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: "2px solid var(--pnv-border-faint)" }}>
          {(spec.children || []).map((child, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
              <div style={{ flex: 1 }}>
                <ConditionSpecEditor
                  spec={child}
                  onChange={(next) => {
                    const children = [...(spec.children || [])];
                    children[i] = next;
                    onChange({ ...spec, children });
                  }}
                  allNodeNames={allNodeNames}
                  fontScale={fontScale}
                  depth={depth + 1}
                />
              </div>
              {variadic && (
                <Button
                  kind="small" size="line" className="pnv-remove-x"
                  style={{ fontSize: s(11) }}
                  onClick={() => onChange({
                    ...spec,
                    children: (spec.children || []).filter((_, j) => j !== i),
                  })}
                  title="Remove child"
                >✕</Button>
              )}
            </div>
          ))}
          {variadic && (
            <Button
              kind="small"
              style={{ fontSize: s(11), marginTop: 2 }}
              onClick={() => onChange({
                ...spec,
                children: [...(spec.children || []), defaultSpecForType("WhenFinished", allNodeNames)],
              })}
            >+ add child</Button>
          )}
        </div>
      )}
    </div>
  );
}

// Add or edit an execution condition for a node, supporting nested composites.
function ConditionBuilder({
  varName,
  allNodeNames,
  initialSpec,
  filePath,
  setSource,
  loadModelFromServer,
  addNotification,
  fontScale,
  onDone,
}: {
  varName: string;
  allNodeNames: string[];
  initialSpec?: CondSpec;
  filePath: string | null;
  setSource: (s: string) => void;
  loadModelFromServer: (m: any, l?: any) => void;
  addNotification: (type: "error" | "warning" | "info" | "success", msg: string) => void;
  fontScale: number;
  onDone: () => void;
}) {
  const s = (base: number) => Math.round(base * fontScale);
  const otherNodes = allNodeNames.filter((n) => n !== varName);
  const [spec, setSpec] = useState<CondSpec>(
    initialSpec ?? defaultSpecForType("EveryNCalls", otherNodes),
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!filePath) return;
    setSubmitting(true);
    try {
      const compVarName = useModelStore.getState().compositionNames[0];
      const change = specToChange(spec);
      recordAction(`Set execution condition on ${varName}`);
      const resp = await fetch("/api/model/structural-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: filePath,
          changes: {
            action: "add_basic_condition",
            composition: compVarName,
            owner_var: varName,
            condition_type: change.type,
            args: change.args,
          },
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        addNotification("error", err.detail || "Failed to set condition");
        return;
      }
      const data = await resp.json();
      setSource(data.source);
      loadModelFromServer(data.model, data.layout);
      onDone();
    } catch {
      addNotification("error", "Failed to set condition");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 8, background: "var(--pnv-surface-muted)", borderRadius: 6, border: "1px solid var(--pnv-border-faint)" }}>
      <ConditionSpecEditor
        spec={spec}
        onChange={setSpec}
        allNodeNames={otherNodes}
        fontScale={fontScale}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Button
          kind="primary" size="tall"
          style={{ fontSize: s(11), cursor: submitting ? "wait" : undefined }}
          disabled={submitting || !specIsComplete(spec)}
          onClick={submit}
        >
          {submitting ? "Saving..." : "Save"}
        </Button>
        <Button kind="secondary" size="tall" style={{ fontSize: s(11) }} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// TimeScales a termination condition can be keyed on, coarsest → finest.
const TERMINATION_TIME_SCALES = [
  "ENVIRONMENT_SEQUENCE",
  "ENVIRONMENT_STATE_UPDATE",
  "PASS",
  "CONSIDERATION_SET_EXECUTION",
  "LIFE",
];

/**
 * Convert an introspected ConditionInfo back into the {type, args} shape the
 * backend's set_termination action expects. Returns null for composite
 * conditions (All/Any/Not/...) which the codegen can't yet rebuild — callers
 * use that to avoid clobbering conditions they can't faithfully round-trip.
 */
function conditionInfoToChange(
  cond: ConditionInfo,
): { type: string; args: Record<string, unknown> } | null {
  if (cond.children) return null;
  const positional = (cond.args?.positional as unknown[] | undefined) ?? [];
  const args: Record<string, unknown> = {};
  for (const a of positional) {
    if (a && typeof a === "object" && "_node" in (a as Record<string, unknown>)) {
      args.dependency = (a as Record<string, unknown>)._node as string;
    } else if (typeof a === "number") {
      args.n = a;
    }
  }
  return { type: cond.type, args };
}

/**
 * Editable list of termination conditions, keyed by TimeScale. Renders one row
 * per condition with a remove (✕) control plus an inline add form. Every edit
 * POSTs the FULL desired dict (set_termination replaces the whole assignment),
 * so existing conditions are converted back to {type, args} and merged with the
 * patch. If any existing condition is composite (can't be rebuilt by codegen),
 * the section falls back to read-only to avoid silently dropping it.
 */
export function TerminationSection({
  terminationConditions,
  allNodeNames,
  fontScale,
}: {
  terminationConditions: Record<string, ConditionInfo>;
  allNodeNames: string[];
  fontScale: number;
}) {
  const s = (base: number) => Math.round(base * fontScale);
  const entries = Object.entries(terminationConditions);
  const hasComposite = entries.some(([, c]) => !!c.children);

  const [show, setShow] = useState(false);
  const [timeScale, setTimeScale] = useState("ENVIRONMENT_STATE_UPDATE");
  const [condType, setCondType] = useState("AfterNCalls");
  const [depNode, setDepNode] = useState(allNodeNames[0] || "");
  const [nValue, setNValue] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  const meta = BASIC_CONDITION_TYPES.find((t) => t.type === condType);

  const persist = async (next: Record<string, { type: string; args: Record<string, unknown> }>) => {
    const { filePath, setSource, loadModelFromServer, activeComposition, compositionNames } =
      useModelStore.getState();
    const comp = activeComposition || compositionNames[0];
    if (!filePath || !comp) return false;
    recordAction("Edit termination conditions");
    const resp = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: filePath,
        changes: { action: "set_termination", composition: comp, conditions: next },
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      useNotificationStore.getState().addNotification("error", err.detail || "Failed to update termination conditions");
      return false;
    }
    const data = await resp.json();
    setSource(data.source);
    loadModelFromServer(data.model, data.layout);
    return true;
  };

  // Existing conditions, converted to the {type, args} change shape.
  const currentAsChanges = (): Record<string, { type: string; args: Record<string, unknown> }> => {
    const out: Record<string, { type: string; args: Record<string, unknown> }> = {};
    for (const [ts, cond] of entries) {
      const change = conditionInfoToChange(cond);
      if (change) out[ts] = change;
    }
    return out;
  };

  const handleRemove = async (ts: string) => {
    const next = currentAsChanges();
    delete next[ts];
    await persist(next);
  };

  const handleAdd = async () => {
    setSubmitting(true);
    try {
      const args: Record<string, unknown> = {};
      if (meta?.needsNode) args.dependency = depNode;
      if (meta?.needsN) args.n = parseInt(nValue) || 1;
      const next = currentAsChanges();
      next[timeScale] = { type: condType, args };
      if (await persist(next)) setShow(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: s(12), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
        Termination Conditions
      </div>
      {entries.map(([ts, cond]) => (
        <div key={ts} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "4px 8px", marginBottom: 2,
          background: "var(--pnv-primary-tint)", border: "1px solid var(--pnv-primary-tint-border)", borderRadius: 4,
        }}>
          <span style={{ fontSize: s(10), fontWeight: 600, color: "var(--pnv-primary-text-on-tint)", minWidth: 80 }}>
            {ts.replace(/_/g, " ")}
          </span>
          <span
            title={cond.explanation || undefined}
            style={{ fontSize: s(11), fontFamily: "monospace", color: "var(--pnv-text-secondary)", flex: 1 }}
          >
            {conditionToString(cond)}
            {cond.explanation && (
              <span style={{ fontStyle: "italic", color: "var(--pnv-text-faint)", fontFamily: "inherit" }}>
                {" — "}{cond.explanation}
              </span>
            )}
          </span>
          {!hasComposite && (
            <Button
              kind="small" size="icon" className="pnv-remove-x"
              style={{ fontSize: s(11) }}
              onClick={() => handleRemove(ts)}
              title="Remove termination condition"
            >
              ✕
            </Button>
          )}
        </div>
      ))}
      {hasComposite ? (
        <div style={{ fontSize: s(10), color: "var(--pnv-text-faint)", marginTop: 4, fontStyle: "italic" }}>
          Composite conditions are read-only here — edit them in the model source.
        </div>
      ) : !show ? (
        <Button kind="small" size="tall" style={{ fontSize: s(11), marginTop: 4 }} onClick={() => setShow(true)}>
          + Add Termination Condition
        </Button>
      ) : (
        <div style={{ padding: "8px", background: "var(--pnv-surface-muted)", borderRadius: 6, border: "1px solid var(--pnv-border-faint)", marginTop: 4 }}>
          <select
            value={timeScale}
            onChange={(e) => setTimeScale(e.target.value)}
            style={{ fontSize: s(11), padding: "3px 6px", borderRadius: 4, border: "1px solid var(--pnv-border)", width: "100%", marginBottom: 6 }}
          >
            {TERMINATION_TIME_SCALES.map((ts) => (
              <option key={ts} value={ts}>{ts.replace(/_/g, " ")}</option>
            ))}
          </select>
          <select
            value={condType}
            onChange={(e) => setCondType(e.target.value)}
            style={{ fontSize: s(11), padding: "3px 6px", borderRadius: 4, border: "1px solid var(--pnv-border)", width: "100%", marginBottom: 6 }}
          >
            <optgroup label="Node + Count">
              {BASIC_CONDITION_TYPES.filter((t) => t.needsNode && t.needsN).map((t) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Node">
              {BASIC_CONDITION_TYPES.filter((t) => t.needsNode && !t.needsN).map((t) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Pass / Count">
              {BASIC_CONDITION_TYPES.filter((t) => !t.needsNode && t.needsN).map((t) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Static">
              {BASIC_CONDITION_TYPES.filter((t) => !t.needsNode && !t.needsN).map((t) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </optgroup>
          </select>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {meta?.needsNode && (
              <select
                value={depNode}
                onChange={(e) => setDepNode(e.target.value)}
                style={{ fontSize: s(11), padding: "3px 6px", borderRadius: 4, border: "1px solid var(--pnv-border)", flex: 1 }}
              >
                {allNodeNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
            {meta?.needsN && (
              <input
                type="number"
                min="1"
                value={nValue}
                onChange={(e) => setNValue(e.target.value)}
                style={{ fontSize: s(11), padding: "3px 6px", borderRadius: 4, border: "1px solid var(--pnv-border)", width: 50, textAlign: "center" }}
              />
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              kind="primary" size="tall"
              style={{ fontSize: s(11), cursor: submitting ? "wait" : undefined }}
              disabled={submitting || (meta?.needsNode && !depNode)}
              onClick={handleAdd}
            >
              {submitting ? "Saving..." : "Set"}
            </Button>
            <Button kind="secondary" size="tall" style={{ fontSize: s(11) }} onClick={() => setShow(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders a condition as a nested tree with indentation for composites. */
function ConditionTree({
  condition,
  fontScale,
  depth = 0,
}: {
  condition: ConditionInfo;
  fontScale: number;
  depth?: number;
}) {
  const s = (base: number) => Math.round(base * fontScale);
  const isComposite = !!condition.children;

  // Plain-English read-back (#388), shown once beneath the formal form.
  const explanation = depth === 0 && condition.explanation ? (
    <div style={{
      fontSize: s(10), color: "var(--pnv-text-muted)", fontStyle: "italic",
      marginLeft: 2, marginTop: 1, marginBottom: 2,
    }}>
      {condition.explanation}
    </div>
  ) : null;

  if (isComposite) {
    return (
      <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "2px 6px", marginBottom: 2, borderRadius: 4,
          background: depth === 0 ? "var(--pnv-primary-tint)" : "transparent",
          border: depth === 0 ? "1px solid var(--pnv-primary-tint-border)" : "none",
        }}>
          <span style={{
            fontSize: s(11), fontWeight: 700, fontFamily: "monospace",
            color: "var(--pnv-primary-text-on-tint)",
          }}>
            {condition.type}
          </span>
        </div>
        {condition.children!.map((child, i) => (
          <ConditionTree
            key={i}
            condition={child as ConditionInfo}
            fontScale={fontScale}
            depth={depth + 1}
          />
        ))}
        {explanation}
      </div>
    );
  }

  // Leaf condition
  const args = condition.args?.positional as unknown[] | undefined;
  let argStr = "";
  if (args && args.length > 0) {
    const parts = args.map((a: unknown) => {
      if (a && typeof a === "object" && "_node" in (a as Record<string, unknown>)) {
        return (a as Record<string, unknown>)._node as string;
      }
      return String(a);
    });
    argStr = parts.join(", ");
  }

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "2px 6px", marginBottom: 2,
        borderRadius: 4,
        background: depth === 0 ? "var(--pnv-primary-tint)" : "var(--pnv-surface-muted)",
        border: depth === 0 ? "1px solid var(--pnv-primary-tint-border)" : "1px solid var(--pnv-border-faint)",
      }}>
        <span style={{
          fontSize: s(11), fontWeight: 600, fontFamily: "monospace",
          color: "var(--pnv-primary)",
        }}>
          {condition.type}
        </span>
        {argStr && (
          <span style={{ fontSize: s(11), fontFamily: "monospace", color: "var(--pnv-text-secondary)" }}>
            ({argStr})
          </span>
        )}
      </div>
      {explanation}
    </div>
  );
}

// ─── FieldRow ────────────────────────────────────────────────────

function inferType(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "str";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "dict";
  return "";
}

function FieldRow({
  label,
  value,
  defaultValue,
  isDefault,
  onCommit,
  onFocus,
  fontScale = 1,
  readOnly = false,
}: {
  label: string;
  value: unknown;
  defaultValue?: unknown;
  isDefault?: boolean;
  onCommit?: (newValue: string) => void;
  onFocus?: () => void;
  fontScale?: number;
  readOnly?: boolean;
}) {
  const s = (base: number) => Math.round(base * fontScale);

  const displayValue =
    value === null || value === undefined ? ""
      : typeof value === "object" ? JSON.stringify(value)
      : String(value);

  const defaultStr =
    defaultValue === null || defaultValue === undefined ? undefined
      : typeof defaultValue === "object" ? JSON.stringify(defaultValue)
      : String(defaultValue);

  const [localValue, setLocalValue] = useState(displayValue);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitted = useRef(displayValue);

  useEffect(() => {
    setLocalValue(displayValue);
    lastCommitted.current = displayValue;
  }, [displayValue]);

  const commitNow = useCallback(
    (val: string) => {
      if (val !== lastCommitted.current && onCommit) {
        lastCommitted.current = val;
        onCommit(val);
      }
    },
    [onCommit]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commitNow(val), 200);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (timerRef.current) clearTimeout(timerRef.current);
      commitNow(localValue);
    }
  };

  const handleBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    commitNow(localValue);
  };

  const handleReset = () => {
    if (defaultStr !== undefined && onCommit) {
      setLocalValue(defaultStr);
      lastCommitted.current = defaultStr;
      onCommit(defaultStr);
    }
  };

  // Compute modified status locally from current input vs default — instant,
  // no need to wait for backend re-introspection
  const modified = (() => {
    if (defaultStr === undefined) return isDefault === false; // fallback to backend
    if (localValue === defaultStr) return false;
    // Numeric comparison: "0" == "0.0", "1" == "1.0"
    const numLocal = Number(localValue);
    const numDefault = Number(defaultStr);
    if (!isNaN(numLocal) && !isNaN(numDefault) && numLocal === numDefault) return false;
    return true;
  })();

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "3px 0",
        gap: 8,
        borderLeft: focused ? "3px solid var(--pnv-primary)" : modified ? "3px solid var(--pnv-customized)" : "3px solid transparent",
        paddingLeft: 6,
        background: focused ? "var(--pnv-primary-tint)" : modified ? "var(--pnv-customized-tint)" : "transparent",
        borderRadius: modified ? 2 : 0,
        marginBottom: 1,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      {/* Reset button — visible on hover for non-default params */}
      <span
        onClick={modified ? handleReset : undefined}
        title={modified ? "Reset to default" : undefined}
        style={{
          width: 16,
          fontSize: s(13),
          color: "var(--pnv-text-faint)",
          cursor: modified && hovering ? "pointer" : "default",
          opacity: modified && hovering ? 1 : 0,
          transition: "opacity 0.15s",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        {modified ? "↺" : ""}
      </span>

      {/* Label + type hint */}
      <span
        onClick={onFocus}
        title={isDefault ? `${label} — at default value, not written to code` : "Click to show in code"}
        style={{
          color: modified ? "var(--pnv-text-body)" : "var(--pnv-text-muted)",
          fontSize: s(13),
          flexShrink: 0,
          cursor: onFocus ? "pointer" : "default",
          borderBottom: onFocus ? "1px dotted var(--pnv-border)" : "none",
          fontWeight: modified ? 500 : 400,
          display: "flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        {label}
        {defaultValue !== undefined && (
          <span style={{ fontSize: s(9), color: "var(--pnv-text-faint)", fontFamily: "monospace" }}>
            {inferType(defaultValue)}
          </span>
        )}
      </span>

      {/* Value input */}
      <input
        type="text"
        // Stable handle per parameter: param-gain, param-threshold. Guided
        // walkthroughs and specs both need to set a named parameter without
        // hunting for an input by its current value (#1181).
        data-testid={`param-${label}`}
        value={localValue}
        onChange={readOnly ? undefined : handleChange}
        onKeyDown={readOnly ? undefined : handleKeyDown}
        onBlur={() => { setFocused(false); if (!readOnly) handleBlur(); clearParamHighlight(); }}
        onFocus={() => { setFocused(true); onFocus?.(); }}
        readOnly={readOnly}
        disabled={readOnly}
        style={{
          minWidth: 80,
          flex: 1,
          maxWidth: 180,
          padding: "2px 6px",
          border: focused
            ? "1.5px solid var(--pnv-primary)"
            : modified ? "1px solid var(--pnv-customized-border)" : "1px solid var(--pnv-border-light)",
          borderRadius: 3,
          fontSize: s(13),
          textAlign: "right",
          fontFamily: "monospace",
          background: modified ? "var(--pnv-surface)" : "var(--pnv-surface-muted)",
          color: modified ? "var(--pnv-text)" : "var(--pnv-text-hint)",
          outline: focused ? "none" : undefined,
          boxShadow: focused ? "0 0 0 2px var(--pnv-primary-ring)" : "none",
        }}
      />
    </div>
  );
}

// ─── EnumParamRow ───────────────────────────────────────────────
//
// Dropdown variant of FieldRow used when (ownerType, paramName) is in the
// paramEnums registry — see #217. Shows a `<select>` of the registered
// keyword choices plus a "(custom — edit source)" sentinel that switches
// the row into free-text mode for literal values the keyword set doesn't
// cover. The "(custom)" branch reuses FieldRow so editing semantics
// (debounce, default-suppression, focus-to-source jump) match plain rows.

function EnumParamRow({
  label,
  value,
  defaultValue,
  isDefault,
  choiceSet,
  onCommit,
  onFocus,
  fontScale = 1,
  readOnly = false,
}: {
  label: string;
  value: unknown;
  defaultValue?: unknown;
  isDefault?: boolean;
  choiceSet: EnumChoiceSet;
  onCommit?: (newValue: string) => void;
  onFocus?: () => void;
  fontScale?: number;
  readOnly?: boolean;
}) {
  const s = (base: number) => Math.round(base * fontScale);

  const matchedValue = matchEnumChoice(value, choiceSet);
  // "Custom" means the current value doesn't match any keyword choice — fall
  // back to FieldRow so the user can still see and edit the literal.
  const [customMode, setCustomMode] = useState(matchedValue === undefined);

  // If the underlying value changes (e.g. via re-introspection after a source
  // edit) to something that DOES match a keyword, snap back out of custom mode.
  useEffect(() => {
    if (matchedValue !== undefined && customMode) setCustomMode(false);
  }, [matchedValue, customMode]);

  if (customMode || readOnly) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <FieldRow
          label={label}
          value={value}
          defaultValue={defaultValue}
          isDefault={isDefault}
          onCommit={onCommit}
          onFocus={onFocus}
          fontScale={fontScale}
          readOnly={readOnly}
        />
        {!readOnly && (
          <Button
            kind="small"
            style={{ alignSelf: "flex-end", fontSize: s(11) }}
            onClick={() => setCustomMode(false)}
            title={choiceSet.help ?? "Switch to keyword dropdown"}
          >
            ▾ Use keyword
          </Button>
        )}
      </div>
    );
  }

  const CUSTOM_SENTINEL = "__custom__";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", gap: 12 }}>
      <span
        onClick={onFocus}
        title={isDefault ? `${label} — at default value, not written to code` : "Click to show in code"}
        style={{
          color: "var(--pnv-text-body)",
          fontSize: s(13),
          flexShrink: 0,
          cursor: onFocus ? "pointer" : "default",
          borderBottom: onFocus ? "1px dotted var(--pnv-border)" : "none",
          display: "flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        {label}
      </span>
      <select
        value={matchedValue ?? ""}
        title={choiceSet.help}
        onFocus={() => onFocus?.()}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM_SENTINEL) {
            setCustomMode(true);
            return;
          }
          if (next && next !== matchedValue) {
            onCommit?.(next);
          }
        }}
        style={{
          flex: 1,
          maxWidth: 220,
          fontSize: s(12),
          fontFamily: "monospace",
          padding: "2px 4px",
          border: "1px solid var(--pnv-border-light)",
          borderRadius: 3,
          background: "var(--pnv-surface)",
          cursor: "pointer",
        }}
      >
        {choiceSet.choices.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
        <option value={CUSTOM_SENTINEL}>Custom (edit as text)…</option>
      </select>
    </div>
  );
}
