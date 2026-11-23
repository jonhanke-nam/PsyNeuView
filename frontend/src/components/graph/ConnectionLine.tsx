/**
 * The arrow being drawn while a connection is dragged (#253): the weight and
 * arrowhead of a real projection, in the drop-target teal, dashed, so it's
 * plain a drag is in progress (React Flow's own line is a faint hairline).
 */
import type { ConnectionLineComponentProps } from "@xyflow/react";
import { edgeArrowheadScale, useEdgeLineWidth } from "@/stores/edgeLineStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";

export function ConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  const lineWidth = useEdgeLineWidth();
  const arrowheadSize = useGraphSettings((s) => s.arrowheadSize);
  const head = arrowheadSize * edgeArrowheadScale(lineWidth);
  const dx = toX - fromX, dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // The line stops at the arrowhead's base, so its end doesn't poke through.
  const back = len > 2 * head ? (len - 2 * head) / len : 0;
  return (
    <g data-testid="connect-rubber-band" style={{ pointerEvents: "none" }}>
      <path
        d={`M ${fromX},${fromY} L ${fromX + dx * back},${fromY + dy * back}`}
        fill="none"
        stroke="var(--pnv-connect-target)"
        strokeWidth={lineWidth}
        strokeDasharray={`${3 * lineWidth} ${2 * lineWidth}`}
        strokeLinecap="round"
      />
      {len > 0 && (
        <polygon
          points={`0,0 ${-2 * head},${-head * 0.6} ${-2 * head},${head * 0.6}`}
          fill="var(--pnv-connect-target)"
          transform={`translate(${toX} ${toY}) rotate(${angle})`}
        />
      )}
    </g>
  );
}
