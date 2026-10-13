/**
 * Custom React Flow node for CompositionInterfaceMechanisms (CIMs).
 * Small colored rectangles that show how projections route through
 * composition boundaries. Renders per-port handles matching MechanismNode.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useGraphSettings, type GraphDirection } from "@/stores/graphSettingsStore";

/** Map graph direction to handle positions for inputs (target) and outputs (source). */
function getHandlePositions(dir: GraphDirection): { input: Position; output: Position } {
  switch (dir) {
    case "BT": return { input: Position.Bottom, output: Position.Top };
    case "LR": return { input: Position.Left, output: Position.Right };
    case "RL": return { input: Position.Right, output: Position.Left };
    default:   return { input: Position.Top, output: Position.Bottom };
  }
}

const CIM_COLORS: Record<string, string> = {
  INPUT_CIM: "var(--pnv-role-input)",       // green (the INPUT role's)
  OUTPUT_CIM: "var(--pnv-role-output)",     // red (the OUTPUT role's)
  PARAMETER_CIM: "var(--pnv-role-control)", // blue (the CONTROL role's)
};

interface PortInfo {
  name: string;
  shape?: number[];
}

export const CIMNode = memo(function CIMNode({ data, selected }: NodeProps) {
  const d = data as any;
  const cimType: string = d.cimType || "INPUT_CIM";
  const color = CIM_COLORS[cimType] || "var(--pnv-text-hint)";
  const direction = useGraphSettings((s) => s.direction);
  const { input: inputPos, output: outputPos } = getHandlePositions(direction);
  const isHorizontal = direction === "LR" || direction === "RL";
  const offsetProp = isHorizontal ? "top" : "left";

  const inputPorts: PortInfo[] = d.inputPorts || [];
  const outputPorts: PortInfo[] = d.outputPorts || [];

  return (
    <div
      style={{
        padding: "6px 14px",
        borderRadius: 4,
        border: `2px solid ${color}`,
        // The role colour at 0x15/0xff opacity: a faint wash of it.
        background: `color-mix(in srgb, ${color} 8.2353%, transparent)`,
        fontSize: 11,
        fontFamily: "monospace",
        color,
        fontWeight: 600,
        textAlign: "center",
        minWidth: 90,
        letterSpacing: "0.03em",
        boxShadow: selected ? `0 0 0 2px color-mix(in srgb, ${color} 20%, transparent)` : "var(--pnv-shadow-cim)",
      }}
    >
      {d.label}

      {/* Per-port input handles */}
      {inputPorts.length > 0 ? (
        inputPorts.map((port, i) => {
          const count = inputPorts.length;
          const offset = count > 1 ? 20 + (i * 60) / (count - 1) + "%" : "50%";
          return (
            <Handle
              key={`in-${port.name}`}
              type="target"
              position={inputPos}
              id={port.name}
              style={{
                [offsetProp]: offset,
                background: color,
                width: 6,
                height: 6,
                border: "1.5px solid var(--pnv-surface)",
              }}
              title={port.name}
            />
          );
        })
      ) : (
        <Handle
          type="target"
          position={inputPos}
          style={{ background: color, width: 6, height: 6, border: "1.5px solid var(--pnv-surface)" }}
        />
      )}

      {/* Per-port output handles */}
      {outputPorts.length > 0 ? (
        outputPorts.map((port, i) => {
          const count = outputPorts.length;
          const offset = count > 1 ? 20 + (i * 60) / (count - 1) + "%" : "50%";
          return (
            <Handle
              key={`out-${port.name}`}
              type="source"
              position={outputPos}
              id={port.name}
              style={{
                [offsetProp]: offset,
                background: color,
                width: 6,
                height: 6,
                border: "1.5px solid var(--pnv-surface)",
              }}
              title={port.name}
            />
          );
        })
      ) : (
        <Handle
          type="source"
          position={outputPos}
          style={{ background: color, width: 6, height: 6, border: "1.5px solid var(--pnv-surface)" }}
        />
      )}
    </div>
  );
});
