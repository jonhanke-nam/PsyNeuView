/**
 * Settings ▸ Appearance: how the app looks and feels. (#1301)
 *
 * The first two settings are the pointer in the graph view — the arrow, the
 * crosshair or circle (#40), or
 * React Flow's hand — and the arrow's size. Both are remembered per browser
 * (stores/graphPointerStore.ts). A preview shows the arrow at the chosen
 * size, since the real pointer is only seen over the canvas; hovering the
 * preview shows the real thing too. Look-and-feel settings belong here
 * (docs/settings-etiquette.md §1). The graph legend's opening state (#7)
 * is here too: collapsed by default. So is the automatic layout the graph
 * view opens with (#19): Like show_graph by default (#24), or Layered.
 * And how heavy node outlines are (#42): one width, remembered per browser
 * (stores/nodeOutlineStore.ts), that the heavier outlines follow. And
 * whether scheduling-condition arrows are drawn (#53): shown by default.
 */

import { LEGEND_STARTS, isLegendStart, useGraphLegendStore } from "@/stores/graphLegendStore";
import { SCHEDULING_ARROWS, isSchedulingArrows, useSchedulingArrowsStore } from "@/stores/schedulingArrowsStore";
import {
  DEFAULT_LAYOUT_STYLE,
  LAYOUT_STYLES,
  isLayoutStyle,
  useGraphLayoutDefaultStore,
} from "@/stores/graphLayoutDefaultStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import { applyLayout } from "@/utils/layout";
import { applyShowGraphLayoutNow } from "@/hooks/useShowGraphLayout";
import { useGraphPointerStore } from "@/stores/graphPointerStore";
import {
  NODE_OUTLINE_EMPHASIS_EXTRA,
  NODE_OUTLINE_SELECTED_EXTRA,
  NODE_OUTLINE_WIDTHS,
  useNodeOutlineStore,
  useNodeOutlineWidth,
} from "@/stores/nodeOutlineStore";
import {
  EDGE_LINE_HOVER_EXTRA,
  EDGE_LINE_WIDTHS,
  useEdgeLineStore,
  useEdgeLineWidth,
} from "@/stores/edgeLineStore";
import {
  GRAPH_POINTERS,
  POINTER_SIZES,
  isGraphPointer,
  isPrecisePointer,
  pointerCursorImage,
  pointerCursorValue,
  isPointerSize,
} from "@/utils/graphCursor";
import { Group, SettingLabel, mutedStyle } from "./shared";

export function AppearanceSection() {
  return (
    <>
      <Group id="pointer" title="Pointer">
        <GraphPointerRow />
        <div style={{ marginTop: 14 }}>
          <PointerSizeRow />
        </div>
      </Group>
      <Group id="node-outlines" title="Node outlines">
        <NodeOutlineRow />
      </Group>
      <Group id="lines-between-nodes" title="Lines between nodes">
        <EdgeLineRow />
      </Group>
      <Group id="automatic-layout" title="Automatic layout">
        <AutomaticLayoutRow />
      </Group>
      <Group id="graph-legend" title="Graph legend">
        <GraphLegendRow />
      </Group>
      <Group id="scheduling-arrows" title="Scheduling arrows">
        <SchedulingArrowsRow />
      </Group>
    </>
  );
}

// Switching the setting also re-arranges the model you have open, if its
// layout is automatic; a custom layout you arranged yourself is left alone.
function applyToOpenModel(style: (typeof LAYOUT_STYLES)[number]["id"]) {
  useGraphSettings.getState().setLayoutStyle(style);
  if (!useModelStore.getState().autoLayout) return;
  if (style === "showgraph") {
    // show_graph flows bottom-to-top; turn the ports to match.
    useGraphSettings.getState().setDirection("BT");
    void applyShowGraphLayoutNow();
    return;
  }
  const { nodes, edges, setNodes } = useModelStore.getState();
  const { direction } = useGraphSettings.getState();
  setNodes(applyLayout(style, nodes, edges, { direction }));
}

