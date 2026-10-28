/**
 * Custom React Flow node for PsyNeuLink Mechanisms.
 * Supports role-based coloring (show_graph parity) and execution trace highlighting.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useSafeUpdateNodeInternals } from "@/hooks/useSafeUpdateNodeInternals";
import { usePortLayout } from "@/stores/portLayoutStore";
import type { MechanismData } from "@/stores/modelStore";
import { useGraphSettings, type GraphDirection } from "@/stores/graphSettingsStore";
import { useModelStore, NODE_HEIGHT, NODE_WIDTH } from "@/stores/modelStore";
import { TYPE_COLORS, ROLE_COLORS, ROLE_PRIORITY } from "@/constants/pnlTypes";
import { toggleCompositionCollapse } from "@/utils/nodeActions";
import { formatTraceValue } from "@/utils/traceValues";
import { ValueGrid, poolValues, useNodeGrid } from "@/components/common/ValueGrid";
import { useValueViews, valueViewFor } from "@/stores/valueViewStore";
import { NODE_OUTLINE_EMPHASIS_EXTRA, NODE_OUTLINE_SELECTED_EXTRA, useNodeOutlineWidth } from "@/stores/nodeOutlineStore";
import {
  resolveOutputLabels,
  formatLabeledValue,
  labeledValueLines,
} from "@/utils/labels";

/** How tall the value pill's grid is (#1387): its 10px line of text. */
const PILL_GRID_HEIGHT = 10;

/** Map graph direction to handle positions for inputs (target) and outputs (source). */
function getHandlePositions(dir: GraphDirection): { input: Position; output: Position } {
  switch (dir) {
    case "BT": return { input: Position.Bottom, output: Position.Top };
    case "LR": return { input: Position.Left, output: Position.Right };
    case "RL": return { input: Position.Right, output: Position.Left };
    default:   return { input: Position.Top, output: Position.Bottom };
  }
}

// Okabe-Ito palette — distinguishable for the most common color-vision deficiencies.
// https://jfly.uni-koeln.de/color/
const PORT_COLORS = {
  input: "var(--pnv-port-input)",          // blue
  output: "var(--pnv-port-output)",        // bluish green
  parameter: "var(--pnv-port-parameter)",  // orange
} as const;

// Spread N ports evenly along the node edge, using ~80% of the edge so
// endpoints don't crowd the node's corners. Single port sits centered.
// Returns a unitless percent (0–100) for use in ellipse-boundary math.
function getPortOffsetPct(index: number, count: number): number {
  if (count <= 1) return 50;
  return 10 + (index * 80) / (count - 1);
}

type EllipseArc = "top" | "bottom" | "left" | "right";

