/**
 * Phantom placeholder node for the missing endpoint of a dangling projection.
 * Rendered with a red dashed border and a ? icon so the user can see at a
 * glance that something they referenced doesn't exist.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

/** A missing node is an error: the danger red, and its tint behind. */
const COLOR = "var(--pnv-danger)";

export const DanglingNode = memo(function DanglingNode({ data, selected }: NodeProps) {
  const d = data as { missingName?: string; side?: "sender" | "receiver" | "both" };
  return (
    <div
      title={`Missing mechanism: ${d.missingName ?? "?"}\n(referenced as ${d.side ?? "endpoint"} by a projection)`}
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        border: `2px dashed ${COLOR}`,
        background: "var(--pnv-danger-tint)",
        color: COLOR,
        fontSize: 12,
        fontFamily: "monospace",
        fontWeight: 600,
        minWidth: 96,
        textAlign: "center",
        boxShadow: selected ? `0 0 0 2px color-mix(in srgb, ${COLOR} 33.333%, transparent)` : "var(--pnv-shadow-dangling)",
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 2 }}>⚠ missing</div>
      <div style={{ fontWeight: 500 }}>{d.missingName ?? "?"}</div>
      <Handle type="target" position={Position.Top} style={{ background: COLOR, width: 6, height: 6 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: COLOR, width: 6, height: 6 }} />
    </div>
  );
});
