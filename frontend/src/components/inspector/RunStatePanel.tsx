/**
 * Run State panel — unified "what's happening right now" view for the active
 * trace step (#355).
 *
 * Joins data that used to live in three or four scattered surfaces (canvas
 * pill, trace bar, collapsed snapshot table) into one place:
 *  - traceStep / executionTrace      (active step + active nodes)
 *  - executionTrialBoundaries        (trial-relative formatting)
 *  - debuggerSnapshots               (category + raw snapshot row)
 *  - traceStepValues                 (per-node value map)
 *
 * Semantic labels for vector dimensions will render here once #356 / #361
 * lands — the per-node values table is the primary consumer.
 */

import { useMemo, useState, type CSSProperties } from "react";
import { useModelStore, type MechanismData } from "@/stores/modelStore";
import { formatTraceValue } from "@/utils/traceValues";
import {
  resolveOutputLabels,
  formatLabeledValue,
  expandMultiPort,
} from "@/utils/labels";
import { GridLegend, ValueGrid, ValueViewToggle, poolValues, useNodeGrid } from "@/components/common/ValueGrid";
import { MIN_GRID_SIZE, numericVector } from "@/utils/valueGrid";

export function RunStatePanel() {
  const traceStep = useModelStore((s) => s.traceStep);
  const executionTrace = useModelStore((s) => s.executionTrace);
  const trialBoundaries = useModelStore((s) => s.executionTrialBoundaries);
  const snapshots = useModelStore((s) => s.debuggerSnapshots);
  const traceStepValues = useModelStore((s) => s.traceStepValues);
  // #387: the static derived order (each entry a concurrent phase) plus the
  // authored conditions, so the queue view can show pending/fired state and
  // tie a node's firing back to the condition that gated it.
  const considerationQueue = useModelStore((s) => s.schedulerConfig.considerationQueue);
  const basicConditions = useModelStore((s) => s.basicConditions);
  // #361 Layer 3: sidecar labels resolved per-row in the values table.
  const modelLabels = useModelStore((s) => s.modelLabels);
  // #401: need each node's outputPorts metadata to render multi-port
  // values per-port instead of as one ellipsized string.
  const nodes = useModelStore((s) => s.nodes);
  const nodesByName = useMemo(() => {
    const map = new Map<string, MechanismData>();
    for (const n of nodes) {
      const d = n.data as unknown as MechanismData;
      if (d?.varName) map.set(d.varName, d);
      if (d?.label) map.set(d.label, d);
    }
    return map;
  }, [nodes]);

  const totalSteps = executionTrace.length;
  const hasTrialNav = trialBoundaries.length > 1;

  // Mirrors TraceControls' currentTrial computation.
  const currentTrial = useMemo(() => {
    if (traceStep === null || trialBoundaries.length === 0) return null;
    let t = 0;
    for (let i = 0; i < trialBoundaries.length; i++) {
      if (trialBoundaries[i] <= traceStep) t = i;
      else break;
    }
    return t;
  }, [traceStep, trialBoundaries]);

  const trialStart =
    currentTrial !== null ? trialBoundaries[currentTrial] : 0;
  const trialEnd =
    currentTrial !== null && currentTrial < trialBoundaries.length - 1
      ? trialBoundaries[currentTrial + 1]
      : totalSteps;
  const stepInTrial =
    traceStep !== null ? traceStep - trialStart : null;
  const stepsThisTrial = trialEnd - trialStart;

  // Walk snapshots once to recover the step-mapping for each entry, then find
  // the EXECUTION_SET (or first NODE_EXECUTION) at the current step — that
  // gives us the category to show.
  const snapshotsAtStep = useMemo(() => {
    if (traceStep === null) return [];
    const out: typeof snapshots = [];
    let step = -1;
    for (const snap of snapshots) {
      if (snap.category === "EXECUTION_SET") {
        step += 1;
        if (step === traceStep) out.push(snap);
      } else if (snap.category === "NODE_EXECUTION") {
        if (step === traceStep) out.push(snap);
      }
    }
    return out;
  }, [snapshots, traceStep]);

  const activeNodes =
    traceStep !== null && executionTrace[traceStep]
      ? executionTrace[traceStep]
      : [];

  // #533: index of the consideration phase that contains a node firing at the
  // current step, so the collapsed-summary line can still read "phase X firing
  // now" without opening the panel. -1 when nothing is active.
  const activePhaseIdx = useMemo(() => {
    if (!considerationQueue || activeNodes.length === 0) return -1;
    return considerationQueue.findIndex((phase) =>
      phase.some((n) => activeNodes.includes(n)),
    );
  }, [considerationQueue, activeNodes]);

  // #533: foldable Consideration queue. Defaults to open so first-use feels
  // unchanged; the user can fold it on busy compositions where it dominates
  // the panel. Local state — collapsed state doesn't need cross-session
  // persistence today (issue notes this as nice-to-have, not required).
  const [queueOpen, setQueueOpen] = useState(true);

  // #387: every node that has already fired at or before the current step,
  // so the queue view can grey out spent nodes and distinguish them from
  // the ones still pending in this trial's remaining phases.
  const firedNodes = useMemo(() => {
    const set = new Set<string>();
    if (traceStep === null) return set;
    for (let i = 0; i <= traceStep && i < executionTrace.length; i++) {
      for (const n of executionTrace[i]) set.add(n);
    }
    return set;
  }, [executionTrace, traceStep]);

  // #387: node name -> human explanation of the condition gating it, drawn
  // from the authored basic conditions. Surfaced as a hover so a node's
  // place in the queue ties back to *why* it fires when it does.
  const explanationByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const bc of basicConditions) {
      const expl = bc.condition?.explanation;
      if (expl && bc.owner) map.set(bc.owner, expl);
    }
    return map;
  }, [basicConditions]);

  const valuesAtStep =
    traceStep !== null ? traceStepValues.get(traceStep) : undefined;

  // #1387: every value each node takes across the run's steps, so a grid's
  // shading stays put as the trace steps and only the cells change.
  const pooledByNode = useMemo(() => {
    const all = new Map<string, unknown[]>();
    for (const byNode of traceStepValues.values()) {
      for (const [node, entry] of Object.entries(byNode)) {
        all.set(node, [...(all.get(node) ?? []), entry.value]);
      }
    }
    const out = new Map<string, number[]>();
    for (const [node, values] of all) out.set(node, poolValues(values));
    return out;
  }, [traceStepValues]);

  if (totalSteps === 0) {
    return (
      <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-13)" }}>
        Run a model and step through the trace to see what's happening at
        each scheduler step.
      </div>
    );
  }

  if (traceStep === null) {
    return (
      <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-13)" }}>
        No active trace step. Use the trace bar's ▶ to step forward.
      </div>
    );
  }

  const setSnap = snapshotsAtStep.find((s) => s.category === "EXECUTION_SET");
  const nodeExecSnaps = snapshotsAtStep.filter(
    (s) => s.category === "NODE_EXECUTION",
  );

  return (
    <div style={{ padding: "12px 16px", fontSize: "var(--pnv-fs-13)", lineHeight: 1.5 }}>
      <div
        style={{
          fontSize: "var(--pnv-fs-12)",
          fontWeight: 700,
          color: "var(--pnv-text-body)",
          marginBottom: 8,
          letterSpacing: 0.3,
        }}
      >
        RUN STATE — CURRENT STEP
      </div>

      {/* Step + trial position */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "monospace", color: "var(--pnv-text-body)" }}>
          Step <b>{traceStep + 1}</b> of {totalSteps}
        </div>
        {hasTrialNav && currentTrial !== null && stepInTrial !== null && (
          <div style={{ fontFamily: "monospace", color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-12)" }}>
            Trial <b>{currentTrial + 1}</b> of {trialBoundaries.length}
            {" · "}step {stepInTrial + 1} of {stepsThisTrial}
          </div>
        )}
      </div>

      {/* Category */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-11)", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Category
        </span>
        <div style={{ fontFamily: "monospace", color: "var(--pnv-primary)", fontWeight: 600 }}>
          {setSnap ? setSnap.category : nodeExecSnaps.length > 0 ? "NODE_EXECUTION" : "—"}
        </div>
      </div>

      {/* Active nodes */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-11)", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Active nodes
        </span>
        <div style={{ fontFamily: "monospace", color: "var(--pnv-text-body)" }}>
          {activeNodes.length > 0 ? activeNodes.join(", ") : "—"}
        </div>
      </div>

      {/* Per-node values */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-11)", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Values at this step
        </span>
        {valuesAtStep && Object.keys(valuesAtStep).length > 0 ? (
          <table
            style={{
              width: "100%",
              fontFamily: "monospace",
              fontSize: "var(--pnv-fs-12)",
              borderCollapse: "collapse",
              marginTop: 4,
            }}
          >
            <tbody>
              {Object.entries(valuesAtStep).map(([node, entry]) => {
                const meta = nodesByName.get(node);
                // #401: split multi-port values into per-port rows so a
                // mechanism like LC (one output port per modulated target)
                // doesn't get smashed into one ellipsized string. Single-port
                // values render as one row, identical to the prior behavior.
                const ports = expandMultiPort(
                  entry.value,
                  meta?.outputPorts,
                  node,
                  modelLabels,
                );
                if (ports) {
                  return (
                    <tr key={node} style={{ borderBottom: "1px solid var(--pnv-border-faint)", verticalAlign: "top" }}>
                      <td style={{ padding: "3px 6px", color: "var(--pnv-text-body)", width: "30%" }}>
                        {node}
                      </td>
                      <td style={{ padding: "3px 6px", color: "var(--pnv-trace-value)", wordBreak: "break-all" }}>
                        {ports.map((p) => (
                          <div key={p.portName} style={{ display: "flex", gap: 8, lineHeight: 1.5 }}>
                            {/* #404: when a sidecar display_name is set,
                                surface it as the port row's label and put
                                the technical PNL name in the hover so
                                developers can still cross-reference. */}
                            <span
                              style={{ color: "var(--pnv-text-hint)", flexShrink: 0, minWidth: 90 }}
                              title={p.displayName ? `port.name = ${p.portName}` : ""}
                            >
                              {p.displayName ?? p.portName}
                            </span>
                            <span title={formatTraceValue(p.value, 1000)}>
                              {formatLabeledValue(p.value, p.labels, { maxLen: 1000 })}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                }
                // #11: prefer model-intrinsic element_names on the
                // node's outputPorts before falling through to sidecar.
                const labels = resolveOutputLabels(
                  modelLabels,
                  node,
                  undefined,
                  meta?.outputPorts,
                );
                return (
                  <SingleValueRow
                    key={node}
                    node={node}
                    meta={meta}
                    value={entry.value}
                    text={formatLabeledValue(entry.value, labels, { maxLen: 1000 })}
                    scaleFrom={pooledByNode.get(node)}
                  />
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ color: "var(--pnv-text-faint)", fontSize: "var(--pnv-fs-12)", fontStyle: "italic" }}>
            No per-node values captured. Either the PsyNeuLink build lacks
            the <code>_debugger</code> hook, or this step boundary doesn't
            include <code>NODE_EXECUTION</code> snapshots.
          </div>
        )}
      </div>

      {/* #387: Consideration queue with per-step status. Each phase is a
          concurrent consideration set; nodes are colored by whether they're
          firing now (green), already spent (grey), or still pending (outline).
          The hover ties a node back to the condition that gates it.
          #533: foldable — defaults to open so the section keeps the same
          first-use feel, but lets the user collapse it on busy compositions
          where it dominates the panel. Matches the <details> pattern used
          by the Raw snapshots section below.
          Rendered below the values table so the per-step values stay near
          the top of the panel where vertical space is scarce. */}
      {considerationQueue && considerationQueue.length > 0 && (
        <details
          open={queueOpen}
          onToggle={(e) => setQueueOpen((e.currentTarget as HTMLDetailsElement).open)}
          style={{ marginBottom: 12 }}
        >
          <summary style={{ cursor: "pointer", color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-11)", textTransform: "uppercase", letterSpacing: 0.3 }}>
            Consideration queue ({considerationQueue.length} phase{considerationQueue.length === 1 ? "" : "s"}
            {activePhaseIdx !== -1 ? ` — phase ${activePhaseIdx + 1} firing now` : ""})
          </summary>
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
            {considerationQueue.map((phase, phaseIdx) => (
              <div key={phaseIdx} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "var(--pnv-fs-11)",
                    color: "var(--pnv-text-faint)",
                    flexShrink: 0,
                    minWidth: 28,
                  }}
                >
                  #{phaseIdx + 1}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {phase.map((node) => {
                    const isActive = activeNodes.includes(node);
                    const isFired = firedNodes.has(node);
                    const expl = explanationByNode.get(node);
                    // Active beats fired (the current step's nodes are also in
                    // firedNodes since the walk is inclusive of traceStep).
                    const status = isActive
                      ? "active"
                      : isFired
                        ? "fired"
                        : "pending";
                    const style: CSSProperties = {
                      fontFamily: "monospace",
                      fontSize: "var(--pnv-fs-11)",
                      padding: "1px 6px",
                      borderRadius: 3,
                      ...(status === "active"
                        ? { background: "var(--pnv-trace-value)", color: "var(--pnv-on-primary)", fontWeight: 600 }
                        : status === "fired"
                          ? { background: "var(--pnv-surface-sunken)", color: "var(--pnv-text-faint)" }
                          : { border: "1px solid var(--pnv-border)", color: "var(--pnv-text-secondary)" }),
                    };
                    return (
                      <span
                        key={node}
                        style={style}
                        title={expl ? `${node} — ${expl}` : node}
                      >
                        {node}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 12, fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-hint)" }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--pnv-trace-value)", borderRadius: 2, marginRight: 4 }} />firing now</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--pnv-surface-sunken)", border: "1px solid var(--pnv-border-light)", borderRadius: 2, marginRight: 4 }} />fired</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, border: "1px solid var(--pnv-border)", borderRadius: 2, marginRight: 4 }} />pending</span>
          </div>
        </details>
      )}

      {/* Raw snapshot rows — fallback for everything not yet labeled */}
      {snapshotsAtStep.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", color: "var(--pnv-text-muted)", fontSize: "var(--pnv-fs-11)", textTransform: "uppercase", letterSpacing: 0.3 }}>
            Raw snapshots at this step ({snapshotsAtStep.length})
          </summary>
          <pre
            style={{
              fontSize: "var(--pnv-fs-11)",
              fontFamily: "monospace",
              background: "var(--pnv-surface-muted)",
              border: "1px solid var(--pnv-border-faint)",
              borderRadius: 3,
              padding: 6,
              marginTop: 6,
              overflow: "auto",
              maxHeight: 180,
            }}
          >
            {JSON.stringify(snapshotsAtStep, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * One node's row in "Values at this step": its name, and its value as text
 * or (#1387) as a grid, with the "list | grid" toggle under the name when the
 * value is a vector big enough to draw.
 */
function SingleValueRow({
  node,
  meta,
  value,
  text,
  scaleFrom,
}: {
  node: string;
  meta: MechanismData | undefined;
  value: unknown;
  text: string;
  scaleFrom?: number[];
}) {
  const declared = meta?.outputPorts?.[0]?.shape;
  const { view, grid, size } = useNodeGrid([node, meta?.label, meta?.varName], value, declared, scaleFrom);
  const key = node.replace(/-\d+$/, "");
  return (
    <tr style={{ borderBottom: "1px solid var(--pnv-border-faint)", verticalAlign: "top" }}>
      <td style={{ padding: "3px 6px", color: "var(--pnv-text-body)", width: "30%" }}>
        {node}
        {size >= MIN_GRID_SIZE && numericVector(value) && (
          <div style={{ marginTop: 2 }}>
            <ValueViewToggle
              node={key}
              size={size}
              view={view}
              shape={grid?.shape}
              testId={`runstate-value-view-${key}`}
            />
          </div>
        )}
      </td>
      <td
        style={{ padding: "3px 6px", color: "var(--pnv-trace-value)", wordBreak: "break-all" }}
        title={grid ? undefined : formatTraceValue(value, 1000)}
      >
        {grid ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <ValueGrid grid={grid} cell={14} node={key} testId={`runstate-value-grid-${key}`} />
            <GridLegend scale={grid.scale} testId={`runstate-value-legend-${key}`} />
          </div>
        ) : (
          /* #401: no hard char cap — let the cell wrap. The title attribute
             still carries the full string for a quick hover-copy if needed. */
          text
        )}
      </td>
    </tr>
  );
}
