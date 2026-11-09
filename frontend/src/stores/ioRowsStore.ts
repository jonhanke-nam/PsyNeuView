/**
 * Settings ▸ Appearance ▸ Automatic layout ▸ Keep inputs on the bottom and
 * outputs on top (#219), the design convention of #212.
 *
 *  - Off: no constraint.
 *  - In automatic layouts (default): an automatic layout puts each
 *    composition's inputs on its lowest row and its outputs on its highest
 *    (utils/ioRows.ts). Dragging is free.
 *  - Also while dragging: as well, a dragged input or output slides sideways
 *    along its row, and other nodes can't be dragged below the inputs or
 *    above the outputs.
 *
 * It applies to Like show_graph, and to Layered while it flows bottom-to-top.
 * Radial and Force ignore direction by design, and choosing top-down (or a
 * sideways direction) for Layered is an explicit request that wins, so there
 * the setting doesn't apply, and the setting says so. Saved layouts never
 * move by themselves: the Layout menu's Tidy inputs and outputs does that,
 * and can be undone.
 *
 * Remembered per browser; inside the Mac app the app keeps `psyneuview.`
 * keys across launches. Storage can be blocked, so every access is wrapped
 * and the default stands in.
 */

import { create } from "zustand";
import type { Node } from "@xyflow/react";
import type { GraphDirection, LayoutStyle } from "@/stores/graphSettingsStore";
import { recordSettingChanged } from "@/utils/activityLog";

export type IoRows = "off" | "layouts" | "drag";

export const IO_ROWS_KEY = "psyneuview.graph.ioRows";
export const DEFAULT_IO_ROWS: IoRows = "layouts";

export const IO_ROWS: { id: IoRows; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "layouts", label: "In automatic layouts" },
  { id: "drag", label: "Also while dragging" },
];

export function isIoRows(v: unknown): v is IoRows {
  return v === "off" || v === "layouts" || v === "drag";
}

export function loadIoRows(): IoRows {
  try {
    const stored = localStorage.getItem(IO_ROWS_KEY);
    return isIoRows(stored) ? stored : DEFAULT_IO_ROWS;
  } catch {
    return DEFAULT_IO_ROWS;
  }
}

/**
 * Why the setting doesn't apply to a layout, or null when it does: Like
 * show_graph always flows bottom-to-top, Layered only when it is set to.
 */
export function ioRowsNotApplying(style: LayoutStyle, direction: GraphDirection): string | null {
  if (style === "radial" || style === "force") {
    return `${style === "radial" ? "Radial" : "Force"} arranges nodes without a direction.`;
  }
  if (style === "layered" && direction !== "BT") {
    const way = direction === "TB" ? "top-down" : "sideways";
    return `Layered is set to flow ${way} (Advanced Graph View Options ▸ Direction), and that choice wins.`;
  }
  return null;
}

interface IoRowsState {
  ioRows: IoRows;
  setIoRows: (ioRows: IoRows) => void;
}

export const useIoRowsStore = create<IoRowsState>((set) => ({
  ioRows: loadIoRows(),
  setIoRows: (ioRows) => {
    try {
      localStorage.setItem(IO_ROWS_KEY, ioRows);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("graph-io-rows", ioRows);
    set({ ioRows });
  },
}));

/**
 * The canvas's own handle on Tidy inputs and outputs, for the Layout menu.
 * The canvas holds the positions as dragged, which the model store only
 * catches up with on a rebuild, so it reads its nodes and does the tidying
 * itself (GraphCanvas registers both while it is mounted).
 */
interface CanvasTidy {
  nodes: () => Node[];
  tidy: () => void;
}
let canvasTidy: CanvasTidy | null = null;

export function registerCanvasTidy(handle: CanvasTidy): () => void {
  canvasTidy = handle;
  return () => {
    if (canvasTidy === handle) canvasTidy = null;
  };
}

export function canvasTidyHandle(): CanvasTidy | null {
  return canvasTidy;
}
