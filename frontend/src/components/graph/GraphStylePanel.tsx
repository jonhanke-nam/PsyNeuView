/**
 * Graph Style Panel — customize role colors, edge colors, and border widths.
 * Matches show_graph's show_graph_attributes customization.
 */

import { useState } from "react";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { ROLE_TOKENS } from "@/constants/pnlTypes";
import { paletteHex } from "@/utils/paletteColor";

/** The roles a colour can be chosen for here, in this order. */
const STYLED_ROLES = ["INPUT", "OUTPUT", "SINGLETON", "PROBE", "CONTROL", "CONTROLLER", "LEARNING", "INTERNAL"];

/** The projection types a colour can be chosen for, and the token each starts from. */
const STYLED_EDGES: Record<string, `--pnv-${string}`> = {
  MappingProjection: "--pnv-projection-mapping",
  ControlProjection: "--pnv-projection-control",
  LearningProjection: "--pnv-projection-learning",
};

/**
 * The colour pickers start from the palette (#1302): a colour input takes
 * only a six-digit hex, so each role's and projection's token is read back
 * as one. Built when the panel needs it, once the stylesheet has loaded.
 */
function defaultRoleColors(): Record<string, string> {
  return Object.fromEntries(STYLED_ROLES.map((role) => [role, paletteHex(ROLE_TOKENS[role]) ?? ""]));
}

function defaultEdgeColors(): Record<string, string> {
  return Object.fromEntries(Object.entries(STYLED_EDGES).map(([type, token]) => [type, paletteHex(token) ?? ""]));
}

export function GraphStylePanel() {
  const [roleColors, setRoleColors] = useState<Record<string, string>>(
    () => useGraphSettings.getState().customRoleColors || defaultRoleColors()
  );
  const [edgeColors, setEdgeColors] = useState<Record<string, string>>(
    () => useGraphSettings.getState().customEdgeColors || defaultEdgeColors()
  );

  // Arrow appearance (#319) — applied live, no Apply button.
  const arrowLineThickness = useGraphSettings((s) => s.arrowLineThickness);
  const arrowheadSize = useGraphSettings((s) => s.arrowheadSize);
  const arrowheadPosition = useGraphSettings((s) => s.arrowheadPosition);
  // #912: node oval border width (emphasis roles — the visible one).
  const nodeBorderWidthEmphasis = useGraphSettings((s) => s.nodeBorderWidthEmphasis);
  // #955/#956: edge spacing knobs, applied live.
  const edgeLaneGap = useGraphSettings((s) => s.edgeLaneGap);
  const edgeNodeClearance = useGraphSettings((s) => s.edgeNodeClearance);

  const apply = () => {
    useGraphSettings.getState().setCustomRoleColors({ ...roleColors });
    useGraphSettings.getState().setCustomEdgeColors({ ...edgeColors });
  };

  const reset = () => {
    setRoleColors(defaultRoleColors());
    setEdgeColors(defaultEdgeColors());
    useGraphSettings.getState().setCustomRoleColors(null);
    useGraphSettings.getState().setCustomEdgeColors(null);
  };

  return (
    <div style={{ padding: "12px 16px", fontSize: 12, overflow: "auto", height: "100%" }}>
      <div style={{ fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 8, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 4 }}>
        Node Role Colors
      </div>
      {Object.entries(roleColors).map(([role, color]) => (
        <div key={role} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <input
            type="color"
            value={color}
            onChange={(e) => setRoleColors((prev) => ({ ...prev, [role]: e.target.value }))}
            style={{ width: 24, height: 20, border: "1px solid var(--pnv-border-light)", borderRadius: 3, cursor: "pointer" }}
          />
          <span style={{ fontFamily: "monospace", fontSize: 11, minWidth: 100 }}>{role}</span>
        </div>
      ))}

      <div style={{ fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 8, marginTop: 12, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 4 }}>
        Edge Colors
      </div>
      {Object.entries(edgeColors).map(([type, color]) => (
        <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <input
            type="color"
            value={color}
            onChange={(e) => setEdgeColors((prev) => ({ ...prev, [type]: e.target.value }))}
            style={{ width: 24, height: 20, border: "1px solid var(--pnv-border-light)", borderRadius: 3, cursor: "pointer" }}
          />
          <span style={{ fontFamily: "monospace", fontSize: 11, minWidth: 140 }}>{type.replace("Projection", "")}</span>
        </div>
      ))}

      <div style={{ fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 8, marginTop: 12, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 4 }}>
        Arrows
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ minWidth: 110 }}>Line thickness</span>
        <input
          type="range"
          min={1}
          max={6}
          step={0.5}
          value={arrowLineThickness}
          onChange={(e) => useGraphSettings.getState().setArrowLineThickness(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontFamily: "monospace", minWidth: 28, textAlign: "right" }}>{arrowLineThickness}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ minWidth: 110 }}>Arrowhead size</span>
        <input
          type="range"
          min={3}
          max={12}
          step={1}
          value={arrowheadSize}
          onChange={(e) => useGraphSettings.getState().setArrowheadSize(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontFamily: "monospace", minWidth: 28, textAlign: "right" }}>{arrowheadSize}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ minWidth: 110 }}>Arrowhead placement</span>
        <select
          value={arrowheadPosition}
          onChange={(e) => useGraphSettings.getState().setArrowheadPosition(Number(e.target.value))}
          style={{ flex: 1, fontSize: 12, padding: "2px 4px", border: "1px solid var(--pnv-border-light)", borderRadius: 3 }}
        >
          <option value={0.15}>Near source</option>
          <option value={0.5}>Middle</option>
          <option value={0.85}>Near target</option>
        </select>
      </div>

      <div style={{ fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 8, marginTop: 12, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 4 }}>
        Edge Spacing
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ minWidth: 110 }}>Edge ↔ edge gap</span>
        <input
          type="range"
          min={4}
          max={40}
          step={2}
          value={edgeLaneGap}
          onChange={(e) => useGraphSettings.getState().setEdgeLaneGap(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontFamily: "monospace", minWidth: 28, textAlign: "right" }}>{edgeLaneGap}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ minWidth: 110 }}>Edge ↔ node clearance</span>
        <input
          type="range"
          min={4}
          max={48}
          step={2}
          value={edgeNodeClearance}
          onChange={(e) => useGraphSettings.getState().setEdgeNodeClearance(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontFamily: "monospace", minWidth: 28, textAlign: "right" }}>{edgeNodeClearance}</span>
      </div>

      <div style={{ fontWeight: 600, color: "var(--pnv-text-body)", marginBottom: 8, marginTop: 12, borderBottom: "1px solid var(--pnv-border-faint)", paddingBottom: 4 }}>
        Nodes
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ minWidth: 110 }}>Border width</span>
        <input
          type="range"
          min={1}
          max={6}
          step={0.5}
          value={nodeBorderWidthEmphasis}
          onChange={(e) => useGraphSettings.getState().setNodeBorderWidthEmphasis(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontFamily: "monospace", minWidth: 28, textAlign: "right" }}>{nodeBorderWidthEmphasis}</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {/* Not Button kinds: 12px text on 4×14 padding, a size no kind has. */}
        <button onClick={apply} style={btnStyle}>Apply</button>
        <button onClick={reset} style={{ ...btnStyle, background: "var(--pnv-surface-sunken)", color: "var(--pnv-text-secondary)" }}>Reset</button>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 14px",
  fontSize: 12,
  border: "1px solid var(--pnv-border-light)",
  borderRadius: 4,
  background: "var(--pnv-primary-tint)",
  color: "var(--pnv-primary)",
  cursor: "pointer",
  fontWeight: 500,
};
