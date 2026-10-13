/**
 * Settings ▸ Appearance: how the app looks and feels. (#1301)
 *
 * The first two settings are the pointer in the graph view — the arrow or
 * React Flow's hand — and the arrow's size. Both are remembered per browser
 * (stores/graphPointerStore.ts). A preview shows the arrow at the chosen
 * size, since the real pointer is only seen over the canvas; hovering the
 * preview shows the real thing too. Look-and-feel settings belong here
 * (docs/settings-etiquette.md §1).
 */

import { useGraphPointerStore } from "@/stores/graphPointerStore";
import {
  GRAPH_POINTERS,
  POINTER_SIZES,
  arrowCursorImage,
  arrowCursorValue,
  isGraphPointer,
  isPointerSize,
} from "@/utils/graphCursor";
import { Group, SettingLabel, mutedStyle } from "./shared";

export function AppearanceSection() {
  return (
    <Group id="pointer" title="Pointer">
      <GraphPointerRow />
      <div style={{ marginTop: 14 }}>
        <PointerSizeRow />
      </div>
    </Group>
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
        cursors.
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
  const image = arrowCursorImage(size);
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Pointer size" htmlFor="setting-graph-pointer-size">
        The size of the arrow in the graph view. Window zoom (⌘+ / ⌘−) doesn't
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
        {/* The arrow as it will show, and the real pointer over this box. */}
        <div
          data-testid="graph-pointer-preview"
          title={pointer === "arrow" ? "Move the pointer here to see it" : "The arrow, if you choose it above"}
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
            cursor: pointer === "arrow" ? arrowCursorValue(size) : undefined,
          }}
        >
          <img src={image.url} width={image.px} height={image.px} alt={`The arrow at ${image.px} pixels`} draggable={false} />
          <span style={mutedStyle}>{image.px} px</span>
        </div>
      </div>
    </div>
  );
}
