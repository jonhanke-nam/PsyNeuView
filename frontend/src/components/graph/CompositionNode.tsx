/**
 * Custom React Flow node for nested PsyNeuLink Compositions.
 * Renders as a labeled group container with input/output handles
 * so cross-composition edges can connect to it.
 */

import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { toggleCompositionCollapse, focusComposition, toggleCompositionInset } from "@/utils/nodeActions";
import { useGraphSettings } from "@/stores/graphSettingsStore";

interface CompositionPort {
  name: string;
  shape?: number[];
}

interface CompositionData {
  label: string;
  varName: string;
  childCount: number;
  inset?: boolean;
  inputPorts?: CompositionPort[];
  outputPorts?: CompositionPort[];
}

// The frame's three buttons (#194). The size of the canvas's zoom and Fit
// controls (26 px), so they are as easy to see and press as those; they were
// 22 x 16 px before, too small to find on a big model and to hit at low zoom.
const controlStyle: React.CSSProperties = {
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
  minWidth: 28,
  height: 26,
  padding: "0 6px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--pnv-composition-control-border)",
  borderRadius: 4,
  background: "var(--pnv-surface)",
  color: "var(--pnv-composition-control-text)",
  fontWeight: 600,
};

// Distribute N handles evenly along an edge, leaving margins at the corners.
function portOffsetPct(i: number, count: number): string {
  if (count <= 1) return "50%";
  return `${20 + (i * 60) / (count - 1)}%`;
}

export const CompositionNode = memo(function CompositionNode({
  data,
  selected,
}: NodeProps) {
  const d = data as unknown as CompositionData;
  const showNodeNames = useGraphSettings((s) => s.showNodeNames);
  const showNodeElements = useGraphSettings((s) => s.showNodeElements);
  // The flattened and PyTorch views: every composition is a frame of its own
  // there, which changes what two of the buttons can do (#194).
  const flattened = useGraphSettings((s) => s.flat || s.pytorch);

  const onCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleCompositionCollapse(d.label);
  }, [d.label]);

  const onFocus = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void focusComposition(d.label);
  }, [d.label]);

  const onInset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleCompositionInset(d.label);
  }, [d.label]);

  // INSET frames use a solid border + brighter fill to read as a
  // self-contained framed sub-graph; NESTED stays dashed/translucent (#427).
  const borderColor = selected ? "var(--pnv-primary)" : d.inset ? "var(--pnv-composition-inset)" : "var(--pnv-composition-border)";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 12,
        border: `2px ${d.inset ? "solid" : "dashed"} ${borderColor}`,
        background: d.inset ? "var(--pnv-composition-inset-tint)" : "var(--pnv-composition-tint)",
        boxShadow: d.inset ? "var(--pnv-shadow-frame)" : "none",
        position: "relative",
      }}
    >
      {/* Per-CIM-port handles. Edges from the parent graph attach to the
          composition's input_CIM / output_CIM ports by id, so each needs a
          matching Handle or React Flow drops the edge (#644). Fall back to a
          single generic handle per side when no CIM ports are known. */}
      {(d.inputPorts && d.inputPorts.length > 0) ? (
        d.inputPorts.map((port, i) => (
          <Handle
            key={`in-${port.name}`}
            type="target"
            id={port.name}
            position={Position.Left}
            title={port.name}
            style={{
              top: portOffsetPct(i, d.inputPorts!.length),
              background: "var(--pnv-composition)",
              width: 10,
              height: 10,
              border: "2px solid var(--pnv-surface)",
            }}
          />
        ))
      ) : (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: "var(--pnv-composition)", width: 10, height: 10, border: "2px solid var(--pnv-surface)" }}
        />
      )}

      {(d.outputPorts && d.outputPorts.length > 0) ? (
        d.outputPorts.map((port, i) => (
          <Handle
            key={`out-${port.name}`}
            type="source"
            id={port.name}
            position={Position.Right}
            title={port.name}
            style={{
              top: portOffsetPct(i, d.outputPorts!.length),
              background: "var(--pnv-composition)",
              width: 10,
              height: 10,
              border: "2px solid var(--pnv-surface)",
            }}
          />
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: "var(--pnv-composition)", width: 10, height: 10, border: "2px solid var(--pnv-surface)" }}
        />
      )}

      {/* Header: label at top-left, the frame's buttons at top-right (#122:
          with the COMPOSITION tag off by default they no longer sit right
          after a short name, where an edge leaving the frame often runs). */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          right: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {showNodeElements && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--pnv-on-primary)",
              background: "var(--pnv-composition)",
              padding: "1px 8px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Composition
          </span>
        )}
        {showNodeNames && (
          <span
            title={d.label}
            style={{ fontSize: 13, fontWeight: 600, color: "var(--pnv-node-text-strong)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {d.label}
          </span>
        )}
        {d.childCount > 0 && (
          <span style={{ fontSize: 10, color: "var(--pnv-text-faint)", whiteSpace: "nowrap", flexShrink: 0 }}>
            ({d.childCount} nodes)
          </span>
        )}
        <button
          onClick={onFocus}
          title="Enter this composition: show only what is inside it (the breadcrumb leads back out)"
          aria-label={`Enter composition ${d.label}`}
          style={{ ...controlStyle, marginLeft: "auto" }}
        >
          ⤵
        </button>
        {/* The flattened and PyTorch views draw every composition as an inset
            frame already, so the toggle has nothing to do there (#194). */}
        {!flattened && (
          <button
            onClick={onInset}
            title={d.inset
              ? "Shown as an inset: a framed sub-graph laid out on its own. Press to show it nested again"
              : "Show as an inset: a framed sub-graph laid out on its own"}
            aria-label={`Inset composition ${d.label}`}
            aria-pressed={!!d.inset}
            style={{
              ...controlStyle,
              marginLeft: 4,
              border: `1px solid ${d.inset ? "var(--pnv-composition-inset)" : "var(--pnv-composition-control-border)"}`,
              background: d.inset ? "var(--pnv-composition-inset)" : "var(--pnv-surface)",
              color: d.inset ? "var(--pnv-on-primary)" : "var(--pnv-composition-control-text)",
            }}
          >
            ▣
          </button>
        )}
        <button
          onClick={onCollapse}
          title={flattened
            ? "Collapse this composition to a single node (shows the model nested, not flattened)"
            : "Collapse this composition to a single node"}
          aria-label={`Collapse composition ${d.label}`}
          style={{ ...controlStyle, marginLeft: 4 }}
        >
          −
        </button>
      </div>
    </div>
  );
});