// Project a linear edge offset onto the boundary of the ellipse inscribed
// in the node's bounding box. `pct` (0–100) is the linear position along
// the bounding-box edge; the returned (left, top) percentages place the
// port directly on the visible oval curve.
//   For top/bottom arcs: pct walks the horizontal axis 0%→100%, the result
//     pulls vertically toward the center as you approach the corners.
//   For left/right arcs: pct walks the vertical axis 0%→100%, the result
//     pulls horizontally inward at the top and bottom.
function ellipseBoundaryStyle(arc: EllipseArc, pct: number): React.CSSProperties {
  const t = (pct - 50) / 50;            // -1..1
  const r = Math.sqrt(Math.max(0, 1 - t * t)); // 0..1
  const inward = (1 - r) * 50;          // distance from edge toward center, in %
  switch (arc) {
    case "top":    return { left: `${pct}%`, top: `${inward}%`,         right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" };
    case "bottom": return { left: `${pct}%`, top: `${100 - inward}%`,   right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" };
    case "left":   return { top: `${pct}%`, left: `${inward}%`,         right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" };
    case "right":  return { top: `${pct}%`, left: `${100 - inward}%`,   right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" };
  }
}

// #282: place a port at an arbitrary angle around the node oval (the ellipse
// parameter, radians). Point on the inscribed ellipse in box-percent units.
function anglePortStyle(angle: number): React.CSSProperties {
  return {
    left: `${50 + 50 * Math.cos(angle)}%`,
    top: `${50 + 50 * Math.sin(angle)}%`,
    right: "auto",
    bottom: "auto",
    transform: "translate(-50%, -50%)",
  };
}

// Map graph direction → which arc each port role sits on.
function arcsForDirection(dir: GraphDirection): { input: EllipseArc; output: EllipseArc; parameter: EllipseArc } {
  switch (dir) {
    case "BT": return { input: "bottom", output: "top",    parameter: "left" };
    case "LR": return { input: "left",   output: "right",  parameter: "top" };
    case "RL": return { input: "right",  output: "left",   parameter: "top" };
    default:   return { input: "top",    output: "bottom", parameter: "left" }; // TB
  }
}

function getRoleColor(roles: string[], custom: Record<string, string> | null): string {
  const colors = custom || ROLE_COLORS;
  if (!roles || roles.length === 0) return colors.INTERNAL || "var(--pnv-role-internal)";

  // Check for INPUT+OUTPUT singleton
  if (roles.includes("INPUT") && roles.includes("OUTPUT")) {
    return colors.SINGLETON || ROLE_COLORS.SINGLETON;
  }

  // Find highest priority role
  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) return colors[role] || ROLE_COLORS[role] || "var(--pnv-role-internal)";
  }
  return colors.INTERNAL || "var(--pnv-role-internal)";
}

function getRoleBorderWidth(roles: string[], regular: number, emphasis: number): number {
  if (!roles || roles.length === 0) return regular;
  const boldRoles = ["INPUT", "OUTPUT", "PROBE", "CONTROL", "CONTROLLER", "CONTROLLER_OBJECTIVE"];
  return roles.some((r) => boldRoles.includes(r)) ? emphasis : regular;
}

export const MechanismNode = memo(function MechanismNode({
  id,
  data,
  selected,
}: NodeProps) {
  const d = data as unknown as MechanismData;
  const [hoveredPort, setHoveredPort] = useState<{
    name: string;
    role: "input" | "output" | "parameter";
    shape: number[];
  } | null>(null);
  // #336: hover on the trace-step value pill reveals a richer tooltip with
  // the output-port name + shape, snapshot category, trial number, and
  // full-precision value.
  const [pillHovered, setPillHovered] = useState(false);
  const colorByRole = useGraphSettings((s) => s.colorByRole);
  const showDimensions = useGraphSettings((s) => s.showDimensions);
  const showFullTypes = useGraphSettings((s) => s.showFullTypes);
  const showPortDots = useGraphSettings((s) => s.showPortDots);
  // #945: under floating attachment, each edge draws its own connection dot at
  // its real attachment point (ProjectionEdge). The single fixed input/output
  // dot would then sit where no edge lands, so hide it; parameter ports (which
  // carry no projection) keep their fixed dot.
  const floatingPorts = useGraphSettings((s) => s.floatingPorts);
  const showConnDots = showPortDots && !floatingPorts;
  const showNodeNames = useGraphSettings((s) => s.showNodeNames);
  const showNodeElements = useGraphSettings((s) => s.showNodeElements);
  const showExecutionOrder = useGraphSettings((s) => s.showExecutionOrder);
  const direction = useGraphSettings((s) => s.direction);
  // Settings ▸ Appearance ▸ Node outlines (#42).
  const nodeBorderWidth = useNodeOutlineWidth();
  const nodeBorderWidthEmphasis = nodeBorderWidth + NODE_OUTLINE_EMPHASIS_EXTRA;
  const expanded = useGraphSettings((s) => s.expandedNodes.has(d.label || ""));

  // #282: draggable ports. `portOverrides` holds this node's per-port angular
  // placements around the oval; Alt-dragging a port dot updates it, and we ask
  // React Flow to remeasure so edges re-anchor to the moved handle.
  // Not React Flow's own: that one crashes on a name with a newline (#1236).
  const updateNodeInternals = useSafeUpdateNodeInternals();
  const portOverrides = usePortLayout((s) => s.overrides[id]);
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portOverrides, updateNodeInternals]);
  const startPortDrag = useCallback(
    (portKey: string) => (e: React.PointerEvent) => {
      // Plain drag on a handle starts a connection (React Flow); Alt-drag
      // repositions the port around the oval instead.
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const nodeEl = (e.currentTarget as HTMLElement).closest(
        ".react-flow__node",
      ) as HTMLElement | null;
      if (!nodeEl) return;
      const setOverride = usePortLayout.getState().setOverride;
      const move = (ev: PointerEvent) => {
        const r = nodeEl.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const a = r.width / 2 || 1, b = r.height / 2 || 1;
        // Project the cursor onto the ellipse → its parameter angle.
        setOverride(id, portKey, Math.atan2((ev.clientY - cy) / b, (ev.clientX - cx) / a));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // #282: persist the override to the sidecar, keyed by node varName (like
        // node positions) so it survives reload. View-independent, so one save
        // regardless of nested/flat view.
        const { filePath, nodes } = useModelStore.getState();
        if (!filePath) return;
        const idToVar: Record<string, string> = {};
        for (const n of nodes) idToVar[n.id] = (n.data as any)?.varName || n.id;
        const overrides = usePortLayout.getState().overrides;
        const portPositions: Record<string, Record<string, number>> = {};
        for (const [nid, ports] of Object.entries(overrides)) {
          portPositions[idToVar[nid] || nid] = ports;
        }
        void fetch("/api/model/save-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_path: filePath, portPositions }),
        }).catch(() => {});
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [id],
  );
  const portStyle = (arc: EllipseArc, pct: number, portKey: string): React.CSSProperties => {
    const ov = portOverrides?.[portKey];
    return ov != null ? anglePortStyle(ov) : ellipseBoundaryStyle(arc, pct);
  };

  const isCollapsedComposition = d.type === "Composition";

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCollapsedComposition) {
      void toggleCompositionCollapse(d.label || "");
    } else {
      useGraphSettings.getState().toggleExpandedNode(d.label || "");
    }
  }, [d.label, isCollapsedComposition]);

  const onExpandComposition = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleCompositionCollapse(d.label || "");
  }, [d.label]);

  // Check if this node is view-only (not in lineMap, so params can't be edited)
  const lineMap = useModelStore((s) => s.lineMap);
  const isViewOnly = d.varName ? !(d.varName in lineMap) : false;

  const typeColor = TYPE_COLORS[d.type] || "var(--pnv-role-internal)";
  const customRoleColors = useGraphSettings((s) => s.customRoleColors);
  const roleColor = getRoleColor(d.roles || [], customRoleColors);
  const accentColor = colorByRole ? roleColor : typeColor;
  const borderWidth = colorByRole
    ? getRoleBorderWidth(d.roles || [], nodeBorderWidth, nodeBorderWidthEmphasis)
    : nodeBorderWidth;

  // Special node styling based on roles
  const isSpecial = d.isController || d.isObjectiveMechanism;
  const isFeedback = (d.roles || []).includes("FEEDBACK_SENDER");
  const isCycle = (d.roles || []).includes("CYCLE");
  const borderStyle = isSpecial ? "double" : isFeedback ? "dashed" : isCycle ? "double" : "solid";

  // Role label for role-coloring mode
  const roleLabel = colorByRole && d.roles?.length
    ? (d.roles.includes("INPUT") && d.roles.includes("OUTPUT")
        ? "INPUT/OUTPUT"
        : d.roles.find((r) => ROLE_PRIORITY.includes(r)) || d.roles[0])
    : null;

  // Execution trace state
  const executionCounts = useModelStore((s) => s.executionCounts);
  const executionTrace = useModelStore((s) => s.executionTrace);
  const traceStep = useModelStore((s) => s.traceStep);

  // Lifetime total for the run (static; populated once when the run returns).
  const totalExecCount = executionCounts[d.varName] || executionCounts[d.label] || 0;

  // Live count: when the user is stepping (traceStep !== null), count how many
  // times this node has fired up to and including the current step. When no
  // step is active, fall back to the lifetime total — so the badge reads as
  // a final tally before stepping starts (or after Clear), and turns into a
  // live counter the moment the user begins stepping.
  let execCount = totalExecCount;
  if (traceStep !== null) {
    execCount = 0;
    const upto = Math.min(traceStep, executionTrace.length - 1);
    for (let i = 0; i <= upto; i++) {
      const step = executionTrace[i];
      if (step && (step.includes(d.varName) || step.includes(d.label))) {
        execCount++;
      }
    }
  }

  const isActiveStep = traceStep !== null
    && executionTrace[traceStep]
    && (executionTrace[traceStep].includes(d.varName) || executionTrace[traceStep].includes(d.label));

  // #312: while stepping, show the value this node produced at the active
  // step. Joined from debugger snapshots (which carry per-node output) by
  // scheduler step in the store. Undefined when the snapshot lacks a value
  // or the PsyNeuLink build has no `_debugger` hook — render nothing then.
  const traceStepValues = useModelStore((s) => s.traceStepValues);
  const modelLabels = useModelStore((s) => s.modelLabels);
  let activeValue: unknown;
  let activeTrial: number | null = null;
  if (isActiveStep && traceStep !== null) {
    const byNode = traceStepValues.get(traceStep);
    if (byNode) {
      const entry = byNode[d.varName] ?? byNode[d.label];
      if (entry) {
        activeValue = entry.value;
        activeTrial = entry.trial;
      }
    }
  }
  // #361 Layer 3: resolve sidecar labels for the default output port.
  // Looked up by varName first (matches the YAML's top-level keys), then
  // by label as fallback for nodes whose display label differs.
  // #11: pass the node's outputPorts so the resolver can pick up
  // model-intrinsic element_names (Layer 1) before falling through to
  // the sidecar (Layer 3).
  const pillLabels =
    activeValue !== undefined
      ? resolveOutputLabels(modelLabels, d.varName, undefined, d.outputPorts) ??
        resolveOutputLabels(modelLabels, d.label, undefined, d.outputPorts)
      : null;
  const pillLabeledLines =
    activeValue !== undefined ? labeledValueLines(activeValue, pillLabels) : null;

  // #1387: a node shown as a grid (chosen in the Run panel or Run State)
  // draws its value in the pill as a tiny grid, one text line tall so the
  // pill, and the node, keep their size; the hover shows it larger. The
  // shading covers every step's value, so only the cells change as you step.
  const asGrid = useValueViews((s) => valueViewFor(s.views, d.label, d.varName)?.as === "grid");
  const pillScaleFrom = useMemo(() => {
    if (!asGrid) return undefined;
    const all: unknown[] = [];
    for (const byNode of traceStepValues.values()) {
      const e = byNode[d.varName] ?? byNode[d.label];
      if (e) all.push(e.value);
    }
    return poolValues(all);
  }, [asGrid, traceStepValues, d.varName, d.label]);
  const { grid: pillGrid } = useNodeGrid(
    [d.label, d.varName],
    activeValue,
    d.outputPorts?.[0]?.shape,
    pillScaleFrom,
  );
  // One text line is 10px of grid: at most 10 rows, a pixel or more each.
  const pillCell = pillGrid && pillGrid.shape.rows <= PILL_GRID_HEIGHT
    ? Math.max(1, Math.floor(PILL_GRID_HEIGHT / pillGrid.shape.rows))
    : null;

  // Cursor-driven highlight (code editor cursor inside this node's decl block).
  // Distinct from selection — preserves the user's Inspector context while
  // showing the code-to-canvas correspondence.
  const cursorHighlightedNodeId = useModelStore((s) => s.cursorHighlightedNodeId);
  const isCursorHighlighted = !selected && !isActiveStep && cursorHighlightedNodeId === id;

  // #386: this node's execution phase, derived from the scheduler's
  // consideration queue (each step is a set of nodes that fire concurrently).
  // Read-only — it shows the consequence of the conditions, not an edit surface.
  const considerationQueue = useModelStore((s) => s.schedulerConfig.considerationQueue);
  const executionPhase = (() => {
    if (!considerationQueue) return null;
    const idx = considerationQueue.findIndex(
      (step) => step.includes(d.varName) || step.includes(d.label),
    );
    return idx >= 0 ? idx + 1 : null;
  })();

  // #318: one uniform border on all four sides. The previous code forced the
  // top border to min 3px (and a different color), which read as a thicker
  // top/bottom edge on the oval — a user flagged it as a rendering bug.
  const ovalBorderColor = isActiveStep ? "var(--pnv-trace-active)" : selected ? accentColor : (colorByRole ? accentColor : "var(--pnv-node-border)");
  // Heavier than its own outline at any width, so selection always shows (#42).
  const ovalBorderWidth = isActiveStep || selected ? borderWidth + NODE_OUTLINE_SELECTED_EXTRA : borderWidth;
  const ovalBorderStyle = isActiveStep || selected ? "solid" : borderStyle;

  return (
    <div
      onDoubleClick={onDoubleClick}
      style={{
        padding: "10px 24px",
        borderRadius: "50%",
        border: `${ovalBorderWidth}px ${ovalBorderStyle} ${ovalBorderColor}`,
        background: isActiveStep ? "var(--pnv-trace-tint)" : "var(--pnv-surface)",
        boxShadow: isActiveStep
          ? "var(--pnv-trace-glow), var(--pnv-shadow-node-raised)"
          : selected
          ? `0 0 0 2px color-mix(in srgb, ${accentColor} 20%, transparent), var(--pnv-shadow-node-raised)`
          : isCursorHighlighted
          ? "0 0 0 2px var(--pnv-cursor-highlight), var(--pnv-cursor-glow)"
          : "var(--pnv-shadow-node)",
        // #122: the size of the slot the layout reserves, so a node showing
        // just its name keeps the size and edge geometry it had with details.
        minWidth: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        textAlign: "center" as const,
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        justifyContent: "center",
        transition: "box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease",
        position: "relative",
      }}
    >
      {/* Port hover tooltip — name, role, shape */}
      {hoveredPort && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--pnv-tooltip-bg)",
            color: "var(--pnv-on-primary)",
            padding: "5px 9px",
            borderRadius: 4,
            fontSize: 11,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 1000,
            boxShadow: "var(--pnv-shadow-tooltip)",
          }}
        >
          <span style={{ color: PORT_COLORS[hoveredPort.role], fontWeight: 700, marginRight: 6 }}>
            {hoveredPort.role.toUpperCase()}
          </span>
          {hoveredPort.name}
          {hoveredPort.shape.length > 0 && (
            <span style={{ color: "var(--pnv-tooltip-text-muted)", marginLeft: 6 }}>
              [{hoveredPort.shape.join(",")}]
            </span>
          )}
        </div>
      )}

      {/* Execution count badge.
          While stepping (traceStep !== null), shows "N/total" so the user sees
          both the running tally and the eventual lifetime count at a glance.
          Stationary, shows just the lifetime total. Visible whenever the node
          will fire at all in this run — so during stepping, nodes that haven't
          yet executed read "0/total" as a lookahead hint. */}
      {totalExecCount > 0 && (
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            background: isActiveStep ? "var(--pnv-trace-active)" : "var(--pnv-count-badge)",
            color: "var(--pnv-on-primary)",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "monospace",
            padding: "1px 5px",
            borderRadius: 10,
            minWidth: 18,
            textAlign: "center",
            lineHeight: "16px",
            border: "2px solid var(--pnv-surface)",
            boxShadow: "var(--pnv-shadow-badge)",
          }}
          title={
            traceStep !== null
              ? `Fired ${execCount} of ${totalExecCount} time${totalExecCount > 1 ? "s" : ""} so far`
              : `Executed ${totalExecCount} time${totalExecCount > 1 ? "s" : ""}`
          }
        >
          {traceStep !== null ? `${execCount}/${totalExecCount}` : execCount}
        </div>
      )}

      {/* Execution-order badge (#386). Top-left so it never collides with the
          execution-count badge at top-right. Slate tone keeps it visually
          distinct from the green active-step / count badges and from the
          color-coded GSC edge badges. */}
      {showExecutionOrder && executionPhase !== null && (
        <div
          data-testid="node-order-badge"
          style={{
            position: "absolute",
            top: -8,
            left: -8,
            background: "var(--pnv-order-badge)",
            color: "var(--pnv-on-primary)",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "monospace",
            padding: "1px 5px",
            borderRadius: 10,
            minWidth: 18,
            textAlign: "center",
            lineHeight: "16px",
            border: "2px solid var(--pnv-surface)",
            boxShadow: "var(--pnv-shadow-badge)",
          }}
          title={`Execution phase ${executionPhase} — nodes sharing a phase run concurrently`}
        >
          {executionPhase}
        </div>
      )}

      {/* Type + Role badges. With Elements off (the default, #122) and no
          other tag, the row is left out so the name sits centred in the oval,
          as show_graph() draws it. */}
      {(showNodeElements || isViewOnly || isCollapsedComposition) && (
      <div data-testid="node-tags" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
        {showNodeElements && (
          <span
            data-testid="node-type-tag"
            style={{
              fontSize: 10,
              color: accentColor,
              fontWeight: 600,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
            }}
          >
            {showFullTypes ? d.type : d.type.replace("Mechanism", "")}
          </span>
        )}
        {showNodeElements && roleLabel && (
          <span
            data-testid="node-role-tag"
            style={{
              fontSize: 9,
              color: "var(--pnv-on-primary)",
              background: accentColor,
              padding: "0px 5px",
              borderRadius: 3,
              fontWeight: 600,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
            }}
          >
            {roleLabel}
          </span>
        )}
        {isViewOnly && (
          <span
            style={{
              fontSize: 8,
              color: "var(--pnv-text-faint)",
              background: "var(--pnv-node-tag-bg)",
              padding: "0px 4px",
              borderRadius: 2,
              border: "1px solid var(--pnv-border-light)",
            }}
            title="This node's source pattern isn't editable from the GUI"
          >
            view only
          </span>
        )}
        {isCollapsedComposition && (
          <button
            onClick={onExpandComposition}
            title="Expand this composition to show its contents"
            aria-label={`Expand composition ${d.label}`}
            style={{
              marginLeft: 2,
              cursor: "pointer",
              fontSize: 10,
              lineHeight: 1,
              padding: "1px 5px",
              border: "1px solid var(--pnv-composition-control-border)",
              borderRadius: 3,
              background: "var(--pnv-surface)",
              color: "var(--pnv-composition-control-text)",
              fontWeight: 600,
            }}
          >
            +
          </button>
        )}
      </div>
      )}
      {showNodeNames && (
        <div data-testid="node-name" style={{ fontSize: 14, fontWeight: 600, color: "var(--pnv-text)" }}>
          {d.label}
        </div>
      )}
      {showNodeElements && d.function && (
        <div
          data-testid="node-function-line"
          style={{
            fontSize: 10,
            color: "var(--pnv-text-hint)",
            marginTop: 3,
            background: "var(--pnv-surface-sunken)",
            padding: "1px 6px",
            borderRadius: 3,
            display: "inline-block",
          }}
        >
          f: {d.function.type}
        </div>
      )}

      {/* #312: active-step value. Shown only on the node firing at the
          current trace step, styled to match the green active highlight so
          the eye lands on it. Hover reveals a richer tooltip (#336) with
          the output-port name + shape, the snapshot category, trial number,
          and the full-precision value — labels the pill so a reader knows
          what the bare array means. */}
      {activeValue !== undefined && (
        <div style={{ position: "relative", marginTop: 4 }}>
          <div
            data-testid={`value-pill-${d.label}`}
            onMouseEnter={() => setPillHovered(true)}
            onMouseLeave={() => setPillHovered(false)}
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: "var(--pnv-trace-value)",
              background: "var(--pnv-trace-pill)",
              border: "1px solid var(--pnv-trace-border)",
              borderRadius: 3,
              padding: "1px 6px",
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: "help",
            }}
          >
            {/* When sidecar element_names exist (#361 Layer 3) render as
                `{red_word:0.27, green_word:0.00}` instead of a bare array.
                Falls back to the raw rendering if labels don't match the
                value's length. */}
            {pillGrid && pillCell ? (
              <>
                {/* A zero-width space holds the text line, so the pill is
                    exactly as tall as with numbers in it. */}
                {"\u200b"}
                <ValueGrid
                  grid={pillGrid}
                  cell={pillCell}
                  gap={0}
                  inLine
                  node={d.label}
                  testId={`value-pill-grid-${d.label}`}
                />
                {/* The numbers, unseen and no height: the pill is as wide as
                    with numbers in it, so the node keeps its width when the
                    tags don't set it (#122). */}
                <span
                  aria-hidden
                  style={{ display: "block", height: 0, overflow: "hidden", visibility: "hidden" }}
                >
                  {formatLabeledValue(activeValue, pillLabels, { maxLen: 40 })}
                </span>
              </>
            ) : (
              formatLabeledValue(activeValue, pillLabels, { maxLen: 40 })
            )}
          </div>
          {pillHovered && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: "50%",
                transform: "translateX(-50%)",
                background: "var(--pnv-tooltip-bg)",
                color: "var(--pnv-on-primary)",
                padding: "6px 10px",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 1000,
                boxShadow: "var(--pnv-shadow-tooltip)",
                lineHeight: 1.5,
              }}
            >
              <div>
                <span style={{ color: "var(--pnv-tooltip-accent)", fontWeight: 700 }}>NODE_EXECUTION</span>
                {activeTrial !== null && (
                  <span style={{ color: "var(--pnv-tooltip-text-muted)" }}> · trial {activeTrial + 1}</span>
                )}
              </div>
              <div style={{ color: "var(--pnv-tooltip-text-muted)" }}>
                {(d.outputPorts || []).length > 0
                  ? `${d.outputPorts![0].name || "OutputPort-0"} · shape (${(d.outputPorts![0].shape || []).join(",") || "scalar"})`
                  : "OutputPort-0"}
              </div>
              {/* If labels exist + match the value shape, show one row per
                  element so the reader can read off `red_word: 0.2689`
                  directly. Otherwise fall back to the full array. */}
              {pillGrid ? (
                <div style={{ marginTop: 4 }}>
                  <ValueGrid grid={pillGrid} cell={8} node={d.label} />
                </div>
              ) : pillLabeledLines ? (
                pillLabeledLines.map((line, i) => <div key={i}>{line}</div>)
              ) : (
                <div>{formatTraceValue(activeValue, 1000)}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dimension annotations */}
      {showDimensions && (
        <div style={{ marginTop: 4, fontSize: 9, color: "var(--pnv-text-faint)", fontFamily: "monospace" }}>
          {(d.inputPorts || []).length > 0 && (
            <div>in: {(d.inputPorts || []).map((p) => `[${p.shape.join(",")}]`).join(" ")}</div>
          )}
          {(d.outputPorts || []).length > 0 && (
            <div>out: {(d.outputPorts || []).map((p) => `[${p.shape.join(",")}]`).join(" ")}</div>
          )}
        </div>
      )}

      {/* Expanded node structure (double-click to toggle) */}
      {expanded && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid var(--pnv-node-divider)",
            fontSize: 10,
            color: "var(--pnv-text-secondary)",
          }}
        >
          {/* Input Ports */}
          {(d.inputPorts || []).length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 600, color: "var(--pnv-text-hint)", marginBottom: 2 }}>Input Ports</div>
              {(d.inputPorts || []).map((p) => (
                <div key={p.name} style={{ paddingLeft: 6, fontFamily: "monospace", fontSize: 9 }}>
                  {p.name} <span style={{ color: "var(--pnv-node-text-dim)" }}>[{p.shape.join(",")}]</span>
                </div>
              ))}
            </div>
          )}
          {/* Output Ports */}
          {(d.outputPorts || []).length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 600, color: "var(--pnv-text-hint)", marginBottom: 2 }}>Output Ports</div>
              {(d.outputPorts || []).map((p) => (
                <div key={p.name} style={{ paddingLeft: 6, fontFamily: "monospace", fontSize: 9 }}>
                  {p.name} <span style={{ color: "var(--pnv-node-text-dim)" }}>[{p.shape.join(",")}]</span>
                </div>
              ))}
            </div>
          )}
          {/* Function */}
          {d.function && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 600, color: "var(--pnv-text-hint)", marginBottom: 2 }}>Function</div>
              <div style={{ paddingLeft: 6, fontFamily: "monospace", fontSize: 9 }}>
                {d.function.type}
                {Object.entries(d.function.params || {}).map(([k, v]) => {
                  const meta = v as any;
                  if (meta?.isDefault) return null;
                  return (
                    <div key={k} style={{ paddingLeft: 8, color: "var(--pnv-node-text-detail)" }}>
                      {k}: {JSON.stringify(meta?.value ?? v)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Roles */}
          {(d.roles || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, color: "var(--pnv-text-hint)", marginBottom: 2 }}>Roles</div>
              <div style={{ paddingLeft: 6, fontFamily: "monospace", fontSize: 9 }}>
                {(d.roles || []).join(", ")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input port handles */}
      {(() => {
        const { input: inputPos, output: outputPos } = getHandlePositions(direction);
        const arcs = arcsForDirection(direction);
        const arcToPosition: Record<EllipseArc, Position> = {
          top: Position.Top,
          bottom: Position.Bottom,
          left: Position.Left,
          right: Position.Right,
        };
        const paramPos = arcToPosition[arcs.parameter];
        const isHorizontal = direction === "LR" || direction === "RL";
        // Port label positioning relative to handle
        const inputLabelStyle: React.CSSProperties = isHorizontal
          ? { position: "absolute", right: "100%", marginRight: 4, whiteSpace: "nowrap" }
          : { position: "absolute", bottom: "100%", marginBottom: 2, whiteSpace: "nowrap", left: "50%", transform: "translateX(-50%)" };
        const outputLabelStyle: React.CSSProperties = isHorizontal
          ? { position: "absolute", left: "100%", marginLeft: 4, whiteSpace: "nowrap" }
          : { position: "absolute", top: "100%", marginTop: 2, whiteSpace: "nowrap", left: "50%", transform: "translateX(-50%)" };
        return (
          <>
            {(d.inputPorts || []).map((port, i) => {
              const count = (d.inputPorts || []).length;
              const pct = getPortOffsetPct(i, count);
              return (
                <Handle
                  key={`in-${port.name}`}
                  type="target"
                  position={inputPos}
                  id={port.name}
                  title="Alt-drag to move this port around the node"
                  onPointerDownCapture={startPortDrag(port.name)}
                  onMouseEnter={() => setHoveredPort({ name: port.name, role: "input", shape: port.shape })}
                  onMouseLeave={() => setHoveredPort(null)}
                  style={{
                    ...portStyle(arcs.input, pct, port.name),
                    background: PORT_COLORS.input,
                    width: 8,
                    height: 8,
                    border: "2px solid var(--pnv-surface)",
                    visibility: showConnDots ? "visible" : "hidden",
                    cursor: "help",
                  }}
                >
                  {showPortDots && expanded && count > 1 && (
                    <span style={{ ...inputLabelStyle, fontSize: 7, color: "var(--pnv-text-hint)", fontFamily: "monospace", pointerEvents: "none" }}>
                      {port.name}
                    </span>
                  )}
                </Handle>
              );
            })}
            {/* Output port handles */}
            {(d.outputPorts || []).map((port, i) => {
              const count = (d.outputPorts || []).length;
              const pct = getPortOffsetPct(i, count);
              return (
                <Handle
                  key={`out-${port.name}`}
                  type="source"
                  position={outputPos}
                  id={port.name}
                  title="Alt-drag to move this port around the node"
                  onPointerDownCapture={startPortDrag(port.name)}
                  onMouseEnter={() => setHoveredPort({ name: port.name, role: "output", shape: port.shape })}
                  onMouseLeave={() => setHoveredPort(null)}
                  style={{
                    ...portStyle(arcs.output, pct, port.name),
                    background: PORT_COLORS.output,
                    width: 8,
                    height: 8,
                    border: "2px solid var(--pnv-surface)",
                    visibility: showConnDots ? "visible" : "hidden",
                    cursor: "help",
                  }}
                >
                  {showPortDots && expanded && count > 1 && (
                    <span style={{ ...outputLabelStyle, fontSize: 7, color: "var(--pnv-text-hint)", fontFamily: "monospace", pointerEvents: "none" }}>
                      {port.name}
                    </span>
                  )}
                </Handle>
              );
            })}
            {/* Parameter port handles — connectable targets so modulatory
                projections (ControlProjection / LearningProjection to a
                parameter, e.g. LC→gain) can attach (#616). Rendered as orange
                diamonds on the perpendicular arc so they don't collide with the
                in/out handles. Always present (visibility toggled) so edges
                resolve even when port dots are hidden, matching the in/out
                handles. */}
            {(d.parameterPorts || []).map((port, i) => {
              const count = (d.parameterPorts || []).length;
              const pct = getPortOffsetPct(i, count);
              const base = portStyle(arcs.parameter, pct, port.name);
              return (
                <Handle
                  key={`param-${port.name}`}
                  type="target"
                  position={paramPos}
                  id={port.name}
                  title="Alt-drag to move this port around the node"
                  onPointerDownCapture={startPortDrag(port.name)}
                  onMouseEnter={() => setHoveredPort({ name: port.name, role: "parameter", shape: port.shape })}
                  onMouseLeave={() => setHoveredPort(null)}
                  style={{
                    ...base,
                    width: 8,
                    height: 8,
                    background: PORT_COLORS.parameter,
                    border: "2px solid var(--pnv-surface)",
                    boxSizing: "content-box",
                    borderRadius: 0,
                    transform: `${base.transform ?? ""} rotate(45deg)`.trim(),
                    transformOrigin: "center center",
                    visibility: showPortDots ? "visible" : "hidden",
                    cursor: "help",
                  }}
                />
              );
            })}
          </>
        );
      })()}
    </div>
  );
});
