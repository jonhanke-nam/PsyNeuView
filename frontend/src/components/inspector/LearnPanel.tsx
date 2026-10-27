/**
 * Learn panel — configure training inputs/targets, run learning as an async
 * job, and watch per-epoch loss stream in live (#534 L1 / #536 L3).
 *
 * Two kinds of model train here (#997): an AutodiffComposition under PyTorch,
 * which reports a loss, and a plain Composition with learning pathways or
 * learning mechanisms under Python, which reports the TD prediction error,
 * the error at its target, or — learning without a target (Hebbian) — the
 * weight change. Which a composition is comes from introspection
 * (`learningProfile`), and the chart and numbers are labelled by the metric.
 *
 * Jobs run through the backend job layer (#535): POST /api/jobs submits,
 * SSE on /api/jobs/{id}/events streams progress, DELETE cancels. The panel
 * is deliberately self-contained (no RunPanel/modelStore edits) so it can
 * land while several in-flight PRs hold those files; the Run|Learn mode
 * merge into RunPanel is follow-up work on #534.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Plot from "react-plotly.js";
import { useModelStore, selectExecPath } from "@/stores/modelStore";
import { useLearnResults } from "@/stores/learnResultsStore";
import { cellsFromSet, preloadable, setsFor } from "@/utils/inputSets";
import { resolveInputLabels, resolveOutputLabels } from "@/utils/labels";
import { record as recordActivity } from "@/utils/activityLog";
import type { ExecutionModeInfo, LearnMetric } from "@/types/model";
import { formatMetricValue, isLearnable, learnGridNodes, learnMetric, pickLearnMode } from "@/utils/learnPlan";
import { PnlCallLine } from "./PnlCallLine";
import { Button } from "@/components/common/Button";
import { paletteColor } from "@/utils/paletteColor";

interface PortInfo {
  name: string;
  shape: number[];
  element_names?: string[] | null;
}

interface LearnNodeInfo {
  name: string;
  varName: string;
  shape: number[];
  ports: PortInfo[];
}

interface ProgressEvent {
  epoch: number;
  epochs: number;
  loss: number | null;   // the metric's value, whatever the metric (#997)
  metric?: string;       // its id; absent from older backends (= loss)
}

interface JobResult {
  finalLoss: number | null;
  epochLosses: number[];
  epochs: number;
  learningRate: number | null;
  numTrials: number;
  results: number[][][];
  executionMode?: string;         // backend that actually trained (#765)
  executionModeReason?: string | null;  // set only when it differs from the request
  pnlCall?: string;               // the concrete PsyNeuLink call (#766)
  metric?: LearnMetric;           // what epochLosses/finalLoss measure (#997)
  warnings?: string[];
}

type JobPhase = "idle" | "submitting" | "running" | "done" | "error" | "canceled";

function isValidCell(s: string): boolean {
  const t = s.trim();
  if (t === "") return false;
  return Number.isFinite(Number(t));
}

function elementLabels(
  node: LearnNodeInfo,
  kind: "input" | "output",
  modelLabels: Parameters<typeof resolveInputLabels>[0],
): string[] {
  const size = node.shape[0] || 1;
  const portName = node.ports[0]?.name;
  const resolved = portName
    ? kind === "input"
      ? resolveInputLabels(modelLabels, node.name, portName, node.ports)
      : resolveOutputLabels(modelLabels, node.name, portName, node.ports)
    : null;
  if (resolved && resolved.length === size) return resolved;
  return Array.from({ length: size }, (_, i) => `[${i}]`);
}

function defaultCells(size: number, numTrials: number): string[][] {
  return Array.from({ length: numTrials }, (_, t) =>
    Array.from({ length: size }, (_, i) => (i === t % size ? "1" : "0")),
  );
}

export function LearnPanel() {
  const filePath = useModelStore((s) => s.filePath);
  // #1029: run what the user is looking at. While the buffer has unsaved
  // edits this is the preview file, not the model on disk.
  const execPath = useModelStore(selectExecPath);
  const compositionNames = useModelStore((s) => s.compositionNames);
  // Training sets the model declares itself (#1216); "" = the placeholder grids.
  const inputSets = useModelStore((s) => s.inputSets);
  const [trainingSetName, setTrainingSetName] = useState("");
  const compositionMeta = useModelStore((s) => s.compositionMeta);
  const activeComposition = useModelStore((s) => s.activeComposition);
  const storeNodes = useModelStore((s) => s.nodes);
  const modelLabels = useModelStore((s) => s.modelLabels);

  // #997: learnability is per composition — autodiff trains under PyTorch, a
  // Composition with learning pathways under Python.
  const learnableComps = useMemo(
    () => compositionNames.filter((n) => isLearnable(compositionMeta[n])),
    [compositionNames, compositionMeta],
  );

  const [compositionName, setCompositionName] = useState<string | null>(null);
  const [inputNodes, setInputNodes] = useState<LearnNodeInfo[]>([]);
  const [targetNodes, setTargetNodes] = useState<LearnNodeInfo[]>([]);
  const [numTrials, setNumTrials] = useState(3);
  // What the current training was submitted with; published on completion.
  const submittedTargetsRef = useRef<Record<string, number[][]>>({});
  const submittedInputsRef = useRef<Record<string, number[][]>>({});
  const recordLearn = useLearnResults((s) => s.record);
  // varName -> trials[] -> elements[] of raw strings (invalid edits survive
  // and get flagged per-cell, mirroring the Run panel's approach, #461).
  const [inputCells, setInputCells] = useState<Record<string, string[][]>>({});
  const [targetCells, setTargetCells] = useState<Record<string, string[][]>>({});
  const [epochs, setEpochs] = useState(20);
  // Empty = the model's own learning rate, as the field's tooltip promises.
  // This used to start at "0.05", which silently overrode every model's rate:
  // the course's logic-gate network (learning_rate=10) trained 200x slower
  // and barely learned AND; EGO and simple_stroop_learn were overridden too.
  const [learningRate, setLearningRate] = useState("");
  const [installModes, setInstallModes] = useState<ExecutionModeInfo[]>([]);
  // #763: the composition's own matrix knows what the install-level list can't
  // — e.g. a plain Composition trains under Python only when it has learning
  // pathways. Fall back to the install list when it's absent (no model loaded
  // yet, or an older backend).
  const executionModes = useMemo(() => {
    const perComp = compositionName ? compositionMeta[compositionName]?.executionModes : undefined;
    return perComp ?? installModes;
  }, [compositionName, compositionMeta, installModes]);
  const [executionMode, setExecutionMode] = useState("PyTorch");
  const learningProfile = compositionName ? compositionMeta[compositionName]?.learningProfile ?? null : null;
  // #997: the install default is PyTorch, which can't train a learning-pathway
  // Composition — move to a backend that can whenever the composition changes.
  // Also re-checked whenever the selection changes, so the install default
  // arriving late from /api/execution-modes can't put PyTorch back.
  useEffect(() => {
    if (executionModes.length === 0) return;
    const next = pickLearnMode(executionModes, executionMode);
    if (next !== executionMode) setExecutionMode(next);
  }, [executionModes, executionMode]);

  const [phase, setPhase] = useState<JobPhase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  // When training was submitted, for the activity log's duration (#1287).
  const learnStartedAt = useRef(0);
  const learnElapsed = () => Math.round(performance.now() - learnStartedAt.current);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Publish each completed training (#47): the one place both completion paths
  // (the event stream and its polling fallback) meet.
  useEffect(() => {
    if (phase !== "done" || !result) return;
    recordLearn({
      epochs: result.epochs,
      finalLoss: result.finalLoss,
      targets: submittedTargetsRef.current,
      inputs: submittedInputsRef.current,
    });
  }, [phase, result, recordLearn]);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // New model: reset everything, including any live stream.
  useEffect(() => {
    closeStream();
    setPhase("idle");
    setJobId(null);
    setProgress([]);
    setResult(null);
    setError(null);
  }, [filePath, closeStream]);

  useEffect(() => closeStream, [closeStream]);

  // Backend capability detection (#537): probe which ExecutionMode backends
  // this install supports, and default the selector to the server's choice.
  useEffect(() => {
    let active = true;
    fetch("/api/execution-modes")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setInstallModes(data.modes ?? []);
        if (data.defaultLearn) setExecutionMode(data.defaultLearn);
      })
      .catch(() => {
        // Selector stays at its PyTorch default; learning still works.
      });
    return () => {
      active = false;
    };
  }, []);

  // Pick the composition: keep the canvas-active one if it's learnable,
  // else the first autodiff comp in the model.
  useEffect(() => {
    if (learnableComps.length === 0) {
      setCompositionName(null);
      return;
    }
    setCompositionName(
      activeComposition && learnableComps.includes(activeComposition)
        ? activeComposition
        : learnableComps[0],
    );
  }, [learnableComps, activeComposition]);

  // Derive input (INPUT role) and target (OUTPUT role) nodes from the store
  // graph — same role-based derivation the Run panel uses (#366/#420), with
  // targets keyed by output nodes since autodiff targets pair 1:1 with them.
  useEffect(() => {
    if (!filePath || storeNodes.length === 0) {
      setInputNodes([]);
      setTargetNodes([]);
      return;
    }
    const candidates = storeNodes.filter(
      (node) => node.type !== "compositionNode" && !node.parentId,
    );
    const collect = (node: (typeof candidates)[number], kind: "input" | "output"): LearnNodeInfo => {
      const data = node.data as any;
      const ports: PortInfo[] = (kind === "input" ? data?.inputPorts : data?.outputPorts) || [];
      return {
        name: data?.label || node.id,
        varName: data?.varName || node.id,
        shape: ports[0]?.shape || [],
        ports,
      };
    };
    // #997: which nodes get grids depends on how the composition learns — a
    // learning pathway's generated TARGET node is not an input, and a Hebbian
    // model has no targets at all.
    const nameOf = (node: (typeof candidates)[number]) => (node.data as any)?.label || node.id;
    const grid = learnGridNodes(
      candidates.map((node) => ({ name: nameOf(node), roles: (node.data as any)?.roles || [] })),
      learningProfile,
    );
    const pick = (names: string[], kind: "input" | "output") =>
      names.map((name) => collect(candidates.find((node) => nameOf(node) === name)!, kind));
    const inputs = pick(grid.inputs, "input");
    const targets = pick(grid.targets, "output");
    setInputNodes(inputs);
    setTargetNodes(targets);

    const inDefaults: Record<string, string[][]> = {};
    for (const node of inputs) inDefaults[node.varName] = defaultCells(node.shape[0] || 1, numTrials);
    const tgtDefaults: Record<string, string[][]> = {};
    for (const node of targets) tgtDefaults[node.varName] = defaultCells(node.shape[0] || 1, numTrials);
    // #1216: a model that declares its own training sets opens with the first
    // small enough to preload.
    const declared = preloadable(setsFor(inputSets, "learn", compositionName, compositionNames.length));
    const ins = declared ? cellsFromSet(declared.inputs, inputs) : null;
    const tgts = targetCellsFromSet(declared, targets, ins?.trials);
    if (declared && ins && tgts && ins.trials === tgts.trials) {
      setInputCells(ins.cells);
      setTargetCells(tgts.cells);
      setNumTrials(ins.trials);
      if (declared.epochs) setEpochs(declared.epochs);
      setTrainingSetName(declared.name);
    } else {
      setInputCells(inDefaults);
      setTargetCells(tgtDefaults);
      setTrainingSetName("");
    }
    // numTrials intentionally omitted: trial-count changes are handled by
    // resizeTrials below, preserving existing cell values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, storeNodes, inputSets, learningProfile]);

  const trainingSets = useMemo(
    () => setsFor(inputSets, "learn", compositionName, compositionNames.length),
    [inputSets, compositionName, compositionNames.length],
  );

  // Switch the grids to a declared training set, or back to the placeholders.
  const applyTrainingSet = useCallback(
    (name: string) => {
      const chosen = trainingSets.find((s) => s.name === name);
      const ins = chosen ? cellsFromSet(chosen.inputs, inputNodes) : null;
      const tgts = targetCellsFromSet(chosen, targetNodes, ins?.trials);
      if (chosen && ins && tgts && ins.trials === tgts.trials) {
        setInputCells(ins.cells);
        setTargetCells(tgts.cells);
        setNumTrials(ins.trials);
        if (chosen.epochs) setEpochs(chosen.epochs);
        setTrainingSetName(name);
      } else {
        const inD: Record<string, string[][]> = {};
        for (const node of inputNodes) inD[node.varName] = defaultCells(node.shape[0] || 1, numTrials);
        const tgD: Record<string, string[][]> = {};
        for (const node of targetNodes) tgD[node.varName] = defaultCells(node.shape[0] || 1, numTrials);
        setInputCells(inD);
        setTargetCells(tgD);
        setTrainingSetName("");
      }
    },
    [trainingSets, inputNodes, targetNodes, numTrials],
  );

  const resizeTrials = useCallback(
    (next: number) => {
      const clamped = Math.max(1, Math.min(100, next));
      setNumTrials(clamped);
      const resize = (cells: Record<string, string[][]>, nodes: LearnNodeInfo[]) => {
        const out: Record<string, string[][]> = {};
        for (const node of nodes) {
          const size = node.shape[0] || 1;
          const prev = cells[node.varName] || [];
          out[node.varName] = Array.from({ length: clamped }, (_, t) =>
            prev[t] ? [...prev[t]] : Array.from({ length: size }, (_, i) => (i === t % size ? "1" : "0")),
          );
        }
        return out;
      };
      setInputCells((c) => resize(c, inputNodes));
      setTargetCells((c) => resize(c, targetNodes));
    },
    [inputNodes, targetNodes],
  );

  const allCellsValid = useMemo(() => {
    const check = (cells: Record<string, string[][]>, nodes: LearnNodeInfo[]) =>
      nodes.every((n) => (cells[n.varName] || []).every((trial) => trial.every(isValidCell)));
    return check(inputCells, inputNodes) && check(targetCells, targetNodes);
  }, [inputCells, targetCells, inputNodes, targetNodes]);

  const lrValid = learningRate.trim() === "" || Number.isFinite(Number(learningRate.trim()));

  const subscribe = useCallback(
    (id: string) => {
      closeStream();
      const es = new EventSource(`/api/jobs/${id}/events`);
      eventSourceRef.current = es;
      es.onmessage = (msg) => {
        let ev: any;
        try {
          ev = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (ev.type === "progress") {
          setProgress((p) => [...p, { epoch: ev.epoch, epochs: ev.epochs, loss: ev.loss, metric: ev.metric }]);
          return;
        }
        // Terminal: close the stream and pull the final snapshot for the
        // result payload (the SSE terminal event only carries status/error).
        es.close();
        eventSourceRef.current = null;
        if (ev.type === "done") {
          recordActivity("learn", "Learning finished", { outcome: "ok", durationMs: learnElapsed() });
          fetch(`/api/jobs/${id}`)
            .then((r) => r.json())
            .then((snap) => {
              setResult(snap.result || null);
              setPhase("done");
            })
            .catch(() => setPhase("done"));
        } else if (ev.type === "canceled") {
          recordActivity("learn", "Learning cancelled", { outcome: "cancelled", durationMs: learnElapsed() });
          setPhase("canceled");
        } else {
          recordActivity("learn", "Learning failed", { outcome: "failed", durationMs: learnElapsed(), reason: String(ev.error || "Training failed").slice(0, 300) });
          setError(ev.error || "Training failed");
          setPhase("error");
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; replay-from-history on reconnect would
        // duplicate progress rows, so rebuild from the snapshot instead.
        es.close();
        eventSourceRef.current = null;
        fetch(`/api/jobs/${id}`)
          .then((r) => r.json())
          .then((snap) => {
            setProgress(snap.progress || []);
            if (snap.status === "done") {
              setResult(snap.result || null);
              setPhase("done");
            } else if (snap.status === "error") {
              setError(snap.error || "Training failed");
              setPhase("error");
            } else if (snap.status === "canceled") {
              setPhase("canceled");
            } else {
              subscribe(id);
            }
          })
          .catch(() => {
            setError("Lost connection to the training job");
            setPhase("error");
          });
      };
    },
    [closeStream],
  );

  const handleStart = useCallback(async () => {
    if (!filePath || !compositionName) return;
    learnStartedAt.current = performance.now();
    recordActivity("learn", `Learning started: ${compositionName}`, { composition: compositionName, epochs, executionMode });
    setPhase("submitting");
    setError(null);
    setResult(null);
    setProgress([]);
    setJobId(null);

    const toNumbers = (cells: Record<string, string[][]>, nodes: LearnNodeInfo[]) => {
      const out: Record<string, number[][]> = {};
      for (const node of nodes) {
        out[node.varName] = (cells[node.varName] || []).map((trial) =>
          trial.map((c) => Number(c.trim())),
        );
      }
      return out;
    };

    try {
      const body: any = {
        kind: "learn",
        file_path: execPath,
        composition_name: compositionName,
        inputs: toNumbers(inputCells, inputNodes),
        targets: toNumbers(targetCells, targetNodes),
        epochs,
        execution_mode: executionMode,
      };
      // Frozen at submit time for learnResultsStore, keyed by node name.
      submittedTargetsRef.current = Object.fromEntries(
        targetNodes.map((n) => [n.name, body.targets[n.varName] as number[][]]),
      );
      submittedInputsRef.current = Object.fromEntries(
        inputNodes.map((n) => [n.name, body.inputs[n.varName] as number[][]]),
      );
      if (learningRate.trim() !== "") body.learning_rate = Number(learningRate.trim());

      const resp = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(
          resp.status === 409
            ? `${err.detail || "Another job is already running."} Wait for it to finish or cancel it first.`
            : err.detail || `Failed to start training (HTTP ${resp.status})`,
        );
        recordActivity("learn", "Learning failed to start", { outcome: "failed", status: resp.status, reason: String(err.detail || "").slice(0, 300) });
        setPhase("error");
        return;
      }
      const job = await resp.json();
      setJobId(job.id);
      setPhase("running");
      subscribe(job.id);
    } catch (e: any) {
      recordActivity("learn", "Learning failed to start", { outcome: "failed", reason: String(e.message || e).slice(0, 300) });
      setError(e.message || "Failed to start training");
      setPhase("error");
    }
  }, [filePath, compositionName, inputCells, targetCells, inputNodes, targetNodes, epochs, learningRate, executionMode, subscribe]);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      // Terminal "canceled" arrives over the SSE stream.
    } catch {
      // The SSE error path will surface any real failure.
    }
  }, [jobId]);

  // ---- Render -------------------------------------------------------------

  if (!filePath) {
    return <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-13)" }}>Load a model to configure learning.</div>;
  }

  if (learnableComps.length === 0) {
    return (
      <div data-testid="learn-not-learnable" style={{ padding: 16, color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-13)", lineHeight: 1.6 }}>
        <strong>No learning-capable composition in this model.</strong>
        <br />
        Training needs an <code>AutodiffComposition</code> (trains under PyTorch) or a{" "}
        <code>Composition</code> with a learning pathway or a learning mechanism (trains under
        Python, through PsyNeuLink&apos;s own learning mechanisms). This model has neither, so it
        can be run from the Run tab but not trained. The bundled <code>autodiff_feedforward</code>,{" "}
        <code>hebbian_learning</code> and <code>td_learning</code> demos are trainable examples.
      </div>
    );
  }

  const busy = phase === "submitting" || phase === "running";
  const lastLoss = progress.length > 0 ? progress[progress.length - 1].loss : null;
  // #997: name the numbers for what they are — loss, prediction error, error
  // at target, or weight change.
  const metric = learnMetric(
    learningProfile,
    phase === "done" ? result?.metric : null,
    progress[progress.length - 1]?.metric,
  );
  const metricWord = metric.label.toLowerCase();
  const selectedModeReason = executionModes.find((m) => m.id === executionMode)?.reason ?? null;

  return (
    <div style={{ padding: 12, fontSize: "var(--pnv-fs-13)", height: "100%", overflow: "auto" }}>
      {/* Config row */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        {learnableComps.length > 1 && (
          <label>
            Composition{" "}
            <select
              value={compositionName ?? ""}
              onChange={(e) => setCompositionName(e.target.value)}
              disabled={busy}
            >
              {learnableComps.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        {trainingSets.length > 0 && (
          <label title="Training sets this model declares itself, in the shape Composition.learn takes (#1216)">
            From{" "}
            <select
              data-testid="learn-training-set"
              value={trainingSetName}
              onChange={(e) => applyTrainingSet(e.target.value)}
              disabled={busy}
            >
              {trainingSets.map((set) => (
                <option key={set.name} value={set.name}>
                  {set.name}
                </option>
              ))}
              <option value="">placeholders</option>
            </select>
          </label>
        )}
        <label>
          Trials{" "}
          <input
            type="number"
            min={1}
            max={100}
            value={numTrials}
            data-testid="learn-trials"
            onChange={(e) => resizeTrials(Number(e.target.value))}
            disabled={busy}
            style={{ width: 52 }}
          />
        </label>
        <label>
          Epochs{" "}
          <input
            type="number"
            min={1}
            max={100000}
            value={epochs}
            data-testid="learn-epochs"
            onChange={(e) => setEpochs(Math.max(1, Number(e.target.value)))}
            disabled={busy}
            style={{ width: 70 }}
          />
        </label>
        <label title="Leave empty to use the model's own learning rate">
          Learning rate{" "}
          <input
            type="text"
            value={learningRate}
            onChange={(e) => setLearningRate(e.target.value)}
            disabled={busy}
            placeholder="model default"
            style={{ width: 80, borderColor: lrValid ? undefined : "var(--pnv-danger)" }}
          />
        </label>
        {executionModes.length > 0 && (
          <label title={selectedModeReason ?? "Execution backend used for training"}>
            Backend{" "}
            <select
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value)}
              disabled={busy}
            >
              {executionModes.map((m) => {
                const usable = m.available && m.learnable;
                // #765: "unavailable" was wrong for Python — it is installed
                // and runs fine, it just can't drive autodiff. Say which of the
                // two reasons applies so the disabled option is honest.
                // #763: a mode can also be structurally invalid for this
                // composition (PyTorch on a plain Composition), which is a
                // different thing from missing or non-training.
                const supported = (m as { supported?: boolean }).supported ?? true;
                const why = !m.available
                  ? " — unavailable"
                  : !supported
                  ? " — not supported"
                  : !m.learnable
                  ? " — can't train"
                  : "";
                return (
                  <option key={m.id} value={m.id} disabled={!usable} title={m.reason ?? undefined}>
                    {m.label}
                    {why}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {!busy ? (
          <Button
            kind="primary" size="slim"
            onClick={handleStart}
            disabled={!allCellsValid || !lrValid || !compositionName}
            title={!allCellsValid ? "Fix the highlighted cells first" : undefined}
          >
            Start Learning
          </Button>
        ) : (
          <Button kind="secondary" size="slim" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {/* Status line */}
      {phase !== "idle" && (
        <div style={{ marginBottom: 10, color: "var(--pnv-text-secondary)" }}>
          {phase === "submitting" && "Submitting job..."}
          {phase === "running" && (
            <span>
              Training… epoch {progress.length}/{epochs}
              {lastLoss != null && <> — {metricWord} {formatMetricValue(lastLoss)}</>}
              {jobId && <span style={{ color: "var(--pnv-text-faint)" }}> (job {jobId})</span>}
            </span>
          )}
          {phase === "done" && (
            <span style={{ color: "var(--pnv-success)", fontWeight: 600 }}>
              Training complete — final {metricWord}{" "}
              {formatMetricValue(result?.finalLoss)} after{" "}
              {result?.epochs ?? progress.length} epochs
            </span>
          )}
          {phase === "done" &&
            (result?.warnings ?? []).map((w) => (
              <div key={w} style={{ color: "var(--pnv-warning)" }}>{w}</div>
            ))}
          {/* #766: the concrete PsyNeuLink call, and (#765) why the resolved
              backend differs from the selection when it does. One component so
              Run and Learn present the same fact identically. */}
          {phase === "done" && (
            <PnlCallLine call={result?.pnlCall} reason={result?.executionModeReason} />
          )}
          {phase === "canceled" && <span style={{ color: "var(--pnv-warning)", fontWeight: 600 }}>Training canceled.</span>}
          {phase === "error" && (
            <span style={{ color: "var(--pnv-danger)", whiteSpace: "pre-wrap" }}>{error}</span>
          )}
        </div>
      )}

      {/* Live loss chart */}
      {progress.length > 0 && (
        <div data-testid="learn-metric-chart" style={{ marginBottom: 12 }}>
          <div
            data-testid="learn-metric-title"
            title={`${metric.description} (${metric.unit})`}
            style={{ fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 4, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}
          >
            {metric.label} by Epoch
          </div>
          {metric.id !== "loss" && (
            <div data-testid="learn-metric-note" style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)", marginBottom: 4 }}>
              {metric.description} Shown as {metric.unit}.
            </div>
          )}
          <Plot
            data={[
              {
                x: progress.map((p) => p.epoch),
                y: progress.map((p) => p.loss),
                type: "scatter",
                mode: progress.length > 60 ? "lines" : "lines+markers",
                name: metricWord,
                line: { color: paletteColor("--pnv-chart-1"), width: 2 },
                marker: { size: 5 },
              },
            ]}
            layout={{
              height: 220,
              margin: { l: 55, r: 20, t: 10, b: 40 },
              xaxis: { title: { text: "Epoch" }, rangemode: "tozero" },
              yaxis: { title: { text: metric.label }, rangemode: "tozero" },
              font: { size: 11 },
              showlegend: false,
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: "100%" }}
          />
        </div>
      )}

      {/* Inputs / targets grids */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <NodeGrid
          title="Training inputs"
          nodes={inputNodes}
          cells={inputCells}
          setCells={setInputCells}
          kind="input"
          modelLabels={modelLabels}
          disabled={busy}
        />
        {learningProfile?.kind === "pathway" && targetNodes.length === 0 ? (
          <div data-testid="learn-no-targets" style={{ minWidth: 220, maxWidth: 360 }}>
            <div style={{ fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
              Targets
            </div>
            <div style={{ color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-12)", lineHeight: 1.5 }}>
              None. This model learns without a target (Hebbian learning), so there is no
              error and no loss. Training reports how much its weights change each epoch instead.
            </div>
          </div>
        ) : (
          <NodeGrid
            title="Targets (desired outputs)"
            nodes={targetNodes}
            cells={targetCells}
            setCells={setTargetCells}
            kind="output"
            modelLabels={modelLabels}
            disabled={busy}
          />
        )}
      </div>
    </div>
  );
}

/** A training set's target cells — or, for a model with no target nodes
 *  (Hebbian, #997), an empty grid that matches any trial count. */
function targetCellsFromSet(
  set: { targets?: Record<string, number[][]> } | undefined,
  targetNodes: LearnNodeInfo[],
  inputTrials: number | undefined,
): { cells: Record<string, string[][]>; trials: number } | null {
  if (!set) return null;
  if (targetNodes.length === 0) return inputTrials != null ? { cells: {}, trials: inputTrials } : null;
  return set.targets ? cellsFromSet(set.targets, targetNodes) : null;
}

function NodeGrid({
  title,
  nodes,
  cells,
  setCells,
  kind,
  modelLabels,
  disabled,
}: {
  title: string;
  nodes: LearnNodeInfo[];
  cells: Record<string, string[][]>;
  setCells: React.Dispatch<React.SetStateAction<Record<string, string[][]>>>;
  kind: "input" | "output";
  modelLabels: Parameters<typeof resolveInputLabels>[0];
  disabled: boolean;
}) {
  if (nodes.length === 0) {
    return (
      <div style={{ minWidth: 220 }}>
        <div style={{ fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6 }}>{title}</div>
        <div style={{ color: "var(--pnv-text-faint)", fontSize: "var(--pnv-fs-12)" }}>No {kind === "input" ? "input" : "output"} nodes found.</div>
      </div>
    );
  }
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontSize: "var(--pnv-fs-12)", fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
        {title}
      </div>
      {nodes.map((node) => {
        const labels = elementLabels(node, kind, modelLabels);
        const trials = cells[node.varName] || [];
        return (
          <div key={node.varName} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-body)", marginBottom: 3 }}>{node.name}</div>
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", padding: "0 4px" }}></th>
                  {labels.map((l, i) => (
                    <th key={i} style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", fontWeight: 500, padding: "0 4px" }}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trials.map((trial, t) => (
                  <tr key={t}>
                    <td style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", padding: "0 4px" }}>{t + 1}</td>
                    {trial.map((cell, i) => (
                      <td key={i} style={{ padding: 1 }}>
                        <input
                          type="text"
                          value={cell}
                          disabled={disabled}
                          data-testid={`learn-${kind}-${node.name}-${t}-${i}`}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCells((prev) => {
                              const next = { ...prev };
                              const rows = (next[node.varName] || []).map((r) => [...r]);
                              if (rows[t]) rows[t][i] = v;
                              next[node.varName] = rows;
                              return next;
                            });
                          }}
                          style={{
                            width: 44,
                            fontSize: "var(--pnv-fs-12)",
                            textAlign: "center",
                            border: `1px solid ${isValidCell(cell) ? "var(--pnv-border-light)" : "var(--pnv-danger)"}`,
                            borderRadius: 3,
                            padding: "2px 2px",
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
