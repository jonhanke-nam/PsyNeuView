/**
 * Settings ▸ Appearance: how the app looks and feels. (#1301)
 *
 * The first two settings are the pointer in the graph view — the arrow, the
 * hand, the crosshair or the circle (#40) — and its size, which covers them
 * all and the grabbing hand (#40). Both are remembered per browser
 * (stores/graphPointerStore.ts). A preview shows the pointer at the chosen
 * size, since the real pointer is only seen over the canvas; hovering the
 * preview shows the real thing too. Look-and-feel settings belong here
 * (docs/settings-etiquette.md §1). The graph legend's opening state (#7)
 * is here too: collapsed by default. So is the automatic layout the graph
 * view opens with (#19): Like show_graph by default (#24), or Layered.
 * And how heavy node outlines are (#42): one width, remembered per browser
 * (stores/nodeOutlineStore.ts), that the heavier outlines follow. And
 * whether scheduling-condition arrows are drawn (#53): hidden by default (#123).
 * And how the Components panel opens (#113): the word list by default, or
 * the icon strip; the panel's own ◀/▶ only changes it for the session.
 * And the app's text size (#111): Small, Default or Large, remembered per
 * browser (stores/textSizeStore.ts). And whether a node shows its "view
 * only" tag (#211): hidden by default, as show_graph draws no such tag
 * (stores/viewOnlyTagsStore.ts). And the panels (#215): whether every
 * panel may be hidden, and which ones a model opens onto a blank screen,
 * the second only available while the first is on (stores/layoutStore.ts).
 */

import { LEGEND_STARTS, isLegendStart, useGraphLegendStore } from "@/stores/graphLegendStore";
import {
  COMPONENTS_STARTS,
  DEFAULT_COMPONENTS_START,
  isComponentsStart,
  useComponentsStartStore,
} from "@/stores/componentsPanelStartStore";
import { usePaletteStore } from "@/stores/paletteStore";
import { BLANK_LOAD_PANEL_OPTIONS, isLayoutPanel, useLayoutStore } from "@/stores/layoutStore";
import {
  DEFAULT_SCHEDULING_ARROWS,
  SCHEDULING_ARROWS,
  isSchedulingArrows,
  useSchedulingArrowsStore,
} from "@/stores/schedulingArrowsStore";
import {
  DEFAULT_VIEW_ONLY_TAGS,
  VIEW_ONLY_TAGS,
  isViewOnlyTags,
  useViewOnlyTagsStore,
} from "@/stores/viewOnlyTagsStore";
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
  pointerCursorImage,
  pointerCursorValue,
  isPointerSize,
} from "@/utils/graphCursor";
import { TEXT_SIZES, TEXT_SIZE_LABELS, DEFAULT_TEXT_SIZE, isTextSize, useTextSizeStore } from "@/stores/textSizeStore";
import { BUSY_TIMER_PLACES, DEFAULT_BUSY_TIMER_PLACE, useBusyStore } from "@/stores/busyStore";
import { Group, SettingLabel, mutedStyle } from "./shared";

