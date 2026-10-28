/**
 * Run panel — configure inputs, execute the model, view results.
 * Shows input fields for each input node, a Run button, and Plotly charts.
 */

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { cellsFromSet, preloadable, setsFor } from "@/utils/inputSets";
import { realInputNodes } from "@/utils/learnPlan";
import { useModelStore, type DebuggerSnapshot, selectExecPath } from "@/stores/modelStore";
import { useStatusStore } from "@/stores/statusStore";
import { useRunRecords, type RunRecord } from "@/stores/runRecordsStore";
import { useRunResults } from "@/stores/runResultsStore";
import { useRunTimingStore } from "@/stores/runTimingStore";
import yaml from "js-yaml";
import { useUIStore, type InputGrouping } from "@/stores/uiStore";
import { ResultsChart } from "./ResultsChart";
import {
  resolveInputLabels,
  resolveOutputLabels,
  formatLabeledValue,
  formatDelta,
  expandMultiPort,
} from "@/utils/labels";
import { formatTraceValue } from "@/utils/traceValues";
import { echoesSubmitted } from "@/utils/runEcho";
import { record as recordActivity } from "@/utils/activityLog";
import { ExecutionModeInfo } from "@/types/model";
import { PnlCallLine } from "./PnlCallLine";
import { Button } from "@/components/common/Button";
import { GridLegend, ValueGrid, ValueViewToggle, poolValues, useNodeGrid } from "@/components/common/ValueGrid";
import { MIN_GRID_SIZE, numericVector } from "@/utils/valueGrid";

interface InputPortInfo {
  name: string;
  shape: number[];
  element_names?: string[] | null;
}

interface InputNodeInfo {
  name: string;
  varName: string;
  shape: number[];
  inputPorts: InputPortInfo[];
}

// Per-element labels for an input node's first port: model-intrinsic /
// sidecar names when available, else positional [0], [1], … so unlabeled
// models still get usable slot headers (#461).
function inputElementLabels(
  node: InputNodeInfo,
  modelLabels: Parameters<typeof resolveInputLabels>[0],
): string[] {
  const size = node.shape[0] || node.inputPorts[0]?.shape?.[0] || 1;
  const portName = node.inputPorts[0]?.name;
  const resolved = portName
    ? resolveInputLabels(modelLabels, node.name, portName, node.inputPorts)
    : null;
  if (resolved && resolved.length === size) return resolved;
  return Array.from({ length: size }, (_, i) => `[${i}]`);
}

/**
 * Normalize a trial's `output` into a list of numeric output vectors so the
 * results table can always render "one labeled row per output vector" (#632),
 * whatever shape PsyNeuLink emits: a 2-D list of vectors (multi-output, e.g.
 * EGO), a single 1-D vector, or a bare scalar. Without this, a non-2-D output
 * (e.g. Cohen & Huston 1994) makes `row.map` throw and — with no ErrorBoundary
 * — unmounts the entire app (white screen, #818).
 */
function toOutputVectors(output: unknown): number[][] {
  if (!Array.isArray(output)) return [[output as number]];
  if (output.length > 0 && output.every((el) => Array.isArray(el)))
    return output as number[][];
  return [output as number[]];
}

// A cell is valid iff it parses to a finite number. Empty / NaN are flagged
// at edit time rather than silently coerced to 0 (the old parseFloat||0 trap).
function isValidCell(s: string): boolean {
  const t = s.trim();
  if (t === "") return false;
  return Number.isFinite(Number(t));
}

interface TrialResult {
  trial: number;
  output: number[][];
}

interface RunResults {
  results: TrialResult[];
  // One label per output vector (output_CIM port), same across trials (#632).
  outputLabels?: string[];
  logs: Record<string, { trials: number[]; values: number[][][] }>;
  numTrials: number;
}

// Snapshot of the inputs that actually produced a run's results, taken at
// submit time so later textarea edits don't retroactively change the per-trial
// cards (#463). `trials[t]` is the 1-D vector submitted for trial t.
interface SubmittedInput {
  name: string;
  varName: string;
  trials: number[][];
}