function AutomaticLayoutRow() {
  const style = useGraphLayoutDefaultStore((s) => s.style);
  const setStyle = useGraphLayoutDefaultStore((s) => s.setStyle);
  const hint = LAYOUT_STYLES.find((o) => o.id === style)?.hint;
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="How models are arranged" htmlFor="setting-graph-layout-default">
        The arrangement a model gets when you open it without a layout of your
        own. Like show_graph places every node where PsyNeuLink's show_graph()
        draws it, enlarged to fit PsyNeuView's boxes. The layout menu on the
        graph toolbar switches the model you have open without changing this.
      </SettingLabel>
      <select
        id="setting-graph-layout-default"
        data-testid="setting-graph-layout-default"
        value={style}
        onChange={(e) => {
          if (!isLayoutStyle(e.target.value)) return;
          setStyle(e.target.value);
          applyToOpenModel(e.target.value);
        }}
        style={selectStyle}
      >
        {LAYOUT_STYLES.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.id === DEFAULT_LAYOUT_STYLE ? " (default)" : ""}
          </option>
        ))}
      </select>
      {hint && <div style={{ ...mutedStyle, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function GraphLegendRow() {
  const start = useGraphLegendStore((s) => s.start);
  const setStart = useGraphLegendStore((s) => s.setStart);
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="How the legend opens" htmlFor="setting-graph-legend-start">
        The legend in the graph view explains the edge types of graph-structure
        conditions. Collapsed, it is a small Legend button in the corner of the
        canvas. Either way, the legend's own Show and Hide fold it for the
        model you have open.
      </SettingLabel>
      <select
        id="setting-graph-legend-start"
        data-testid="setting-graph-legend-start"
        value={start}
        onChange={(e) => isLegendStart(e.target.value) && setStart(e.target.value)}
        style={selectStyle}
      >
        {LEGEND_STARTS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.id === "collapsed" ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function SchedulingArrowsRow() {
  const arrows = useSchedulingArrowsStore((s) => s.arrows);
  const setArrows = useSchedulingArrowsStore((s) => s.setArrows);
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Scheduling-condition arrows" htmlFor="setting-graph-scheduling-arrows">
        The dashed arrows on the canvas show a model's graph-structure
        conditions (before, after and the like). PsyNeuLink's show_graph
        doesn't draw them, so hide them to match its picture. The Scheduler
        panel lists the conditions either way.
      </SettingLabel>
      <select
        id="setting-graph-scheduling-arrows"
        data-testid="setting-graph-scheduling-arrows"
        value={arrows}
        onChange={(e) => isSchedulingArrows(e.target.value) && setArrows(e.target.value)}
        style={selectStyle}
      >
        {SCHEDULING_ARROWS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.id === "shown" ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

const selectStyle = { marginTop: 6, fontSize: 12, padding: "3px 6px" } as const;

function GraphPointerRow() {
  const pointer = useGraphPointerStore((s) => s.pointer);
  const setPointer = useGraphPointerStore((s) => s.setPointer);
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Pointer in the graph view" htmlFor="setting-graph-pointer">
        The arrow's tip is the exact point that clicks, so small ports, edge
        labels and the edges themselves are easy to aim at. The hand is the
        grab hand over the canvas and nodes. Either way, a grabbing hand shows
        while you drag the canvas, and text fields and dividers keep their own
        cursors. The crosshair and the circle click at their centre, drawn as a
        dot, and turn heavier while the button is held over a node or edge.
      </SettingLabel>
      <select
        id="setting-graph-pointer"
        data-testid="setting-graph-pointer"
        value={pointer}
        onChange={(e) => isGraphPointer(e.target.value) && setPointer(e.target.value)}
        style={selectStyle}
      >
        {GRAPH_POINTERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.id === "arrow" ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function PointerSizeRow() {
  const size = useGraphPointerStore((s) => s.size);
  const setSize = useGraphPointerStore((s) => s.setSize);
  const pointer = useGraphPointerStore((s) => s.pointer);
  // The hand is the system's own, so the preview shows the arrow for it.
  const shown = pointer === "hand" ? "arrow" : pointer;
  const image = pointerCursorImage(shown, size);
  const pressed = isPrecisePointer(shown) ? pointerCursorImage(shown, size, true) : null;
  const name = GRAPH_POINTERS.find((p) => p.id === shown)!.label.toLowerCase();
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Pointer size" htmlFor="setting-graph-pointer-size">
        The size of the pointer in the graph view. Window zoom (⌘+ / ⌘−) doesn't
        change it; this does. The hand is the system's own and keeps its size.
      </SettingLabel>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <select
          id="setting-graph-pointer-size"
          data-testid="setting-graph-pointer-size"
          value={size}
          onChange={(e) => isPointerSize(e.target.value) && setSize(e.target.value)}
          style={selectStyle}
        >
          {POINTER_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.id === "medium" ? " (default)" : ""}
            </option>
          ))}
        </select>
        {/* The pointer as it will show (and, for #40's, its pressed look), and the real pointer over this box. */}
        <div
          data-testid="graph-pointer-preview"
          title={pointer === "hand" ? "The arrow, if you choose it above" : "Move the pointer here to see it"}
          style={{
            marginTop: 6,
            minWidth: 128,
            minHeight: 48,
            padding: 8,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--pnv-surface-muted)",
            border: "1px dashed var(--pnv-border-light)",
            borderRadius: 6,
            cursor: pointer === "hand" ? undefined : pointerCursorValue(shown, size),
          }}
        >
          <img src={image.url} width={image.px} height={image.px} alt={`The ${name} at ${image.px} pixels`} draggable={false} />
          {pressed && (
            <img
              data-testid="graph-pointer-preview-pressed"
              src={pressed.url}
              width={pressed.px}
              height={pressed.px}
              alt={`The ${name} while the button is held`}
              title="While the button is held"
              draggable={false}
            />
          )}
          <span style={mutedStyle}>{image.px} px</span>
        </div>
      </div>
    </div>
  );
}

function NodeOutlineRow() {
  const width = useNodeOutlineWidth();
  const defaultWidth = useNodeOutlineStore((s) => s.defaultWidth);
  const setWidth = useNodeOutlineStore((s) => s.setWidth);
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Outline width" htmlFor="setting-node-outline">
        How heavy a node's outline is in the graph view. INPUT, OUTPUT and
        CONTROL nodes are drawn {NODE_OUTLINE_EMPHASIS_EXTRA} px heavier, and a
        selected or running node {NODE_OUTLINE_SELECTED_EXTRA} px heavier
        again, so they stand out at every width.
      </SettingLabel>
      <select
        id="setting-node-outline"
        data-testid="setting-node-outline"
        value={String(width)}
        onChange={(e) => setWidth(Number(e.target.value))}
        style={selectStyle}
      >
        {NODE_OUTLINE_WIDTHS.map((w) => (
          <option key={w} value={String(w)}>
            {w} px{w === defaultWidth ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function EdgeLineRow() {
  const width = useEdgeLineWidth();
  const defaultWidth = useEdgeLineStore((s) => s.defaultWidth);
  const setWidth = useEdgeLineStore((s) => s.setWidth);
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Line width" htmlFor="setting-edge-line-width">
        How heavy the lines between nodes (projections) are in the graph view.
        Arrowheads grow with the line, other kinds of projection keep their
        weight relative to it, and the line under the pointer is drawn{" "}
        {EDGE_LINE_HOVER_EXTRA} px heavier.
      </SettingLabel>
      <select
        id="setting-edge-line-width"
        data-testid="setting-edge-line-width"
        value={String(width)}
        onChange={(e) => setWidth(Number(e.target.value))}
        style={selectStyle}
      >
        {EDGE_LINE_WIDTHS.map((w) => (
          <option key={w} value={String(w)}>
            {w} px{w === defaultWidth ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