export function AppearanceSection() {
  return (
    <>
      <Group id="text-size" title="Text size">
        <TextSizeRow />
      </Group>
      <Group id="pointer" title="Pointer">
        <GraphPointerRow />
        <div style={{ marginTop: 14 }}>
          <PointerSizeRow />
        </div>
      </Group>
      <Group id="node-outlines" title="Node outlines">
        <NodeOutlineRow />
      </Group>
      <Group id="node-tags" title="Node tags">
        <ViewOnlyTagsRow />
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
      <Group id="busy-wheel" title="Busy wheel">
        <BusyTimerRow />
      </Group>
      <Group id="scheduling-arrows" title="Scheduling arrows">
        <SchedulingArrowsRow />
      </Group>
      <Group id="components-panel" title="Components panel">
        <ComponentsStartRow />
      </Group>
      <Group id="panels" title="Panels">
        <AllowBlankScreenRow />
        {/* Indented under the setting it depends on, in line with that setting's words. */}
        <div style={{ marginTop: 14, marginLeft: 21 }}>
          <BlankLoadPanelsRow />
        </div>
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
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
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
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
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

function ComponentsStartRow() {
  const start = useComponentsStartStore((s) => s.start);
  const setStart = useComponentsStartStore((s) => s.setStart);
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
      <SettingLabel title="How the panel opens" htmlFor="setting-components-start">
        The Components panel on the left of the graph view. Open, it shows the
        search box and the list of sections; as the icon strip, it is a narrow
        column of icons. Either way, the panel's own ◀ and ▶ button switches
        it until you next open PsyNeuView.
      </SettingLabel>
      <select
        id="setting-components-start"
        data-testid="setting-components-start"
        value={start}
        onChange={(e) => {
          if (!isComponentsStart(e.target.value)) return;
          setStart(e.target.value);
          // Show the choice now, too.
          usePaletteStore.getState().setCompact(e.target.value === "strip");
        }}
        style={selectStyle}
      >
        {COMPONENTS_STARTS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.id === DEFAULT_COMPONENTS_START ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// #215: whether every panel may be hidden. Off, one of the graph, the code
// editor and the Inspector panel always stays (the store refuses, #213).
function AllowBlankScreenRow() {
  const allowBlank = useLayoutStore((s) => s.allowBlank);
  const setAllowBlank = useLayoutStore((s) => s.setAllowBlank);
  return (
    <label style={{ fontSize: "var(--pnv-fs-13)", display: "flex", gap: 8, alignItems: "flex-start" }}>
      <input
        type="checkbox"
        data-testid="setting-allow-blank-screen"
        checked={allowBlank}
        onChange={(e) => setAllowBlank(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span>
        Allow a blank screen
        <span style={{ ...mutedStyle, display: "block" }}>
          Normally one of the graph, the code editor and the Inspector panel always stays on screen. With
          this on, you can hide them all; the toolbar stays, and a short hint says how to bring a panel
          back. Turning it off while the screen is blank brings the graph back.
        </span>
      </span>
    </label>
  );
}

// #215: the panels a model opens onto a blank screen. Only available while a
// blank screen is allowed (greyed out otherwise: there is no blank screen to
// load onto). One of the graph, the code editor and the Inspector panel stays
// ticked, since a model needs one of them to show in.
function BlankLoadPanelsRow() {
  const allowBlank = useLayoutStore((s) => s.allowBlank);
  const panels = useLayoutStore((s) => s.blankLoadPanels);
  const setPanels = useLayoutStore((s) => s.setBlankLoadPanels);
  const lastTopLevel = panels.filter((p) => isLayoutPanel(p)).length === 1;
  return (
    <fieldset
      data-testid="setting-blank-load-panels"
      disabled={!allowBlank}
      aria-disabled={!allowBlank || undefined}
      style={{ border: "none", margin: 0, padding: 0, fontSize: "var(--pnv-fs-13)", opacity: allowBlank ? 1 : 0.5 }}
    >
      <legend style={{ padding: 0 }}>
        <SettingLabel title="Panels to open when a model loads on a blank screen">
          Only when the screen is blank at the moment a model loads; with any panel showing, loading
          changes nothing. One of the graph, the code editor and the Inspector panel stays ticked.
          {!allowBlank && " Available while Allow a blank screen is on."}
        </SettingLabel>
      </legend>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        {BLANK_LOAD_PANEL_OPTIONS.map((o) => {
          const chosen = panels.includes(o.id);
          // The last of the three can't be unticked; the row says why.
          const keeps = chosen && lastTopLevel && isLayoutPanel(o.id);
          return (
            <label
              key={o.id}
              title={keeps ? "One of the graph, the code editor and the Inspector panel has to stay ticked" : undefined}
              style={{ display: "flex", gap: 8, alignItems: "center", cursor: keeps || !allowBlank ? "default" : "pointer" }}
            >
              <input
                type="checkbox"
                data-testid={`blank-load-panel-${o.id}`}
                checked={chosen}
                disabled={!allowBlank || keeps}
                onChange={(e) =>
                  setPanels(e.target.checked ? [...panels, o.id] : panels.filter((p) => p !== o.id))
                }
              />
              <span>
                {o.label}
                {o.id === "graph" ? <span style={mutedStyle}> (default)</span> : null}
                {/* It is drawn inside the graph, so it can't show on its own. */}
                {o.id === "palette" ? <span style={mutedStyle}> (shows inside the graph, so tick the graph too)</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SchedulingArrowsRow() {
  const arrows = useSchedulingArrowsStore((s) => s.arrows);
  const setArrows = useSchedulingArrowsStore((s) => s.setArrows);
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
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
            {o.id === DEFAULT_SCHEDULING_ARROWS ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function ViewOnlyTagsRow() {
  const tags = useViewOnlyTagsStore((s) => s.tags);
  const setTags = useViewOnlyTagsStore((s) => s.setTags);
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
      <SettingLabel title="Read-only tags" htmlFor="setting-graph-view-only-tags">
        A node whose declaration can't be edited from PsyNeuView (one built in
        a loop, say, or made by a learning pathway) can carry a small "view
        only" tag above its name. PsyNeuLink's show_graph doesn't draw it, so
        it is hidden to match its picture; the node's hover text and the
        Inspector say it either way. The type and role tags have their own
        switch in the graph's Advanced Graph View Options.
      </SettingLabel>
      <select
        id="setting-graph-view-only-tags"
        data-testid="setting-graph-view-only-tags"
        value={tags}
        onChange={(e) => isViewOnlyTags(e.target.value) && setTags(e.target.value)}
        style={selectStyle}
      >
        {VIEW_ONLY_TAGS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.id === DEFAULT_VIEW_ONLY_TAGS ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

const selectStyle = { marginTop: 6, fontSize: "var(--pnv-fs-12)", padding: "3px 6px" } as const;

function GraphPointerRow() {
  const pointer = useGraphPointerStore((s) => s.pointer);
  const setPointer = useGraphPointerStore((s) => s.setPointer);
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
      <SettingLabel title="Pointer in the graph view" htmlFor="setting-graph-pointer">
        The arrow's tip is the exact point that clicks, so small ports, edge
        labels and the edges themselves are easy to aim at. The hand is the
        grab hand over the canvas and nodes. Either way, a grabbing hand shows
        while you drag the canvas, a bend handle or an attachment dot shows
        the arrow rather than the hand so the exact point is clear, and text
        fields and dividers keep their own cursors. The crosshair and the
        circle click at their centre, drawn as a dot, turn heavier while the
        button is held over a node or edge, and show over handles and dots too.
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
  const image = pointerCursorImage(pointer, size);
  // The arrow has one look; the others change while the button is held (the hand closes).
  const pressed = pointer === "arrow" ? null : pointerCursorImage(pointer, size, true);
  const name = GRAPH_POINTERS.find((p) => p.id === pointer)!.label.toLowerCase();
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
      <SettingLabel title="Pointer size" htmlFor="setting-graph-pointer-size">
        The size of the pointer in the graph view — the arrow, the hand, the
        crosshair or the circle, and the grabbing hand while you drag. Window
        zoom (⌘+ / ⌘−) doesn't change it; this does.
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
          title="Move the pointer here to see it"
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
            cursor: pointerCursorValue(pointer, size),
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
              title={pointer === "hand" ? "While you drag" : "While the button is held"}
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
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
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
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
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

function TextSizeRow() {
  const size = useTextSizeStore((s) => s.size);
  const setSize = useTextSizeStore((s) => s.setSize);
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
      <SettingLabel title="Text size" htmlFor="setting-text-size">
        How big the app's text is: menus, panels, dialogs and the code editor.
        The editor's and Inspector's own A− A+ still adjust them from here.
        The graph's node labels follow the canvas zoom instead.
      </SettingLabel>
      <select
        id="setting-text-size"
        data-testid="setting-text-size"
        value={size}
        onChange={(e) => {
          if (isTextSize(e.target.value)) setSize(e.target.value);
        }}
        style={selectStyle}
      >
        {TEXT_SIZES.map((t) => (
          <option key={t} value={t}>
            {TEXT_SIZE_LABELS[t]}{t === DEFAULT_TEXT_SIZE ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Whether the busy wheel shows how long it has been spinning, and where (#176, #220). */
function BusyTimerRow() {
  const place = useBusyStore((s) => s.timerPlace);
  const setPlace = useBusyStore((s) => s.setTimerPlace);
  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
      <SettingLabel title="Show how long it has been spinning" htmlFor="setting-busy-timer">
        Shows the time so far with the busy wheel, once a second has passed.
        Problem reports record how long each wait took either way.
      </SettingLabel>
      <select
        id="setting-busy-timer"
        data-testid="setting-busy-timer"
        value={place}
        onChange={(e) => {
          const chosen = BUSY_TIMER_PLACES.find((p) => p.place === e.target.value);
          if (chosen) setPlace(chosen.place);
        }}
        style={selectStyle}
      >
        {BUSY_TIMER_PLACES.map((p) => (
          <option key={p.place} value={p.place}>
            {p.label}
            {p.place === DEFAULT_BUSY_TIMER_PLACE ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
