import { useModelStore } from "@/stores/modelStore";
import { useUIStore } from "@/stores/uiStore";
import { useTextScale } from "@/stores/textSizeStore";
import { findGscEdgeId } from "@/utils/gscEdgeId";
import {
  SchedulerModeToggle,
  TerminationSection,
  conditionToString,
  GSC_COLORS,
} from "@/components/inspector/InspectorPanel";

/**
 * Composition-wide scheduler workspace (#380). The dedicated home for the
 * settings that aren't tied to a single selected node: scheduling mode, the
 * derived consideration queue, a roster of every condition in the composition
 * (with plain-English read-back from #388), graph-structure conditions, and
 * per-TimeScale termination. Per-node condition authoring stays in the
 * inspector / canvas; this panel is the global picture.
 */
export function SchedulerPanel() {
  const gscConditions = useModelStore((s) => s.gscConditions);
  const basicConditions = useModelStore((s) => s.basicConditions);
  const terminationConditions = useModelStore((s) => s.terminationConditions);
  const schedulerConfig = useModelStore((s) => s.schedulerConfig);
  const nodes = useModelStore((s) => s.nodes);
  const filePath = useModelStore((s) => s.filePath);
  const activeComposition = useModelStore((s) => s.activeComposition);
  const compositionNames = useModelStore((s) => s.compositionNames);
  const setSelectedNodeId = useModelStore((s) => s.setSelectedNodeId);
  const setSelectedEdgeId = useModelStore((s) => s.setSelectedEdgeId);

  const fontScale = useUIStore((s) => s.inspectorFontScale) * useTextScale();
  const zoomIn = useUIStore((s) => s.zoomIn);
  const zoomOut = useUIStore((s) => s.zoomOut);
  const s = (base: number) => Math.round(base * fontScale);

  const compName = activeComposition || compositionNames[0] || "Scheduler";
  const allNodeNames = nodes
    .filter((n) => n.type === "mechanismNode")
    .map((n) => (n.data as any)?.varName)
    .filter(Boolean) as string[];

  const hasSchedulerData =
    gscConditions.length > 0 ||
    basicConditions.length > 0 ||
    Object.keys(terminationConditions).length > 0 ||
    !!schedulerConfig.considerationQueue;

  if (!filePath) {
    return (
      <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: s(13) }}>
        Load a model to see and edit its schedule.
      </div>
    );
  }

  if (!hasSchedulerData) {
    return (
      <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: s(13) }}>
        <div style={{ fontSize: s(15), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6 }}>
          {compName} — Scheduler
        </div>
        This composition has no scheduling conditions yet. Select a node to add an
        execution condition, or use the canvas to relate two nodes.
      </div>
    );
  }

  const knownNodes = new Set(allNodeNames);

  // Collect node names a basic condition references, to flag dangling refs.
  const conditionRefs = (cond: any): string[] => {
    const out: string[] = [];
    const walk = (c: any) => {
      if (!c) return;
      if (Array.isArray(c.children)) c.children.forEach(walk);
      const args = c.args?.positional as unknown[] | undefined;
      (args || []).forEach((a: any) => {
        if (a && typeof a === "object" && "_node" in a) out.push(a._node as string);
      });
    };
    walk(cond);
    return out;
  };

  const danglingOwners = basicConditions.filter((bc) =>
    conditionRefs(bc.condition).some((ref) => !knownNodes.has(ref)),
  );

  return (
    <div style={{ padding: "12px 16px", overflow: "auto", height: "100%", fontSize: s(13) }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: s(17), fontWeight: 600 }}>{compName}</span>
        <span style={{ fontSize: s(12), color: "var(--pnv-text-hint)" }}>scheduler</span>
        {schedulerConfig.mode && (
          <SchedulerModeToggle mode={schedulerConfig.mode} fontPx={s(11)} />
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <button onClick={zoomOut} title="Decrease font size" style={{ fontSize: "var(--pnv-fs-11)", padding: "1px 5px", border: "1px solid var(--pnv-border)", borderRadius: 3, background: "var(--pnv-surface-sunken)", cursor: "pointer", color: "var(--pnv-text-secondary)" }}>A-</button>
          <button onClick={zoomIn} title="Increase font size" style={{ fontSize: "var(--pnv-fs-11)", padding: "1px 5px", border: "1px solid var(--pnv-border)", borderRadius: 3, background: "var(--pnv-surface-sunken)", cursor: "pointer", color: "var(--pnv-text-secondary)" }}>A+</button>
        </span>
      </div>
      <div style={{ fontSize: s(11), color: "var(--pnv-text-faint)", marginBottom: 14 }}>
        You edit conditions; the execution order below is derived from them.
      </div>

      {danglingOwners.length > 0 && (
        <div style={{
          marginBottom: 14, padding: "6px 10px", borderRadius: 4,
          background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)",
          fontSize: s(11), color: "var(--pnv-warning)",
        }}>
          <strong>Check these conditions:</strong>{" "}
          {danglingOwners.map((bc) => bc.owner).join(", ")} reference a node that is
          no longer in the composition.
        </div>
      )}

      {/* Execution Order — the derived consideration queue (read-only feedback). */}
      {schedulerConfig.considerationQueue && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: s(12), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
            Execution Order
          </div>
          <div style={{ fontSize: s(11), color: "var(--pnv-text-muted)", marginBottom: 6 }}>
            Nodes in the same step execute concurrently.
          </div>
          {schedulerConfig.considerationQueue.map((step, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 8px", marginBottom: 2,
              background: i % 2 === 0 ? "var(--pnv-surface-muted)" : "var(--pnv-surface)",
              borderRadius: 4,
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

      {/* Execution Conditions roster — each row links to its owner node. */}
      {basicConditions.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: s(12), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
            Execution Conditions
          </div>
          {basicConditions.map((bc) => (
            <div
              key={bc.owner}
              onClick={() => {
                const node = nodes.find((n) => (n.data as any)?.varName === bc.owner);
                if (node) setSelectedNodeId(node.id);
              }}
              style={{
                padding: "5px 8px", marginBottom: 4,
                background: "var(--pnv-primary-tint)", border: "1px solid var(--pnv-primary-tint-border)", borderRadius: 4,
                cursor: "pointer", transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--pnv-primary-tint-border)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--pnv-primary-tint)"; }}
              title={`Click to select ${bc.owner}`}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ fontSize: s(11), fontWeight: 600, color: "var(--pnv-text-secondary)", minWidth: 60 }}>
                  {bc.owner}
                </span>
                <span style={{ fontSize: s(11), fontFamily: "monospace", color: "var(--pnv-primary)" }}>
                  {conditionToString(bc.condition)}
                </span>
              </div>
              {bc.condition.explanation && (
                <div style={{ fontSize: s(10), fontStyle: "italic", color: "var(--pnv-text-hint)", marginLeft: 68, marginTop: 1 }}>
                  {bc.condition.explanation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Graph Structure Conditions — each row links to its rendered edge. */}
      {gscConditions.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: s(12), fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 6, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 3 }}>
            Graph Structure Conditions
          </div>
          {gscConditions.map((gsc) => {
            const color = GSC_COLORS[gsc.type] || "var(--pnv-gsc-other)";
            return (
              <div
                key={gsc.id}
                onClick={() => {
                  // The edge ids name both endpoints (#651), so look the edge up (#1370).
                  const edgeId = findGscEdgeId(useModelStore.getState().edges, gsc.id);
                  if (edgeId) setSelectedEdgeId(edgeId);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 8px", marginBottom: 2,
                  cursor: "pointer", borderRadius: 4, transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--pnv-surface-sunken)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                title={`Click to inspect ${gsc.type}`}
              >
                <span style={{
                  fontSize: s(10), fontWeight: 600, fontFamily: "monospace",
                  color: "var(--pnv-on-primary)", background: color, padding: "0 5px",
                  borderRadius: 6, lineHeight: "16px",
                }}>
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

      {/* Termination — editable per TimeScale (#382). */}
      <TerminationSection
        terminationConditions={terminationConditions}
        allNodeNames={allNodeNames}
        fontScale={fontScale}
      />

      <div style={{ color: "var(--pnv-text-faint)", fontSize: s(11), marginTop: 8 }}>
        Click a condition to jump to its node or edge in the graph.
      </div>
    </div>
  );
}
