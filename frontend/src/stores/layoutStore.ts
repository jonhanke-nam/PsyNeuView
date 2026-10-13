/**
 * Zustand store for top-level pane layout — see #193 (visibility) and #226
 * (presets + size persistence).
 *
 * Three booleans control which panes render in the App layout:
 *   - codeVisible   — the Python source editor (left)
 *   - graphVisible  — the graph canvas (top-right)
 *   - bottomVisible — the inspector / run / show_graph / style tabs (bottom-right)
 *
 * Invariant: at least one of these three is always visible, so the user can
 * never reach a fully-empty workspace. The object palette is a fourth panel,
 * but its visibility lives in paletteStore (single source of truth); presets
 * here drive it through that store.
 *
 * Pane *sizes* (the Allotment split proportions) are persisted too, so a
 * restored layout keeps its shape, not just which panes are on.
 *
 * Drag-to-rearrange and user-savable *named* layouts remain the stretch goal
 * (#226 phase 3); this is the predefined-preset slice.
 */

import { create } from "zustand";
import { usePaletteStore } from "./paletteStore";

const LS_CODE_VISIBLE = "psynewview_layout_code_visible";
const LS_GRAPH_VISIBLE = "psynewview_layout_graph_visible";
const LS_BOTTOM_VISIBLE = "psynewview_layout_bottom_visible";
const LS_OUTER_SIZES = "psynewview_layout_outer_sizes";
const LS_INNER_SIZES = "psynewview_layout_inner_sizes";

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function loadSizes(key: string): number[] | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((n) => typeof n === "number" && n > 0)) {
      return arr;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export type LayoutPanel = "code" | "graph" | "bottom";
export type LayoutPreset = "graph" | "code-graph" | "graph-inspector" | "everything";

// Each preset names the desired on/off state of all four panels. Graph is
// always on — it's the anchor that keeps the "at least one visible" invariant
// trivially satisfied.
const PRESETS: Record<LayoutPreset, { code: boolean; graph: boolean; bottom: boolean; palette: boolean }> = {
  graph: { code: false, graph: true, bottom: false, palette: false },
  "code-graph": { code: true, graph: true, bottom: false, palette: false },
  "graph-inspector": { code: false, graph: true, bottom: true, palette: false },
  everything: { code: true, graph: true, bottom: true, palette: true },
};

interface LayoutState {
  codeVisible: boolean;
  graphVisible: boolean;
  bottomVisible: boolean;
  outerSizes: number[] | undefined;
  innerSizes: number[] | undefined;

  toggleCode: () => void;
  toggleGraph: () => void;
  toggleBottom: () => void;
  setPanelVisible: (panel: LayoutPanel, v: boolean) => void;
  applyPreset: (preset: LayoutPreset) => void;
  setOuterSizes: (sizes: number[]) => void;
  setInnerSizes: (sizes: number[]) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  // Persist a visibility flag and update state in one shot.
  const persistVisible = (
    field: "codeVisible" | "graphVisible" | "bottomVisible",
    key: string,
    v: boolean,
  ) => {
    localStorage.setItem(key, String(v));
    set({ [field]: v } as Pick<LayoutState, typeof field>);
  };

  const keyFor: Record<LayoutPanel, { field: "codeVisible" | "graphVisible" | "bottomVisible"; ls: string }> = {
    code: { field: "codeVisible", ls: LS_CODE_VISIBLE },
    graph: { field: "graphVisible", ls: LS_GRAPH_VISIBLE },
    bottom: { field: "bottomVisible", ls: LS_BOTTOM_VISIBLE },
  };

  // Would turning `panel` off leave nothing visible? (Used to block the
  // last-pane hide so the workspace never goes fully empty.)
  const wouldEmpty = (panel: LayoutPanel): boolean => {
    const s = get();
    const after = {
      code: panel === "code" ? false : s.codeVisible,
      graph: panel === "graph" ? false : s.graphVisible,
      bottom: panel === "bottom" ? false : s.bottomVisible,
    };
    return !after.code && !after.graph && !after.bottom;
  };

  const setPanelVisible = (panel: LayoutPanel, v: boolean) => {
    if (!v && wouldEmpty(panel)) return; // refuse to hide the last pane
    const { field, ls } = keyFor[panel];
    persistVisible(field, ls, v);
  };

  return {
    codeVisible: loadBool(LS_CODE_VISIBLE, true),
    graphVisible: loadBool(LS_GRAPH_VISIBLE, true),
    bottomVisible: loadBool(LS_BOTTOM_VISIBLE, true),
    outerSizes: loadSizes(LS_OUTER_SIZES),
    innerSizes: loadSizes(LS_INNER_SIZES),

    toggleCode: () => setPanelVisible("code", !get().codeVisible),
    toggleGraph: () => setPanelVisible("graph", !get().graphVisible),
    toggleBottom: () => setPanelVisible("bottom", !get().bottomVisible),
    setPanelVisible,

    applyPreset: (preset) => {
      const p = PRESETS[preset];
      localStorage.setItem(LS_CODE_VISIBLE, String(p.code));
      localStorage.setItem(LS_GRAPH_VISIBLE, String(p.graph));
      localStorage.setItem(LS_BOTTOM_VISIBLE, String(p.bottom));
      set({ codeVisible: p.code, graphVisible: p.graph, bottomVisible: p.bottom });
      usePaletteStore.getState().setOpen(p.palette);
    },

    setOuterSizes: (sizes) => {
      localStorage.setItem(LS_OUTER_SIZES, JSON.stringify(sizes));
      set({ outerSizes: sizes });
    },
    setInnerSizes: (sizes) => {
      localStorage.setItem(LS_INNER_SIZES, JSON.stringify(sizes));
      set({ innerSizes: sizes });
    },
  };
});