export function RunPanel() {
  const filePath = useModelStore((s) => s.filePath);
  // #1029: run what the user is looking at. While the buffer has unsaved
  // edits this is the preview file, not the model on disk.
  const execPath = useModelStore(selectExecPath);
  const compositionNames = useModelStore((s) => s.compositionNames);
  const activeComposition = useModelStore((s) => s.activeComposition);
  // Run inputs the model declares itself (#1216); "" = the synthesized defaults.
  const inputSets = useModelStore((s) => s.inputSets);
  const [inputSetName, setInputSetName] = useState("");
  // The file the grid was last filled for, and the set chosen for it, read by
  // the effect below without re-running it: a same-file reload keeps the
  // learner's chosen set (#57).
  const gridFileRef = useRef<string | null>(null);
  const inputSetNameRef = useRef("");
  inputSetNameRef.current = inputSetName;
  const storeNodes = useModelStore((s) => s.nodes);
  const storeEdges = useModelStore((s) => s.edges);
  const modelLabels = useModelStore((s) => s.modelLabels);
  // #475: hook status of the last run — drives the degraded-support note.
  const debuggerHookAvailable = useModelStore((s) => s.debuggerHookAvailable);
  const steppingSupport = useModelStore((s) => s.steppingSupport);
  const inputGrouping = useUIStore((s) => s.inputGrouping);
  const setInputGrouping = useUIStore((s) => s.setInputGrouping);
  const [inputNodes, setInputNodes] = useState<InputNodeInfo[]>([]);
  const [numTrials, setNumTrials] = useState(5);
  // Structured input cells: varName -> trials[] -> elements[] of raw strings.
  // Strings (not numbers) so partial / invalid edits survive without being
  // coerced to 0, and per-cell validation can flag them (#461). All nodes
  // share the trial count (numTrials), matching PsyNeuLink's single input dict.
  const [inputCells, setInputCells] = useState<Record<string, string[][]>>({});
  // Undo stack for trial deletion (#528): each ✕ pushes the removed trial's
  // index + per-node values so a mis-click can be reversed. Cleared whenever
  // the grid is rebuilt wholesale (model change, CSV paste).
  const [removedTrials, setRemovedTrials] = useState<
    Array<{ trial: number; values: Record<string, string[]> }>
  >([]);
  const [results, setResults] = useState<RunResults | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedInput[] | null>(null);
  const [running, setRunning] = useState(false);
  // #764: execution backend for the forward run. Mirrors the Learn panel's
  // selector, but gates on `available` only — every available backend can
  // execute a forward graph; `learnable` is a training-only constraint.
  const [installModes, setInstallModes] = useState<ExecutionModeInfo[]>([]);
  const [executionMode, setExecutionMode] = useState("Python");
  const [error, setError] = useState<string | null>(null);
  // #1101: warnings the worker reported alongside a failure. Kept out of the
  // error text so they cannot bury it, but reachable — several are substantive.
  const [runWarnings, setRunWarnings] = useState<
    { text: string; count: number } | null
  >(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  // #1101: warnings from a run that SUCCEEDED. PsyNeuLink addresses the
  // modeller through UserWarning — a scheduler condition it reinterpreted, a
  // learning target it cannot reach — and those were previously visible only
  // when something else failed. Library deprecations are counted, not shown:
  // on one real model that is 6 worth reading out of 35.
  const [modelWarnings, setModelWarnings] = useState<
    { shown: { category: string; message: string }[]; others: number } | null
  >(null);
  const [otherWarningsOpen, setOtherWarningsOpen] = useState(false);
  const [compositionName, setCompositionName] = useState<string | null>(null);
  // #763: prefer the loaded composition's own matrix (structure x install) over
  // the install-level list, which can't know that a plain Composition has no
  // PyTorch representation to execute. Falls back when a model isn't loaded yet
  // or an older backend didn't send it.
  const compositionMeta = useModelStore((s) => s.compositionMeta);
  // A per-composition entry carries `runnable`; the install-level list only has
  // `available`. Read whichever is present so one selector serves both.
  const runnableOf = (m: ExecutionModeInfo & { runnable?: boolean }) =>
    m.runnable ?? m.available;
  const executionModes = useMemo(() => {
    const perComp = compositionName ? compositionMeta[compositionName]?.executionModes : undefined;
    return perComp ?? installModes;
  }, [compositionName, compositionMeta, installModes]);

  // #894: live "Running… Xs" counter — ticks while a run is in flight so the
  // user has active feedback right at the button. Starts from the run's status
  // timestamp (set when executeRun calls setStatus). Mirrors the load-timing
  // counter the StatusBar shows for loads.
  const runStartedAt = useStatusStore((s) => s.startedAt);
  const [runTick, setRunTick] = useState(0);
  useEffect(() => {
    let active = true;
    fetch("/api/execution-modes")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setInstallModes(data.modes ?? []);
        if (data.defaultRun) setExecutionMode(data.defaultRun);
      })
      .catch(() => {
        // Selector stays hidden; runs still work on the backend default.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    setRunTick(Date.now());
    const id = window.setInterval(() => setRunTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  const runElapsedS =
    running && runStartedAt ? Math.max(0, (runTick - runStartedAt) / 1000) : 0;
  // #894: the last completed run's timing, for the "· ran in X.Xs" record.
  const lastRunTiming = useRunTimingStore((s) => s.last);

  // "Reset run state" clears every visible artifact of the previous run in a
  // single click: the local results (chart + table) and the trace stepper bar
  // (clearTrace). The canvas ✕ on TraceControls is a sibling — it only clears
  // the overlay, not the results in this panel. Issue #293.
  const resetRunState = useCallback(() => {
    setResults(null);
    setSubmitted(null);
    setError(null);
    setRunWarnings(null);
    setModelWarnings(null);
    useModelStore.getState().clearTrace();
    useRunResults.getState().clearResults();
  }, []);

  // A new model (filePath change) must start the panel clean: drop the prior
  // model's results chart/table and error. The store clears its own execution
  // trace + highlights in setFilePath; this resets the panel-local state the
  // store can't reach. Keyed on filePath alone so same-file reloads (edits,
  // collapse toggles) keep an existing run's results visible (#433).
  // Also clears the hoisted results store so the Inspector's per-node
  // Trajectory card (#465) doesn't render stale data after a model swap.
  useEffect(() => {
    setResults(null);
    setSubmitted(null);
    setError(null);
    setRunWarnings(null);
    setModelWarnings(null);
    useRunResults.getState().clearResults();
  }, [filePath]);

  // Derive input nodes from the store — no backend call needed.
  // Input nodes carry the INPUT role (serialized from get_nodes_by_role on the
  // backend, #366). We must NOT infer them from "no incoming edges": BIAS nodes
  // also have no incoming projections but are not INPUT nodes, so run() rejects
  // them (the EGO `CONTEXT [BIAS]` failure, #420).
  useEffect(() => {
    if (!filePath || compositionNames.length === 0 || storeNodes.length === 0) return;

    setCompositionName(activeComposition || compositionNames[compositionNames.length - 1]);

    // Consider top-level nodes only: skip composition group nodes and nested
    // children (parentId set).
    const candidates = storeNodes.filter(
      (node) => node.type !== "compositionNode" && !node.parentId
    );
    const collect = (node: (typeof candidates)[number]): InputNodeInfo => {
      const data = node.data as any;
      const inputPorts: InputPortInfo[] = data?.inputPorts || [];
      const shape = inputPorts[0]?.shape || [];
      return {
        name: data?.label || node.id,
        varName: data?.varName || node.id,
        shape,
        inputPorts,
      };
    };

    // #1383: less a learning pathway's generated nodes. PsyNeuLink gives its
    // TARGET the INPUT role, but a run doesn't learn and takes no targets
    // (PsyNeuLink fills the TARGET with its default).
    const comp = activeComposition || compositionNames[compositionNames.length - 1];
    const profile = useModelStore.getState().compositionMeta[comp]?.learningProfile;
    const roleInputs = realInputNodes(
      candidates.map((node) => ({
        node,
        name: (node.data as any)?.label || node.id,
        roles: ((node.data as any)?.roles || []) as string[],
      })),
      profile,
    ).map((c) => c.node);

    // Fall back to the no-incoming-edges heuristic only if no node carries roles
    // (e.g. a model whose JSON predates role serialization), so the panel never
    // ends up empty.
    let inputs: InputNodeInfo[];
    if (roleInputs.length > 0) {
      inputs = roleInputs.map(collect);
    } else {
      const targetNodeIds = new Set(storeEdges.map((e) => e.target));
      inputs = candidates.filter((node) => !targetNodeIds.has(node.id)).map(collect);
    }

    setInputNodes(inputs);
    const defaults: Record<string, string[][]> = {};
    for (const node of inputs) {
      const size = node.shape[0] || 1;
      defaults[node.varName] = Array.from({ length: numTrials }, (_, t) =>
        Array.from({ length: size }, (_, i) => (i === t % size ? "1" : "0")),
      );
    }
    // #1216: a model that declares its own run inputs opens with the first of
    // them, rather than the synthesized 1-per-trial defaults, unless that set is
    // a whole experiment (then it's in the picker, not preloaded).
    const sets = setsFor(inputSets, "run", comp, compositionNames.length);
    // A same-file reload (a parameter edited in the Inspector, a code save)
    // keeps the set the learner chose. Refilling with the first set or the
    // defaults here silently swapped the inputs under them: the Conflict
    // Monitoring walkthrough picked "incongruent", the reload from its gain
    // edit landed a moment later, and the run used the 1-per-trial defaults
    // (#57).
    const sameFile = gridFileRef.current === filePath;
    gridFileRef.current = filePath;
    const kept = sameFile && inputSetNameRef.current
      ? sets.find((s) => s.name === inputSetNameRef.current)
      : undefined;
    const declared = kept ?? preloadable(sets);
    const fromSet = declared ? cellsFromSet(declared.inputs, inputs) : null;
    if (declared && fromSet) {
      setInputCells(fromSet.cells);
      setNumTrials(fromSet.trials);
      setInputSetName(declared.name);
    } else {
      setInputCells(defaults);
      setInputSetName("");
    }
    setRemovedTrials([]);
  }, [filePath, compositionNames, storeNodes, storeEdges, inputSets]);

  const runSets = useMemo(
    () => setsFor(inputSets, "run", compositionName, compositionNames.length),
    [inputSets, compositionName, compositionNames.length],
  );

  // Switch the grid to a declared set, or back to the synthesized defaults.
  const applyInputSet = useCallback(
    (name: string) => {
      const chosen = runSets.find((s) => s.name === name);
      const fromSet = chosen ? cellsFromSet(chosen.inputs, inputNodes) : null;
      if (fromSet) {
        setInputCells(fromSet.cells);
        setNumTrials(fromSet.trials);
        setInputSetName(name);
      } else {
        const defaults: Record<string, string[][]> = {};
        for (const node of inputNodes) {
          const size = node.shape[0] || 1;
          defaults[node.varName] = Array.from({ length: numTrials }, (_, t) =>
            Array.from({ length: size }, (_, i) => (i === t % size ? "1" : "0")),
          );
        }
        setInputCells(defaults);
        setInputSetName("");
      }
      setRemovedTrials([]);
    },
    [runSets, inputNodes, numTrials],
  );

  // Submit a concrete inputs dict to the backend and wire up the results. Split
  // out from handleRun so a saved run record can be re-submitted with its own
  // frozen inputs (one-click re-run, #468) without going through the live form.
  const executeRun = useCallback(
    async (inputs: Record<string, number[][]>) => {
      if (!filePath || !compositionName) return;
      const { setStatus, clearStatus } = useStatusStore.getState();
      setRunning(true);
      setError(null);
      setRunWarnings(null);
    setModelWarnings(null);
      setResults(null);
      setSubmitted(null);
      setStatus("Running model (this may take a few seconds)...");

      const t0 = performance.now();
      // For the activity log (#1287): started now, finished in `finally` with
      // how it went and how long it took.
      let outcome: "ok" | "failed" = "failed";
      let reason: string | null = null;
      recordActivity("run", `Run started: ${compositionName}`, { composition: compositionName, executionMode });
      try {
        const resp = await fetch("/api/model/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_path: execPath,
            composition_name: compositionName,
            inputs,
            execution_mode: executionMode,
          }),
        });

        if (!resp.ok) {
          const err = await resp.json();
          // #1101: detail is a plain string unless the worker also emitted
          // warnings, in which case it carries them separately so they can be
          // shown without burying the reason the run stopped.
          const detail = err?.detail;
          if (detail && typeof detail === "object") {
            reason = detail.message || "Run failed";
            setError(reason);
            setRunWarnings(
              detail.warnings
                ? { text: detail.warnings, count: detail.warnings_suppressed || 0 }
                : null
            );
          } else {
            reason = detail || "Run failed";
            setError(reason);
            setRunWarnings(null);
    setModelWarnings(null);
          }
          return;
        }

        const data = await resp.json();
        outcome = "ok";
        setResults(data);
        setModelWarnings(data.model_warnings ?? null);
        // #894: record how long the run took — client round-trip + the backend's
        // server-side run_ms — so the Run panel can show "ran in X.Xs" and each
        // pinned record below preserves its own duration across reruns.
        const runMs = performance.now() - t0;
        const serverRunMs = data.timings?.run_ms;
        useRunTimingStore.getState().setLast({
          total: runMs,
          backend: data.timings ?? null,
        });
        // Hoist results into the runResultsStore so the Inspector's per-node
        // Trajectory card (#465) and any future cross-panel views can read them
        // without prop-drilling through the panel tree.
        useRunResults.getState().setResults(data);
        // Freeze the inputs that produced this run so later textarea edits don't
        // retroactively rewrite the per-trial cards (#463).
        const frozen = inputNodes.map((n) => ({
          name: n.name,
          varName: n.varName,
          trials: inputs[n.varName] || [],
        }));
        setSubmitted(frozen);
        // Capture execution trace for graph visualization
        if (data.executionTrace && data.executionTrace.length > 0) {
          useModelStore.getState().setExecutionTrace(
            data.executionTrace,
            data.executionCounts || {},
            data.executionTrialBoundaries || [],
            // #470: pass trial count so trial nav can derive boundaries on
            // hook-less builds where the backend can't supply them.
            data.numTrials,
          );
        }
        // Capture live debugger snapshots (Phase 2A wire-up — array may be
        // empty if the PsyNeuLink build doesn't include the `_debugger` hook).
        useModelStore.getState().setDebuggerSnapshots(data.debuggerSnapshots || []);
        // #475: record whether the build that ran exposes the `_debugger` hook
        // so the run panel + trace bar can explain degraded support. Older
        // backends omit the field — treat that as unknown (null), not hook-less.
        useModelStore
          .getState()
          .setDebuggerHookAvailable(
            typeof data.debuggerHookAvailable === "boolean"
              ? data.debuggerHookAvailable
              : null,
          );
        // #767: record which mode produced this trace, so the stepping UI can
        // say what it means rather than presenting every trace as equivalent.
        useModelStore.getState().setSteppingSupport(data.steppingSupport ?? null);

        // Pin the completed run as a stable, shareable record (#468): inputs
        // are frozen above, paired with the outputs/trace they produced.
        const record: RunRecord = {
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timestamp: new Date().toISOString(),
          modelPath: filePath,
          compositionName,
          numTrials: data.numTrials ?? frozen[0]?.trials.length ?? 0,
          inputs: inputNodes.map((n) => ({
            name: n.name,
            varName: n.varName,
            labels: inputElementLabels(n, modelLabels),
            trials: inputs[n.varName] || [],
          })),
          results: data,
          runMs, // #894: preserve this run's duration in its record
          serverRunMs,
          pnlVersion: useModelStore.getState().diagnostics?.pnlVersion,
          executionTrace: data.executionTrace || [],
          debuggerSnapshots: data.debuggerSnapshots || [],
        };
        useRunRecords.getState().addRecord(record);
      } catch (e: any) {
        reason = e.message || "Run failed";
        setError(reason);
      } finally {
        recordActivity("run", outcome === "ok" ? `Run finished: ${compositionName}` : `Run failed: ${compositionName}`, {
          composition: compositionName,
          outcome,
          durationMs: Math.round(performance.now() - t0),
          ...(reason ? { reason: String(reason).slice(0, 300) } : {}),
        });
        setRunning(false);
        clearStatus();
      }
    },
    [filePath, compositionName, inputNodes, modelLabels, executionMode],
  );

  const handleRun = useCallback(() => {
    // Read the structured cells into numeric trial vectors. Cells are validated
    // at edit time and Run is disabled while any is invalid, so every cell
    // parses to a finite number here.
    const inputs: Record<string, number[][]> = {};
    for (const node of inputNodes) {
      const cells = inputCells[node.varName] || [];
      inputs[node.varName] = cells.map((trial) => trial.map((c) => Number(c.trim())));
    }
    void executeRun(inputs);
  }, [inputNodes, inputCells, executeRun]);

  // Load a record's frozen inputs back into the live form (so the editor
  // reflects them) without running. Shared by re-run and file import (#468).
  const loadRecordIntoForm = useCallback((record: RunRecord) => {
    const cells: Record<string, string[][]> = {};
    for (const inp of record.inputs) {
      cells[inp.varName] = inp.trials.map((row) => row.map((v) => String(v)));
    }
    setInputCells(cells);
    setNumTrials(record.numTrials || record.inputs[0]?.trials.length || 1);
  }, []);

  // Re-run a saved record: reflect its inputs in the form and submit them
  // as-is, so the result is reproduced from the frozen inputs (#468).
  const rerunRecord = useCallback(
    (record: RunRecord) => {
      loadRecordIntoForm(record);
      const inputs: Record<string, number[][]> = {};
      for (const inp of record.inputs) {
        inputs[inp.varName] = inp.trials.map((row) => row.slice());
      }
      void executeRun(inputs);
    },
    [executeRun, loadRecordIntoForm],
  );

  // Import a run file (JSON or YAML, #525) and load its inputs into the form
  // for review / re-run. Surfaces a parse error inline rather than throwing (#468).
  const importRunFile = useCallback(
    async (file: File) => {
      try {
        const record = parseRunFile(await file.text());
        loadRecordIntoForm(record);
        setError(null);
        setRunWarnings(null);
    setModelWarnings(null);
      } catch (e: any) {
        setError(e?.message || "Could not read run file");
      }
    },
    [loadRecordIntoForm],
  );

  const setCell = useCallback(
    (varName: string, trial: number, elem: number, value: string) => {
      setInputCells((prev) => {
        const node = prev[varName];
        if (!node) return prev;
        const next = node.map((row) => row.slice());
        next[trial][elem] = value;
        return { ...prev, [varName]: next };
      });
    },
    [],
  );

  // Trial count is shared across all input nodes (PsyNeuLink runs one input
  // dict with a consistent trial length), so add/remove operate on every node.
  const addTrial = useCallback(() => {
    setInputCells((prev) => {
      const next: Record<string, string[][]> = {};
      for (const [varName, rows] of Object.entries(prev)) {
        const width = rows[0]?.length || 1;
        next[varName] = [...rows.map((r) => r.slice()), Array(width).fill("0")];
      }
      return next;
    });
    setNumTrials((n) => n + 1);
  }, []);

  const removeTrial = useCallback(
    (trial: number) => {
      const values: Record<string, string[]> = {};
      for (const [varName, rows] of Object.entries(inputCells)) {
        if (rows[trial]) values[varName] = rows[trial].slice();
      }
      setRemovedTrials((stack) => [...stack, { trial, values }]);
      setInputCells((prev) => {
        const next: Record<string, string[][]> = {};
        for (const [varName, rows] of Object.entries(prev)) {
          next[varName] = rows.filter((_, i) => i !== trial).map((r) => r.slice());
        }
        return next;
      });
      setNumTrials((n) => Math.max(1, n - 1));
    },
    [inputCells],
  );

  // Reverse the most recent trial deletion: re-insert the saved row at its
  // original index in every node (clamped in case rows were added/removed
  // since). Trial count is re-derived from the grid so the floor-at-1 case in
  // removeTrial can't drift it out of sync.
  const undoRemoveTrial = useCallback(() => {
    const last = removedTrials[removedTrials.length - 1];
    if (!last) return;
    const restoredLength = (Object.values(inputCells)[0]?.length ?? 0) + 1;
    setInputCells((prev) => {
      const next: Record<string, string[][]> = {};
      for (const [varName, rows] of Object.entries(prev)) {
        const width = rows[0]?.length || last.values[varName]?.length || 1;
        const restored = (last.values[varName] ?? Array(width).fill("0")).slice();
        const at = Math.min(last.trial, rows.length);
        next[varName] = [
          ...rows.slice(0, at).map((r) => r.slice()),
          restored,
          ...rows.slice(at).map((r) => r.slice()),
        ];
      }
      return next;
    });
    setNumTrials(restoredLength);
    setRemovedTrials((stack) => stack.slice(0, -1));
  }, [removedTrials, inputCells]);

  // CSV escape hatch: parse a pasted block (newline = trial, comma = element)
  // into the structured cells for one node. Rows are padded/truncated to the
  // node's element width so the grid stays rectangular. The pasted row count
  // becomes the shared trial count, so every other node is padded (zero-filled)
  // or truncated to match — otherwise the input dict would carry mismatched
  // lengths and PsyNeuLink rejects the run.
  const applyCsv = useCallback(
    (varName: string, text: string, width: number) => {
      const rows = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const cells = line.split(",").map((v) => v.trim());
          return Array.from({ length: width }, (_, i) => cells[i] ?? "0");
        });
      if (rows.length === 0) return;
      const trials = rows.length;
      setInputCells((prev) => {
        const next: Record<string, string[][]> = {};
        for (const [k, prevRows] of Object.entries(prev)) {
          if (k === varName) {
            next[k] = rows;
            continue;
          }
          const w = prevRows[0]?.length || 1;
          next[k] = Array.from({ length: trials }, (_, t) =>
            prevRows[t] ? prevRows[t].slice() : Array(w).fill("0"),
          );
        }
        return next;
      });
      setNumTrials(trials);
      // A pasted block reshapes every node's grid; stale snapshots from before
      // the paste would restore rows that no longer fit.
      setRemovedTrials([]);
    },
    [],
  );

  // Any non-numeric / empty cell blocks the run and surfaces inline.
  const hasInvalid = useMemo(
    () =>
      Object.values(inputCells).some((rows) =>
        rows.some((row) => row.some((c) => !isValidCell(c))),
      ),
    [inputCells],
  );

  if (!filePath) {
    return (
      <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-13)" }}>
        Load a model to run it.
      </div>
    );
  }

  return (
    <div
      data-testid="run-panel"
      style={{
        // No vertical padding on the scroll container: the sticky Inputs
        // header pins to top:0 of this box, so any top padding here would
        // leave a band above the header where input content shows through
        // (#498). Vertical spacing lives on the inner wrapper instead.
        padding: "0 16px",
        overflow: "auto",
        height: "100%",
        fontSize: "var(--pnv-fs-13)",
      }}
    >
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "12px 0" }}>
        {/* Input configuration */}
        <div style={{ minWidth: 250 }}>
          {/* Header + Run Model button live in a sticky strip at the top of
              the Run panel so the button is always reachable without scrolling
              past a tall list of input textareas. */}
          <div
            style={{
              position: "sticky",
              top: 0,
              background: "var(--pnv-surface)",
              zIndex: 2,
              paddingBottom: 6,
              borderBottom: "1px solid var(--pnv-border-faint)",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text-body)" }}>
                  Inputs
                </span>
                {inputNodes.length > 0 && (
                  <GroupingToggle value={inputGrouping} onChange={setInputGrouping} />
                )}
                {runSets.length > 0 && (
                  <label
                    style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", whiteSpace: "nowrap" }}
                    title="Inputs this model declares itself, in the shape Composition.run takes (#1216)"
                  >
                    From{" "}
                    <select
                      data-testid="run-input-set"
                      value={inputSetName}
                      onChange={(e) => applyInputSet(e.target.value)}
                      style={{ fontSize: "var(--pnv-fs-12)" }}
                    >
                      {runSets.map((set) => (
                        <option key={set.name} value={set.name}>
                          {set.name}
                        </option>
                      ))}
                      <option value="">defaults (1 per trial)</option>
                    </select>
                  </label>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {executionModes.length > 0 && (
                  <label
                    style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", whiteSpace: "nowrap" }}
                    title={
                      executionModes.find((m) => m.id === executionMode)?.reason ??
                      "Execution backend used for this run"
                    }
                  >
                    Backend{" "}
                    <select
                      value={executionMode}
                      onChange={(e) => setExecutionMode(e.target.value)}
                      disabled={running}
                    >
                      {executionModes.map((m) => (
                        <option
                          key={m.id}
                          value={m.id}
                          disabled={!runnableOf(m)}
                          title={m.reason ?? undefined}
                        >
                          {m.label}
                          {runnableOf(m) ? "" : !m.available ? " — unavailable" : " — not supported"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Button
                  kind="secondary" size="compact"
                  onClick={resetRunState}
                  disabled={running || !results}
                  style={{ whiteSpace: "nowrap" }}
                  title="Clear results, trace bar, and per-trial highlight"
                >
                  Reset
                </Button>
                <Button
                  kind="primary" size="compact"
                  onClick={handleRun}
                  disabled={running || hasInvalid}
                  title={hasInvalid ? "Fix the highlighted input cells first" : undefined}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {running
                    ? `Running… ${runElapsedS.toFixed(1)}s`
                    : "Run Model"}
                </Button>
              </div>
            </div>
            {error && (
              <div
                style={{
                  padding: 8,
                  background: "var(--pnv-danger-tint)",
                  color: "var(--pnv-danger)",
                  borderRadius: 4,
                  fontSize: "var(--pnv-fs-12)",
                }}
              >
                {error}
              </div>
            )}
            {runWarnings && (
              <div style={{ marginTop: 6 }}>
                <button
                  onClick={() => setWarningsOpen((v) => !v)}
                  aria-expanded={warningsOpen}
                  style={{
                    fontSize: "var(--pnv-fs-11)",
                    padding: "2px 8px",
                    border: "1px solid var(--pnv-warning-border)",
                    borderRadius: 3,
                    background: "var(--pnv-warning-tint)",
                    color: "var(--pnv-warning)",
                    cursor: "pointer",
                  }}
                >
                  {warningsOpen ? "Hide" : "Show"} {runWarnings.count}{" "}
                  {runWarnings.count === 1 ? "warning" : "warnings"}
                </button>
                {warningsOpen && (
                  <pre
                    style={{
                      marginTop: 4,
                      padding: 8,
                      background: "var(--pnv-warning-tint)",
                      border: "1px solid var(--pnv-warning-border)",
                      borderRadius: 4,
                      fontSize: "var(--pnv-fs-11)",
                      color: "var(--pnv-warning)",
                      maxHeight: 220,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {runWarnings.text}
                  </pre>
                )}
            {modelWarnings && modelWarnings.shown.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {modelWarnings.shown.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "4px 8px",
                      marginBottom: 2,
                      background: "var(--pnv-warning-tint)",
                      border: "1px solid var(--pnv-warning-border)",
                      borderRadius: 3,
                      fontSize: "var(--pnv-fs-11)",
                      color: "var(--pnv-warning)",
                      lineHeight: 1.45,
                    }}
                  >
                    <span aria-hidden="true">&#9888;</span>
                    <span>{w.message}</span>
                  </div>
                ))}
                {modelWarnings.others > 0 && (
                  <div style={{ marginTop: 2 }}>
                    <Button
                      kind="small"
                      onClick={() => setOtherWarningsOpen((v) => !v)}
                      aria-expanded={otherWarningsOpen}
                    >
                      {otherWarningsOpen ? "Hide" : "Show"} {modelWarnings.others}{" "}
                      library {modelWarnings.others === 1 ? "warning" : "warnings"}
                    </Button>
                    {otherWarningsOpen && (
                      <div style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginTop: 3, paddingLeft: 4 }}>
                        Deprecation and future-version notices from PsyNeuLink's
                        dependencies. Nothing in your model causes these.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
              </div>
            )}
            {hasInvalid && !error && (
              <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-danger)", marginTop: 2 }}>
                Some input cells aren't numbers — fix the highlighted slots to run.
              </div>
            )}
            {removedTrials.length > 0 && (
              <div
                role="status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 4,
                  padding: "4px 8px",
                  background: "var(--pnv-primary-tint)",
                  border: "1px solid var(--pnv-primary-tint-border)",
                  borderRadius: 4,
                  fontSize: "var(--pnv-fs-11)",
                  color: "var(--pnv-text-body)",
                }}
              >
                <span>
                  Trial {removedTrials[removedTrials.length - 1].trial + 1} removed
                  {removedTrials.length > 1 ? ` (+${removedTrials.length - 1} earlier)` : ""}
                </span>
                <Button
                  kind="small"
                  onClick={undoRemoveTrial}
                  title="Restore the removed trial's values in every input node"
                >
                  Undo
                </Button>
              </div>
            )}
          </div>

          {inputGrouping === "byNode" ? (
            inputNodes.map((node) => (
              <InputNodeEditor
                key={node.varName}
                node={node}
                labels={inputElementLabels(node, modelLabels)}
                cells={inputCells[node.varName] || []}
                onCell={setCell}
                onRemoveTrial={removeTrial}
                onApplyCsv={applyCsv}
              />
            ))
          ) : (
            <TrialGroupedEditor
              nodes={inputNodes}
              labelsByVar={Object.fromEntries(
                inputNodes.map((n) => [n.varName, inputElementLabels(n, modelLabels)]),
              )}
              cells={inputCells}
              onCell={setCell}
              onRemoveTrial={removeTrial}
            />
          )}
          {inputNodes.length > 0 && (
            <Button
              kind="small" size="tall"
              onClick={addTrial}
              style={{ marginTop: 2 }}
              title="Append a trial row to every input node"
            >
              + Add trial
            </Button>
          )}
        </div>

        {/* Results */}
        {results && (
          <div style={{ flex: 1, minWidth: 300 }}>
            <div
              style={{
                fontSize: "var(--pnv-fs-12)",
                fontWeight: 600,
                color: "var(--pnv-text-body)",
                marginBottom: 6,
                borderBottom: "1px solid var(--pnv-border-faint)",
                paddingBottom: 3,
              }}
            >
              Results ({results.numTrials} trials)
              {/* #894: a muted record of how long the last run took, mirroring
                  the "loaded in X.Xs" figure the load path shows. */}
              {lastRunTiming && (
                <span
                  style={{ fontWeight: 400, color: "var(--pnv-text-faint)", marginLeft: 6 }}
                  title={
                    lastRunTiming.backend?.run_ms != null
                      ? `server run ${(lastRunTiming.backend.run_ms / 1000).toFixed(1)}s`
                      : undefined
                  }
                >
                  · ran in {(lastRunTiming.total / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            {/* #766: the concrete PsyNeuLink call this run made. */}
            <PnlCallLine
              call={(results as { pnlCall?: string }).pnlCall}
              reason={(results as { executionModeReason?: string | null }).executionModeReason}
            />

            {/* #462/#463: per-trial IN→OUT cards are the default post-run view.
                Each card pairs the inputs submitted for a trial with every
                node's value for that trial, labeled per element. Clicking a
                card jumps the trace stepper to that trial's first step. */}
            {/* #475: explain degraded support when the run came from a build
                without the `_debugger` hook, so the missing per-node value
                pill / snapshots read as "unsupported on this build" rather
                than broken. */}
            {debuggerHookAvailable === false && <HookSupportNote />}
            {steppingSupport && steppingSupport.level !== "full" && (
              <SteppingSupportNote level={steppingSupport.level} reason={steppingSupport.reason} />
            )}
            {(results as { capture?: CaptureInfo }).capture && (
              <CaptureNote capture={(results as { capture?: CaptureInfo }).capture!} />
            )}
            <TrialOutputs results={results} submitted={submitted} />

            {/* #467: Plotly trial-by-trial line charts are no longer the
                default view. They conflate every (node × element) onto a
                single axis and answer "value as a function of trial number,"
                which isn't the question most users are asking after a run.
                Until the new defaults (#462 per-trial labeled outputs,
                #465 per-node trajectories) land, the line charts remain
                reachable behind this collapsed section so existing users
                aren't cut off. */}
            <details style={{ marginTop: 12 }}>
              <summary
                style={{
                  fontSize: "var(--pnv-fs-12)",
                  color: "var(--pnv-text-muted)",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Trial-by-trial line charts
              </summary>
              <ResultsChart results={results} />
            </details>

            {/* Live debugger snapshots (Phase 2B of #247). Visible only when
                the run actually captured any — keeps the UI clean for older
                PsyNeuLink builds that don't ship the `_debugger` hook. */}
            <DebuggerSnapshotTable />

            {/* Collapsible raw data table */}
            <details style={{ marginTop: 12 }}>
              <summary
                style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)", cursor: "pointer" }}
              >
                Raw data
              </summary>
              <table
                style={{
                  fontSize: "var(--pnv-fs-11)",
                  borderCollapse: "collapse",
                  marginTop: 4,
                  width: "100%",
                  fontFamily: "monospace",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "3px 6px", borderBottom: "1px solid var(--pnv-border-light)", color: "var(--pnv-text-muted)" }}>
                      Trial
                    </th>
                    <th style={{ textAlign: "left", padding: "3px 6px", borderBottom: "1px solid var(--pnv-border-light)", color: "var(--pnv-text-muted)" }}>
                      Output
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((r) => (
                    <tr key={r.trial}>
                      {/* 1-indexed for display, raw on hover. #336 gap 5. */}
                      <td
                        style={{ padding: "2px 6px", color: "var(--pnv-text-secondary)" }}
                        title={`trial_num=${r.trial}`}
                      >
                        {r.trial + 1}
                      </td>
                      {/* One labeled row per output vector (output_CIM port),
                          so multi-output models (e.g. EGO) read clearly instead
                          of as one anonymous nested array. #632. */}
                      <td style={{ padding: "2px 6px" }}>
                        {toOutputVectors(r.output).map((row, i) => (
                          <div key={i} style={{ whiteSpace: "nowrap" }}>
                            <span style={{ color: "var(--pnv-text-hint)" }}>
                              {results.outputLabels?.[i] ?? `output[${i}]`}:
                            </span>{" "}
                            {JSON.stringify(row.map((v) => Math.round(v * 10000) / 10000))}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
      </div>

      <RecentRunsList onRerun={rerunRecord} onImport={importRunFile} running={running} />
    </div>
  );
}

/**
 * #475: shown after a run on a PsyNeuLink build without the `_debugger` hook.
 * The per-node value pill and debugger snapshots need the hook; trial nav
 * falls back to an even split (#470). Points the user at Settings to switch
 * to the jonhanke-nam fork for full support.
 */
// #768: what the run actually captured. Only rendered when it differs from
// "everything" — a note that always says "nothing was dropped" is noise.
interface CaptureInfo {
  nodesLogged: number;
  nodesAvailable: number;
  snapshots: number;
  snapshotsDropped: { parameterSetting: number; global: number };
  truncated: boolean;
  /** #768: autodiff runs synthesize values from the torch wrappers rather than
   *  logging them via the scheduler, so "not captured" would be the wrong word
   *  for whatever the wrappers don't expose. */
  synthesized?: boolean;
  caps: { parameterSetting: number; global: number };
}

function CaptureNote({ capture }: { capture: CaptureInfo }) {
  const partialNodes = capture.nodesLogged < capture.nodesAvailable;
  if (!capture.truncated && !partialNodes) return null;

  const dropped =
    capture.snapshotsDropped.parameterSetting + capture.snapshotsDropped.global;
  const kept = capture.snapshots;
  const pct = dropped > 0 ? Math.round((kept / (kept + dropped)) * 100) : 100;

  return (
    <div
      style={{
        margin: "0 0 8px",
        padding: "6px 9px",
        fontSize: "var(--pnv-fs-11)",
        lineHeight: 1.4,
        color: "var(--pnv-warning)",
        background: "var(--pnv-warning-tint)",
        border: "1px solid var(--pnv-warning-border)",
        borderRadius: 4,
      }}
    >
      {capture.truncated && (
        <div>
          <strong>Trace truncated</strong> — kept {kept.toLocaleString()} of{" "}
          {(kept + dropped).toLocaleString()} snapshots ({pct}%).{" "}
          {capture.snapshotsDropped.parameterSetting > 0 && (
            <>
              {capture.snapshotsDropped.parameterSetting.toLocaleString()} parameter-setting
              snapshots were dropped at the {capture.caps.parameterSetting.toLocaleString()} cap,
              which protects trial and execution-set capture from being crowded out.
            </>
          )}
        </div>
      )}
      {partialNodes && (
        <div style={{ marginTop: capture.truncated ? 4 : 0 }}>
          {capture.synthesized ? (
            <>
              Values for {capture.nodesLogged} of {capture.nodesAvailable} nodes — the rest
              aren't exposed by the PyTorch wrappers this run was reconstructed from.
            </>
          ) : (
            <>
              Logging {capture.nodesLogged} of {capture.nodesAvailable} nodes — values for the
              rest were not captured.
            </>
          )}
        </div>
      )}
    </div>
  );
}

// #767: stepping means different things per execution mode — reconstructed on
// the torch path, absent under LLVM. A trace that doesn't say which it is
// invites reading a reconstruction as a recording.
function SteppingSupportNote({ level, reason }: { level: string; reason: string | null }) {
  const degraded = level === "degraded";
  return (
    <div
      style={{
        margin: "0 0 8px",
        padding: "6px 9px",
        fontSize: "var(--pnv-fs-11)",
        lineHeight: 1.4,
        color: degraded ? "var(--pnv-warning)" : "var(--pnv-primary-text-on-tint)",
        background: degraded ? "var(--pnv-warning-tint)" : "var(--pnv-primary-tint)",
        border: `1px solid ${degraded ? "var(--pnv-warning-border)" : "var(--pnv-primary-tint-border)"}`,
        borderRadius: 4,
      }}
    >
      <strong>{degraded ? "Stepping unavailable" : "Stepping is reconstructed"}</strong>
      {reason ? ` — ${reason}` : null}
    </div>
  );
}

function HookSupportNote() {
  return (
    <div
      style={{
        margin: "0 0 8px",
        padding: "6px 9px",
        fontSize: "var(--pnv-fs-11)",
        lineHeight: 1.4,
        color: "var(--pnv-warning)",
        background: "var(--pnv-warning-tint)",
        border: "1px solid var(--pnv-warning-border)",
        borderRadius: 4,
      }}
    >
      Basic debugging support: this PsyNeuLink build has no <code>_debugger</code>{" "}
      hook, so per-node values and execution snapshots are unavailable and trial
      stepping uses an estimated split. Switch the install to the{" "}
      <code>jonhanke-nam</code> fork (Settings ▸ Developer ▸ PsyNeuLink details) for full support.
    </div>
  );
}

// Trigger a client-side file download (run-record export, #468). No backend
// round-trip: the record already lives in the browser.
function triggerDownload(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Export a run record as a sidecar (#468). JSON is the default because the
// record is meant to be read back in (re-run, and eventually parameter-fitting
// ingestion, #512); YAML is offered as a human-readable variant for hand-editing
// or diffing a tuning run (#525). Both carry the same `psyneuview-run/v1` payload.
// Filename: <model>.run.<timestamp>.{json,yaml}.
function downloadRunRecord(record: RunRecord, format: "json" | "yaml" = "json") {
  const payload = { format: "psyneuview-run/v1", ...record };
  const base =
    record.modelPath.split("/").pop()?.replace(/\.py$/, "") || "model";
  const ts = record.timestamp.replace(/[:.]/g, "-");
  if (format === "yaml") {
    triggerDownload(
      `${base}.run.${ts}.yaml`,
      yaml.dump(payload),
      "application/yaml",
    );
  } else {
    triggerDownload(
      `${base}.run.${ts}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }
}

// Parse an imported run file back into a record. Accepts both JSON and YAML
// (#525): JSON is a strict subset of YAML, so a single YAML parse handles both
// — but we try JSON first to keep its sharper error for malformed JSON. Validates
// the minimum shape (labeled inputs with numeric trial vectors) so a stray file
// fails loudly rather than silently loading nothing (#468).
function parseRunFile(text: string): RunRecord {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    try {
      obj = yaml.load(text);
    } catch {
      throw new Error("Run file is not valid JSON or YAML");
    }
  }
  if (
    !obj ||
    !Array.isArray(obj.inputs) ||
    obj.inputs.some((i: any) => !Array.isArray(i?.trials))
  ) {
    throw new Error("Not a PsyNeuView run file (no inputs found)");
  }
  return obj as RunRecord;
}

// Recent-runs history (#468). Each completed run is pinned here with its frozen
// inputs; rows re-run (reproduce from those inputs), export a JSON sidecar, or
// drop off. An Import affordance loads a shared run file's inputs into the form.
function RecentRunsList({
  onRerun,
  onImport,
  running,
}: {
  onRerun: (record: RunRecord) => void;
  onImport: (file: File) => void;
  running: boolean;
}) {
  const records = useRunRecords((s) => s.records);
  const removeRecord = useRunRecords((s) => s.removeRecord);
  const clearRecords = useRunRecords((s) => s.clear);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ marginTop: 16, paddingTop: 8, borderTop: "1px solid var(--pnv-border-faint)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text-body)" }}>
          Recent runs{records.length ? ` (${records.length})` : ""}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <Button
            kind="small" size="tall"
            onClick={() => fileRef.current?.click()}
            title="Load inputs from an exported run file (JSON or YAML)"
          >
            Import
          </Button>
          {records.length > 0 && (
            <Button kind="small" size="tall" onClick={clearRecords} title="Clear the recent-runs history">
              Clear
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.yaml,.yml,application/json,application/yaml"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {records.length === 0 ? (
        <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)" }}>
          No runs yet — run the model to pin a record here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {records.map((r) => {
            const when = new Date(r.timestamp);
            const inputSummary = r.inputs
              .map((i) => i.name)
              .slice(0, 3)
              .join(", ");
            return (
              <div
                key={r.id}
                title={`Saved run — ${r.compositionName}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid var(--pnv-border-faint)",
                  borderRadius: 4,
                  padding: "5px 8px",
                  background: "var(--pnv-surface-muted)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-body)" }}>
                    {r.compositionName}{" "}
                    <span style={{ color: "var(--pnv-text-faint)" }}>
                      · {r.numTrials} trial{r.numTrials === 1 ? "" : "s"}
                      {/* #894: per-run duration, preserved across reruns. */}
                      {typeof r.runMs === "number" && (
                        <span
                          title={
                            typeof r.serverRunMs === "number"
                              ? `server run ${(r.serverRunMs / 1000).toFixed(1)}s`
                              : undefined
                          }
                        >
                          {" "}
                          · {(r.runMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "var(--pnv-fs-10)",
                      color: "var(--pnv-text-faint)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {when.toLocaleTimeString()} · {inputSummary}
                  </div>
                </div>
                <Button
                  kind="small" size="tall"
                  onClick={() => onRerun(r)}
                  disabled={running}
                  title="Re-run this saved input set"
                  style={{ whiteSpace: "nowrap" }}
                >
                  Re-run
                </Button>
                <div
                  title="Export this run — JSON (re-import / fitting ingestion) or YAML (human-readable)"
                  style={{
                    display: "inline-flex",
                    border: "1px solid var(--pnv-border-light)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", padding: "3px 6px", alignSelf: "center" }}
                  >
                    Export
                  </span>
                  <button
                    onClick={() => downloadRunRecord(r, "json")}
                    title="Export this run as JSON"
                    style={{
                      fontSize: "var(--pnv-fs-11)",
                      padding: "3px 8px",
                      border: "none",
                      borderLeft: "1px solid var(--pnv-border-faint)",
                      background: "var(--pnv-surface)",
                      color: "var(--pnv-text-secondary)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    JSON
                  </button>
                  <button
                    onClick={() => downloadRunRecord(r, "yaml")}
                    title="Export this run as YAML"
                    style={{
                      fontSize: "var(--pnv-fs-11)",
                      padding: "3px 8px",
                      border: "none",
                      borderLeft: "1px solid var(--pnv-border-faint)",
                      background: "var(--pnv-surface)",
                      color: "var(--pnv-text-secondary)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    YAML
                  </button>
                </div>
                <Button
                  kind="small" size="icon"
                  className="pnv-remove-x"
                  onClick={() => removeRecord(r.id)}
                  title="Remove this run from history"
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Element-labeled, per-trial input editor for one input node (#461). Replaces
// the free-form CSV textarea: each trial is a row of numeric cells headed by
// the element name (red_ink / green_ink), with edit-time validation and a
// CSV-paste escape hatch. Add-trial lives in the parent (shared trial count).
function InputNodeEditor({
  node,
  labels,
  cells,
  onCell,
  onRemoveTrial,
  onApplyCsv,
}: {
  node: InputNodeInfo;
  labels: string[];
  cells: string[][];
  onCell: (varName: string, trial: number, elem: number, value: string) => void;
  onRemoveTrial: (trial: number) => void;
  onApplyCsv: (varName: string, text: string, width: number) => void;
}) {
  const [csvText, setCsvText] = useState("");
  const width = labels.length;
  return (
    <div style={{ marginBottom: 12 }} data-testid={`run-input-${node.name}`}>
      <label
        style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", display: "block", marginBottom: 3 }}
      >
        {node.name}{" "}
        <span style={{ color: "var(--pnv-text-faint)" }}>
          [{width} element{width === 1 ? "" : "s"}]
        </span>
      </label>
      {cells.map((row, t) => (
        <div
          key={t}
          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}
        >
          <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", minWidth: 42 }}>
            Trial {t + 1}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
            {row.map((val, e) => (
              <InputCell
                key={e}
                label={labels[e] ?? `[${e}]`}
                value={val}
                onChange={(v) => onCell(node.varName, t, e, v)}
              />
            ))}
          </div>
          <Button
            kind="small" size="icon"
            className="pnv-remove-x"
            onClick={() => onRemoveTrial(t)}
            disabled={cells.length <= 1}
            title="Remove this trial"
          >
            ✕
          </Button>
        </div>
      ))}
      <details style={{ marginTop: 2 }}>
        <summary style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-hint)", cursor: "pointer" }}>
          Paste CSV
        </summary>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={3}
          placeholder={"1, 0\n0, 1"}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "var(--pnv-fs-11)",
            padding: 4,
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 3,
            marginTop: 2,
            resize: "vertical",
          }}
        />
        <Button
          kind="small"
          onClick={() => {
            onApplyCsv(node.varName, csvText, width);
            setCsvText("");
          }}
          disabled={!csvText.trim()}
          style={{ marginTop: 2 }}
        >
          Apply to cells
        </Button>
      </details>
    </div>
  );
}

// One labeled numeric cell, shared by the by-node and by-trial layouts so
// validation/edit behaviour can't drift between the two groupings (#570).
function InputCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const invalid = !isValidCell(value);
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-muted)" }}
    >
      <span style={{ fontFamily: "monospace" }}>{label}</span>
      <input
        value={value}
        inputMode="decimal"
        onChange={(ev) => onChange(ev.target.value)}
        title={invalid ? "Not a number" : undefined}
        style={{
          width: 48,
          fontFamily: "monospace",
          fontSize: "var(--pnv-fs-11)",
          padding: "2px 4px",
          border: `1px solid ${invalid ? "var(--pnv-danger)" : "var(--pnv-border-light)"}`,
          background: invalid ? "var(--pnv-danger-tint)" : "var(--pnv-surface)",
          borderRadius: 3,
        }}
      />
    </label>
  );
}

// Segmented control to pick which dimension is outermost in the input grid (#570).
function GroupingToggle({
  value,
  onChange,
}: {
  value: InputGrouping;
  onChange: (grouping: InputGrouping) => void;
}) {
  const options: Array<{ key: InputGrouping; label: string }> = [
    { key: "byNode", label: "Node" },
    { key: "byTrial", label: "Trial" },
  ];
  return (
    <div
      title="Group input cells by node (each node's trials together) or by trial (each trial's nodes together)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: "1px solid var(--pnv-border-light)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", padding: "2px 6px" }}>Group by</span>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            fontSize: "var(--pnv-fs-11)",
            padding: "2px 8px",
            border: "none",
            borderLeft: "1px solid var(--pnv-border-faint)",
            background: value === o.key ? "var(--pnv-primary)" : "var(--pnv-surface)",
            color: value === o.key ? "var(--pnv-on-primary)" : "var(--pnv-text-secondary)",
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// By-trial layout: outer group is the trial, inner rows are the nodes (#570).
// Reads the same `cells[varName][trial][elem]` grid as the by-node editor —
// purely a render inversion, no separate data path. Trial count is the max
// across nodes (add/remove keep them aligned, but max is defensive).
function TrialGroupedEditor({
  nodes,
  labelsByVar,
  cells,
  onCell,
  onRemoveTrial,
}: {
  nodes: InputNodeInfo[];
  labelsByVar: Record<string, string[]>;
  cells: Record<string, string[][]>;
  onCell: (varName: string, trial: number, elem: number, value: string) => void;
  onRemoveTrial: (trial: number) => void;
}) {
  const trialCount = Math.max(0, ...nodes.map((n) => (cells[n.varName] || []).length));
  if (trialCount === 0) return null;
  return (
    <div>
      {Array.from({ length: trialCount }, (_, t) => (
        <div
          key={t}
          style={{
            marginBottom: 10,
            border: "1px solid var(--pnv-border-faint)",
            borderRadius: 4,
            padding: "6px 8px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: "var(--pnv-fs-11)", fontWeight: 600, color: "var(--pnv-text-secondary)" }}>
              Trial {t + 1}
            </span>
            <Button
              kind="small" size="icon"
              className="pnv-remove-x"
              onClick={() => onRemoveTrial(t)}
              disabled={trialCount <= 1}
              title="Remove this trial"
            >
              ✕
            </Button>
          </div>
          {nodes.map((node) => {
            const row = (cells[node.varName] || [])[t] || [];
            const labels = labelsByVar[node.varName] || [];
            return (
              <div
                key={node.varName}
                style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}
              >
                <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", minWidth: 70 }}>
                  {node.name}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
                  {row.map((val, e) => (
                    <InputCell
                      key={e}
                      label={labels[e] ?? `[${e}]`}
                      value={val}
                      onChange={(v) => onCell(node.varName, t, e, v)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Per-trial IN→OUT cards (#462/#463). One card per trial: the inputs that were
// submitted for that trial on top, every node's recorded value for that trial
// below, each element labeled. The card matching the trace stepper's current
// position is highlighted; clicking any card jumps the stepper to that trial.
function TrialOutputs({
  results,
  submitted,
}: {
  results: RunResults;
  submitted: SubmittedInput[] | null;
}) {
  const storeNodes = useModelStore((s) => s.nodes);
  const modelLabels = useModelStore((s) => s.modelLabels);
  const boundaries = useModelStore((s) => s.executionTrialBoundaries);
  const traceStep = useModelStore((s) => s.traceStep);
  const setTraceStep = useModelStore((s) => s.setTraceStep);
  const traceStepValues = useModelStore((s) => s.traceStepValues);
  // #786: trial-to-trial Δ diff is opt-in (off by default).
  const showTrialDeltas = useUIStore((s) => s.showTrialDeltas);
  const toggleTrialDeltas = useUIStore((s) => s.toggleTrialDeltas);

  // #524: group the debugger-captured per-step values by trial and node so a
  // card can show how a node's value evolved *within* its trial. Empty on
  // hook-less PsyNeuLink builds (no snapshots), which hides the feature.
  const withinTrial = useMemo(() => {
    const byTrial = new Map<number, Map<string, { step: number; value: unknown }[]>>();
    const steps = Array.from(traceStepValues.keys()).sort((a, b) => a - b);
    for (const step of steps) {
      const byNode = traceStepValues.get(step);
      if (!byNode) continue;
      for (const [node, entry] of Object.entries(byNode)) {
        if (entry.trial === null) continue;
        let nodes = byTrial.get(entry.trial);
        if (!nodes) {
          nodes = new Map();
          byTrial.set(entry.trial, nodes);
        }
        const key = node.replace(/-\d+$/, "");
        let series = nodes.get(key);
        if (!series) {
          series = [];
          nodes.set(key, series);
        }
        series.push({ step, value: entry.value });
      }
    }
    return byTrial;
  }, [traceStepValues]);

  // Look up a node's port metadata by its log/display name. Logs are keyed by
  // the PsyNeuLink node name; store nodes carry label + varName. Index by both
  // (plus a `-N` suffix-stripped form) so multi-composition name munging still
  // resolves.
  const nodeMeta = useMemo(() => {
    const m = new Map<string, any>();
    for (const node of storeNodes) {
      const d = node.data as any;
      if (!d) continue;
      for (const key of [d.label, d.varName]) {
        if (typeof key === "string") {
          m.set(key, d);
          m.set(key.replace(/-\d+$/, ""), d);
        }
      }
    }
    return m;
  }, [storeNodes]);

  // Which card is "live" given the trace stepper's current step: the trial
  // whose first scheduler step is the greatest boundary <= traceStep.
  const activeTrialIdx = useMemo(() => {
    if (traceStep === null || boundaries.length === 0) return null;
    let idx = -1;
    for (let i = 0; i < boundaries.length; i++) {
      if (boundaries[i] <= traceStep) idx = i;
      else break;
    }
    return idx;
  }, [traceStep, boundaries]);

  // #497: keep the live card in view as the trace steps across trial
  // boundaries (the column can run taller than the panel on long runs).
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeTrialIdx === null) return;
    activeCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeTrialIdx]);

  // Input nodes already get a labeled IN row from the frozen `submitted`
  // snapshot, so we drop them from the OUT list to avoid showing each input
  // twice (#463 review note). Match on every name form the log key might take.
  const inputNames = useMemo(() => {
    const s = new Set<string>();
    for (const inp of submitted || []) {
      for (const key of [inp.name, inp.varName]) {
        s.add(key);
        s.add(key.replace(/-\d+$/, ""));
      }
    }
    return s;
  }, [submitted]);

  // ...but only when the OUT row would repeat the IN row. A node that is both
  // input and output gives back something else: a Hopfield layer's answer is
  // not its cue, and a Linear input with slope 2 doubles what it passes on.
  // Dropping those hid the model's whole result (#49).
  const logEntries = useMemo(
    () =>
      Object.entries(results.logs).filter(([name, log]) => {
        if (!inputNames.has(name) && !inputNames.has(name.replace(/-\d+$/, ""))) return true;
        return !echoesSubmitted(name, log, submitted);
      }),
    [results.logs, inputNames, submitted],
  );

  // #1387: every number a node shows in these cards, its outputs and its
  // inputs, so a grid's shading means the same in every trial. Keyed by the
  // node's name without its session suffix.
  const pooled = useMemo(() => {
    const m = new Map<string, number[]>();
    const add = (name: string, values: unknown[]) => {
      const key = name.replace(/-\d+$/, "");
      m.set(key, [...(m.get(key) ?? []), ...poolValues(values)]);
    };
    for (const [name, log] of Object.entries(results.logs)) add(name, log.values);
    for (const s of submitted || []) add(s.name, s.trials);
    return m;
  }, [results.logs, submitted]);

  // #1387: the nodes whose value is a vector big enough to draw as a grid,
  // each offered "list | grid" once, above the cards.
  const gridNodes = useMemo(() => {
    const out: { name: string; size: number; first: unknown; declared?: number[] }[] = [];
    const seen = new Set<string>();
    const consider = (name: string, first: unknown, declared?: number[]) => {
      const key = name.replace(/-\d+$/, "");
      if (seen.has(key)) return;
      const size = numericVector(first)?.values.length ?? 0;
      if (size < MIN_GRID_SIZE) return;
      seen.add(key);
      out.push({ name: key, size, first, declared });
    };
    for (const s of submitted || []) consider(s.name, s.trials[0], nodeMeta.get(s.name)?.inputPorts?.[0]?.shape);
    for (const [name, log] of logEntries) {
      const meta = nodeMeta.get(name);
      if (expandMultiPort(log.values[0], meta?.outputPorts, name, modelLabels)) continue;
      consider(name, log.values[0], meta?.outputPorts?.[0]?.shape);
    }
    return out;
  }, [submitted, logEntries, nodeMeta, modelLabels]);

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "var(--pnv-fs-12)",
          fontWeight: 600,
          color: "var(--pnv-text-body)",
          marginBottom: 6,
        }}
      >
        <span>Per-trial values</span>
        {/* #786: trial-to-trial Δ diff (#466) is opt-in — only meaningful for
            sequential/converging runs, so off by default to avoid noise on
            unrelated trials. */}
        <button
          data-testid="run-trial-deltas"
          onClick={toggleTrialDeltas}
          title={
            showTrialDeltas
              ? "Hide trial-to-trial Δ (change from the previous trial)"
              : "Show trial-to-trial Δ (change from the previous trial)"
          }
          style={{
            padding: "2px 8px",
            fontSize: "var(--pnv-fs-11)",
            fontWeight: 500,
            cursor: "pointer",
            borderRadius: 4,
            border: showTrialDeltas ? "1px solid var(--pnv-warning-border)" : "1px solid var(--pnv-border-light)",
            background: showTrialDeltas ? "var(--pnv-warning-tint)" : "var(--pnv-surface)",
            color: showTrialDeltas ? "var(--pnv-warning)" : "var(--pnv-text-hint)",
          }}
        >
          Δ diff {showTrialDeltas ? "on" : "off"}
        </button>
      </div>
      {gridNodes.length > 0 && (
        <div
          data-testid="run-value-views"
          style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8, fontSize: "var(--pnv-fs-11)" }}
        >
          {gridNodes.map((g) => (
            <GridNodeControls
              key={g.name}
              node={g.name}
              size={g.size}
              first={g.first}
              declared={g.declared}
              scaleFrom={pooled.get(g.name)}
            />
          ))}
        </div>
      )}
      {/* #497: one full-width card per trial, stacked vertically. A wrapping
          row forced each card narrow (maxWidth 320), which wrapped the labeled
          element values awkwardly; a single column lets them breathe and keeps
          all trials visible for cross-trial comparison. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {results.results.map((r, trialPos) => {
          const active = activeTrialIdx === trialPos;
          const stepTarget = boundaries[trialPos];
          const clickable = stepTarget !== undefined;
          return (
            <div
              key={r.trial}
              ref={active ? activeCardRef : undefined}
              onClick={clickable ? () => setTraceStep(stepTarget) : undefined}
              title={
                clickable
                  ? `Jump trace to trial ${r.trial + 1} (step ${stepTarget + 1})`
                  : `trial_num=${r.trial}`
              }
              style={{
                border: `1px solid ${active ? "var(--pnv-trace-border)" : "var(--pnv-border-faint)"}`,
                borderRadius: 6,
                background: active ? "var(--pnv-trace-tint)" : "var(--pnv-surface-muted)",
                padding: "8px 10px",
                cursor: clickable ? "pointer" : "default",
                fontSize: "var(--pnv-fs-11)",
              }}
            >
              {/* 1-indexed for display, raw trial_num on hover. #336 gap 5. */}
              <div
                style={{
                  fontWeight: 600,
                  color: "var(--pnv-text-body)",
                  marginBottom: 4,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>Trial {r.trial + 1}</span>
                {active && (
                  <span style={{ color: "var(--pnv-trace-value)", fontSize: "var(--pnv-fs-10)" }}>● stepping</span>
                )}
              </div>

              {/* Inputs submitted for this trial */}
              {submitted && submitted.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  {submitted.map((s) => {
                    const meta = nodeMeta.get(s.name);
                    const value = s.trials[trialPos];
                    if (value === undefined) return null;
                    const portName = meta?.inputPorts?.[0]?.name;
                    const labels = portName
                      ? resolveInputLabels(modelLabels, s.name, portName, meta?.inputPorts)
                      : null;
                    return (
                      <ValueRow
                        key={`in-${s.varName}`}
                        kind="in"
                        node={s.name}
                        text={formatLabeledValue(value, labels, { maxLen: 1000 })}
                        grid={
                          <TrialGrid
                            names={[s.name, s.varName]}
                            value={value}
                            declared={meta?.inputPorts?.[0]?.shape}
                            scaleFrom={pooled.get(s.name.replace(/-\d+$/, ""))}
                            text={formatLabeledValue(value, labels, { maxLen: 1000 })}
                            testId={`run-trial-${trialPos + 1}-in-grid-${s.name.replace(/-\d+$/, "")}`}
                          />
                        }
                      />
                    );
                  })}
                </div>
              )}

              <div style={{ borderTop: "1px dashed var(--pnv-border-light)", margin: "4px 0" }} />

              {/* Every node's recorded value for this trial */}
              {logEntries.map(([nodeName, log]) => {
                const idx = log.trials.indexOf(r.trial);
                if (idx < 0) return null;
                const value = log.values[idx];
                const meta = nodeMeta.get(nodeName);
                // #524: a node that executed at more than one scheduler step
                // within this trial gets an expandable step-by-step detail.
                const series = withinTrial.get(r.trial)?.get(nodeName.replace(/-\d+$/, ""));
                const detail =
                  series && series.length > 1 ? (
                    <WithinTrialSteps series={series} onJump={setTraceStep} />
                  ) : null;
                // #466: the same node's value in the previous displayed trial,
                // for the consecutive-Δ annotation. null on the first trial.
                const prevTrialNum =
                  trialPos > 0 ? results.results[trialPos - 1].trial : null;
                const prevIdx =
                  prevTrialNum !== null ? log.trials.indexOf(prevTrialNum) : -1;
                const prevValue = prevIdx >= 0 ? log.values[prevIdx] : undefined;
                const ports = expandMultiPort(value, meta?.outputPorts, nodeName, modelLabels);
                if (ports) {
                  const prevPorts = prevValue
                    ? expandMultiPort(prevValue, meta?.outputPorts, nodeName, modelLabels)
                    : null;
                  return (
                    <div key={`out-${nodeName}`} style={{ marginBottom: 2 }}>
                      <div style={{ color: "var(--pnv-text-hint)", fontFamily: "monospace" }}>
                        {nodeName.replace(/-\d+$/, "")}
                      </div>
                      {ports.map((p, pi) => (
                        <ValueRow
                          key={`out-${nodeName}-${p.portName}`}
                          kind="out"
                          node={p.displayName || p.portName}
                          indent
                          text={formatLabeledValue(p.value, p.labels, { maxLen: 1000 })}
                          delta={showTrialDeltas ? formatDelta(prevPorts?.[pi]?.value, p.value, p.labels) : null}
                        />
                      ))}
                      {detail}
                    </div>
                  );
                }
                const labels = resolveOutputLabels(modelLabels, nodeName, undefined, meta?.outputPorts);
                return (
                  <div key={`out-${nodeName}`}>
                    <ValueRow
                      kind="out"
                      node={nodeName.replace(/-\d+$/, "")}
                      text={formatLabeledValue(value, labels, { maxLen: 1000 })}
                      delta={showTrialDeltas ? formatDelta(prevValue, value, labels) : null}
                      grid={
                        <TrialGrid
                          names={[nodeName, meta?.label, meta?.varName]}
                          value={value}
                          declared={meta?.outputPorts?.[0]?.shape}
                          scaleFrom={pooled.get(nodeName.replace(/-\d+$/, ""))}
                          text={formatLabeledValue(value, labels, { maxLen: 1000 })}
                          testId={`run-trial-${trialPos + 1}-grid-${nodeName.replace(/-\d+$/, "")}`}
                        />
                      }
                    />
                    {detail}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A value that is (possibly nested arrays around) exactly one finite number,
// e.g. 0.48 or [[0.48]] — the shape DDM/integrator outputs take. Non-scalar
// payloads return null and skip the sparkline.
function scalarOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v) && v.length === 1) return scalarOf(v[0]);
  return null;
}

// Tiny inline trend line for a within-trial scalar series (#524).
function Sparkline({ values }: { values: number[] }) {
  const w = 56;
  const h = 14;
  const pad = 1.5;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / Math.max(values.length - 1, 1);
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      style={{ verticalAlign: "middle", marginLeft: 6 }}
      aria-label="Within-trial value trend"
    >
      <polyline points={pts} fill="none" strokeWidth="1.2" style={{ stroke: "var(--pnv-trace-value)" }} />
    </svg>
  );
}

// Expandable step-by-step values for one node within one trial (#524). Only
// rendered when the node executed at >1 scheduler steps in the trial — i.e.
// the card's single per-trial value hides real within-trial evolution.
// Clicking a step jumps the trace stepper (and value pill) to that step.
function WithinTrialSteps({
  series,
  onJump,
}: {
  series: { step: number; value: unknown }[];
  onJump: (step: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const scalars = useMemo(() => {
    const out: number[] = [];
    for (const { value } of series) {
      const n = scalarOf(value);
      if (n === null) return null;
      out.push(n);
    }
    return out;
  }, [series]);
  return (
    <div style={{ marginLeft: 14, marginBottom: 2 }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="This value evolved across scheduler steps within the trial — expand the step-by-step values"
        aria-expanded={open}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          fontSize: "var(--pnv-fs-10)",
          color: "var(--pnv-trace-value)",
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        {open ? "▾" : "▸"} ×{series.length} steps
      </button>
      {scalars && <Sparkline values={scalars} />}
      {open && (
        <div>
          {series.map((s, i) => (
            <div
              key={s.step}
              className="trace-step-row"
              onClick={(e) => {
                e.stopPropagation();
                onJump(s.step);
              }}
              title={`Jump trace to scheduler step ${s.step + 1}`}
              style={{
                fontSize: "var(--pnv-fs-10)",
                fontFamily: "monospace",
                color: "var(--pnv-trace-value)",
                cursor: "pointer",
                padding: "1px 0 1px 10px",
              }}
            >
              step {i + 1}/{series.length}: {formatTraceValue(s.value, 60)}{" "}
              <span style={{ color: "var(--pnv-text-faint)" }}>→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// #1387: one node's "list | grid" choice above the trial cards, with the
// grid's width and the shading's legend while it is a grid.
function GridNodeControls({
  node,
  size,
  first,
  declared,
  scaleFrom,
}: {
  node: string;
  size: number;
  first: unknown;
  declared?: number[];
  scaleFrom?: number[];
}) {
  const { view, grid } = useNodeGrid([node], first, declared, scaleFrom);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", lineHeight: 1.5 }}>
      <span style={{ color: "var(--pnv-trace-value)", fontFamily: "monospace" }}>{node}</span>
      <span style={{ color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-10)" }}>{size} values, as</span>
      <ValueViewToggle node={node} size={size} view={view} shape={grid?.shape} testId={`run-value-view-${node}`} />
      {grid && <GridLegend scale={grid.scale} testId={`run-value-legend-${node}`} />}
    </div>
  );
}

// #1387: a node's value in a trial card: a grid when the node is shown as
// one, else its text as before.
function TrialGrid({
  names,
  value,
  declared,
  scaleFrom,
  text,
  testId,
}: {
  names: (string | undefined)[];
  value: unknown;
  declared?: number[];
  scaleFrom?: number[];
  text: string;
  testId: string;
}) {
  const { grid } = useNodeGrid(names, value, declared, scaleFrom);
  if (!grid) return <ValueText text={text} />;
  return <ValueGrid grid={grid} cell={10} node={names[0] ?? ""} testId={testId} />;
}

function ValueText({ text }: { text: string }) {
  return (
    <span style={{ color: "var(--pnv-text-body)", fontFamily: "monospace", wordBreak: "break-all" }}>
      {text}
    </span>
  );
}

// One labeled value line inside a trial card. `kind` tints the node name so
// inputs and outputs read apart at a glance. `delta` (#466), when present,
// renders a small amber "Δ …" line naming the elements that moved since the
// previous trial; converged values pass null and show nothing.
function ValueRow({
  kind,
  node,
  text,
  indent,
  delta,
  grid,
}: {
  kind: "in" | "out";
  node: string;
  text: string;
  indent?: boolean;
  delta?: string | null;
  /** #1387: drawn in place of the text: a TrialGrid, which falls back to
      the text itself when the node is shown as a list. */
  grid?: ReactNode;
}) {
  return (
    <div style={{ paddingLeft: indent ? 10 : 0 }}>
      <div style={{ display: "flex", gap: 6, lineHeight: 1.5 }}>
        <span
          style={{
            color: kind === "in" ? "var(--pnv-primary)" : "var(--pnv-trace-value)",
            fontFamily: "monospace",
            flexShrink: 0,
          }}
        >
          {node}
        </span>
        {grid ?? <ValueText text={text} />}
      </div>
      {delta && (
        <div
          style={{
            color: "var(--pnv-warning)",
            fontFamily: "monospace",
            fontSize: "var(--pnv-fs-10)",
            lineHeight: 1.4,
            paddingLeft: 12,
          }}
          title="Change from the previous trial"
          data-testid="run-trial-delta"
        >
          Δ {delta}
        </div>
      )}
    </div>
  );
}

function DebuggerSnapshotTable() {
  const snapshots = useModelStore((s) => s.debuggerSnapshots);
  const traceStep = useModelStore((s) => s.traceStep);
  const setTraceStep = useModelStore((s) => s.setTraceStep);
  const traceLength = useModelStore((s) => s.executionTrace.length);

  // Map each snapshot to its corresponding scheduler step (index into
  // executionTrace). EXECUTION_SET bumps the running counter; NODE_EXECUTION
  // inherits it. Trial-boundary categories are not steppable -> null.
  const snapshotToStep = useMemo<(number | null)[]>(() => {
    const out: (number | null)[] = [];
    let step = -1;
    for (const snap of snapshots) {
      if (snap.category === "EXECUTION_SET") {
        step += 1;
        out.push(step);
      } else if (
        // These all fire within the current execution set (#460): INPUTS_TO_NODE
        // and NODE_EXECUTION per node, END_OF_EXECUTION_SET to close it out.
        snap.category === "NODE_EXECUTION" ||
        snap.category === "INPUTS_TO_NODE" ||
        snap.category === "END_OF_EXECUTION_SET"
      ) {
        out.push(step >= 0 ? step : null);
      } else {
        out.push(null);
      }
    }
    return out;
  }, [snapshots]);

  // --- Visual filters (Phase 2D) -----------------------------------------
  // Filter only what's *shown*; the snapshots array and snapshotToStep
  // mapping stay computed over the full data so Phase 2C linkage is intact.
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [trialFilter, setTrialFilter] = useState<number | "all">("all");

  // Reset filters on each new run (snapshots array is replaced).
  useEffect(() => {
    setHiddenCats(new Set());
    setTrialFilter("all");
  }, [snapshots]);

  // Categories in order of first appearance (execution order).
  const categories = useMemo<string[]>(() => {
    const seen: string[] = [];
    for (const snap of snapshots) {
      if (!seen.includes(snap.category)) seen.push(snap.category);
    }
    return seen;
  }, [snapshots]);

  // Trial numbers present, ascending.
  const trials = useMemo<number[]>(() => {
    const set = new Set<number>();
    for (const snap of snapshots) {
      if (typeof snap.trial_num === "number") set.add(snap.trial_num);
    }
    return [...set].sort((a, b) => a - b);
  }, [snapshots]);

  const isVisible = useCallback(
    (snap: DebuggerSnapshot) =>
      !hiddenCats.has(snap.category) &&
      (trialFilter === "all" || snap.trial_num === trialFilter),
    [hiddenCats, trialFilter],
  );

  const toggleCat = useCallback((cat: string) => {
    setHiddenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const visibleCount = useMemo(
    () => snapshots.filter(isVisible).length,
    [snapshots, isVisible],
  );
  const filterActive = hiddenCats.size > 0 || trialFilter !== "all";

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // When traceStep changes from elsewhere (TraceControls ◀/▶), scroll the
  // first matching row into view inside the snapshot scroll container.
  useEffect(() => {
    if (traceStep === null) return;
    const firstMatch = snapshotToStep.findIndex((s) => s === traceStep);
    if (firstMatch < 0) return;
    const row = rowRefs.current.get(firstMatch);
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [traceStep, snapshotToStep]);

  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)", cursor: "pointer" }}>
        Debugger snapshots {snapshots.length > 0 && (
          <span style={{ color: "var(--pnv-text-faint)" }}>
            ({filterActive ? `${visibleCount} of ${snapshots.length} shown` : snapshots.length})
          </span>
        )}
      </summary>
      {snapshots.length === 0 ? (
        <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", padding: "6px 0" }}>
          No snapshots captured. The PsyNeuLink build in use does not include
          the <code>_debugger</code> hook yet.
        </div>
      ) : (
        <>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginTop: 6,
            marginBottom: 2,
          }}
        >
          {categories.map((cat) => {
            const on = !hiddenCats.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCat(cat)}
                title={on ? `Hide ${cat} rows` : `Show ${cat} rows`}
                style={{
                  fontSize: "var(--pnv-fs-10)",
                  fontFamily: "monospace",
                  padding: "1px 7px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: `1px solid ${on ? "var(--pnv-primary-tint-border)" : "var(--pnv-border-light)"}`,
                  background: on ? "var(--pnv-primary-tint)" : "var(--pnv-surface-muted)",
                  color: on ? "var(--pnv-primary-text-on-tint)" : "var(--pnv-text-faint)",
                  textDecoration: on ? "none" : "line-through",
                }}
              >
                {cat}
              </button>
            );
          })}
          {trials.length > 1 && (
            <select
              value={trialFilter === "all" ? "all" : String(trialFilter)}
              onChange={(e) =>
                setTrialFilter(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              style={{
                fontSize: "var(--pnv-fs-10)",
                marginLeft: "auto",
                padding: "1px 4px",
                border: "1px solid var(--pnv-border-light)",
                borderRadius: 3,
              }}
            >
              <option value="all">All trials</option>
              {trials.map((t) => (
                <option key={t} value={String(t)}>
                  Trial {t}
                </option>
              ))}
            </select>
          )}
        </div>
        <div
          ref={scrollContainerRef}
          style={{
            marginTop: 4,
            maxHeight: 280,
            overflow: "auto",
            border: "1px solid var(--pnv-border-faint)",
            borderRadius: 3,
          }}
        >
          <table
            style={{
              fontSize: "var(--pnv-fs-11)",
              borderCollapse: "collapse",
              width: "100%",
              fontFamily: "monospace",
            }}
          >
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "var(--pnv-surface-muted)" }}>
                {["#", "category", "trial", "node", "output", "step"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "3px 6px",
                      borderBottom: "1px solid var(--pnv-border-light)",
                      color: "var(--pnv-text-muted)",
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap, i) => {
                if (!isVisible(snap)) return null;
                const step = snapshotToStep[i];
                const clickable = step !== null && step < traceLength;
                const active = step !== null && step === traceStep;
                return (
                  <tr
                    key={i}
                    ref={(el) => {
                      if (el) rowRefs.current.set(i, el);
                      else rowRefs.current.delete(i);
                    }}
                    onClick={
                      clickable ? () => setTraceStep(step) : undefined
                    }
                    title={
                      clickable
                        ? `Jump to scheduler step ${step! + 1}`
                        : "Not associated with a scheduler step"
                    }
                    style={{
                      borderBottom: "1px solid var(--pnv-border-faint)",
                      cursor: clickable ? "pointer" : "default",
                      background: active ? "var(--pnv-trace-tint)" : undefined,
                    }}
                  >
                    <td style={{ padding: "2px 6px", color: "var(--pnv-text-faint)" }}>{i}</td>
                    <td style={{ padding: "2px 6px", color: "var(--pnv-text-body)" }}>{snap.category}</td>
                    {/* 1-indexed for display, raw on hover. #336 gap 5. */}
                    <td
                      style={{ padding: "2px 6px", color: "var(--pnv-text-secondary)" }}
                      title={
                        typeof snap.trial_num === "number"
                          ? `trial_num=${snap.trial_num}`
                          : ""
                      }
                    >
                      {typeof snap.trial_num === "number" ? snap.trial_num + 1 : "—"}
                    </td>
                    <td style={{ padding: "2px 6px", color: "var(--pnv-text-secondary)" }}>
                      {snap.node || (snap.execution_set ? snap.execution_set.join(", ") : "—")}
                    </td>
                    <td
                      style={{
                        padding: "2px 6px",
                        color: "var(--pnv-text-secondary)",
                        maxWidth: 260,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={snapshotOutputFull(snap)}
                    >
                      {snapshotOutputSnippet(snap)}
                    </td>
                    {/* 1-indexed for display, raw on hover. #336 gap 5. */}
                    <td
                      style={{ padding: "2px 6px", color: "var(--pnv-text-hint)" }}
                      title={step !== null ? `step index ${step}` : ""}
                    >
                      {step === null ? "—" : step + 1}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </details>
  );
}

// Compact one-line preview of whichever payload field the snapshot carries.
// Per-category logic stays in the producer (`_build_snapshot`); the UI just
// renders whatever lands on `output` / `outputs`.
function snapshotOutputSnippet(snap: DebuggerSnapshot): string {
  const v = snap.output !== undefined ? snap.output : snap.outputs;
  if (v === undefined || v === null) return "";
  const full = JSON.stringify(v);
  return full.length > 80 ? full.slice(0, 77) + "…" : full;
}

function snapshotOutputFull(snap: DebuggerSnapshot): string {
  const v = snap.output !== undefined ? snap.output : snap.outputs;
  return v === undefined || v === null ? "" : JSON.stringify(v);
}
