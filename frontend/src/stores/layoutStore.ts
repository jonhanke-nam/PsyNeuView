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
 * never reach a fully-empty workspace. The Components panel (the palette) is a
 * fourth panel, but its visibility lives in paletteStore (single source of
 * truth); presets here drive it through that store.
 *
 * Default (#189): the graph alone. The code editor and the bottom panel start
 * hidden, so the graph is the window; the Layout menu and the Mod+1..4
 * shortcuts (#191) bring the others back. A choice someone has made in either
 * is stored and always wins over the default. The Components panel keeps its
 * own start setting (#113).
 *
 * A guided walkthrough needs the panels its steps point at, so it shows
 * everything while it runs and puts the learner's layout back afterwards; the
 * layout from before is kept in storage, so a reload mid-walkthrough can't
 * leave the tutorial layout behind as if it were a choice.
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
/** The layout from before a walkthrough, while one runs (or was interrupted). */
export const LS_BEFORE_WALKTHROUGH = "psynewview_layout_before_walkthrough";

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

// #110: the graph gets the window by default. With nothing stored, the code
// editor starts at about a quarter of the width (still on screen, so "the
// code is here" stays obvious and walkthroughs that point at it still work)
// and the inspector tabs at about a fifth of the height. Allotment scales
// these to the real window. A split the person has dragged is stored and
// always wins over these.
export const DEFAULT_OUTER_SIZES = [25, 75];
export const DEFAULT_INNER_SIZES = [78, 22];

export type LayoutPanel = "code" | "graph" | "bottom";
/** Every panel the Layout menu and the shortcuts can show or hide. */
export type AnyPanel = LayoutPanel | "palette";
export type LayoutPreset = "graph" | "code-graph" | "graph-inspector" | "everything";

/** Which of the four panels are showing. */
export interface PanelLayout {
  code: boolean;
  graph: boolean;
  bottom: boolean;
  palette: boolean;
}

// Each preset names the desired on/off state of all four panels. Graph is
// always on — it's the anchor that keeps the "at least one visible" invariant
// trivially satisfied.
const PRESETS: Record<LayoutPreset, PanelLayout> = {
  graph: { code: false, graph: true, bottom: false, palette: false },
  "code-graph": { code: true, graph: true, bottom: false, palette: false },
  "graph-inspector": { code: false, graph: true, bottom: true, palette: false },
  everything: { code: true, graph: true, bottom: true, palette: true },
};

// #189: with nothing stored, the graph alone. (Before this, all three were on.)
export const DEFAULT_CODE_VISIBLE = false;
export const DEFAULT_GRAPH_VISIBLE = true;
export const DEFAULT_BOTTOM_VISIBLE = false;

/**
 * The layout this window's own walkthrough puts back (#172). Storage is shared by
 * every window on the origin, and a second window opened during a walkthrough
 * takes the stored copy when it loads, so this window keeps one of its own.
 */
let layoutForThisWindow: PanelLayout | null = null;

function loadBeforeWalkthrough(): PanelLayout | null {
  try {
    const raw = localStorage.getItem(LS_BEFORE_WALKTHROUGH);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (
      v &&
      typeof v.code === "boolean" &&
      typeof v.graph === "boolean" &&
      typeof v.bottom === "boolean" &&
      typeof v.palette === "boolean"
    ) {
      return v as PanelLayout;
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface LayoutState {
  codeVisible: boolean;
  graphVisible: boolean;
  bottomVisible: boolean;
  outerSizes: number[] | undefined;
  innerSizes: number[] | undefined;

  toggleCode: () => boolean;
  toggleGraph: () => boolean;
  toggleBottom: () => boolean;
  /**
   * Show or hide one panel (#191). Returns false when nothing changed because
   * it was the last visible panel, so the caller can say why (#213: every
   * caller does, through `explainLastPanel`).
   */
  togglePanel: (panel: AnyPanel) => boolean;
  /** Returns false when hiding was refused because it was the last visible panel. */
  setPanelVisible: (panel: LayoutPanel, v: boolean) => boolean;
  applyPreset: (preset: LayoutPreset) => void;
  setOuterSizes: (sizes: number[]) => void;
  setInnerSizes: (sizes: number[]) => void;
  /**
   * A walkthrough is starting (#189): remember the layout as it is, then show
   * every panel. Idempotent while a layout is remembered, so a walkthrough that
   * restarts after a reload keeps the learner's own layout, not the tutorial's.
   */
  showEverythingForWalkthrough: () => void;
  /**
   * A walkthrough ended, or was interrupted (#189): put the remembered layout
   * back and forget it. Does nothing when none is remembered.
   */
  restoreLayoutAfterWalkthrough: () => void;
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

  const setPanelVisible = (panel: LayoutPanel, v: boolean): boolean => {
    if (!v && wouldEmpty(panel)) return false; // refuse to hide the last pane
    const { field, ls } = keyFor[panel];
    persistVisible(field, ls, v);
    return true;
  };

  // Set all four panels at once, stored like any other choice.
  const applyLayout = (p: PanelLayout) => {
    localStorage.setItem(LS_CODE_VISIBLE, String(p.code));
    localStorage.setItem(LS_GRAPH_VISIBLE, String(p.graph));
    localStorage.setItem(LS_BOTTOM_VISIBLE, String(p.bottom));
    set({ codeVisible: p.code, graphVisible: p.graph, bottomVisible: p.bottom });
    usePaletteStore.getState().setOpen(p.palette);
  };

  const currentLayout = (): PanelLayout => {
    const s = get();
    return {
      code: s.codeVisible,
      graph: s.graphVisible,
      bottom: s.bottomVisible,
      palette: usePaletteStore.getState().isOpen,
    };
  };

  return {
    codeVisible: loadBool(LS_CODE_VISIBLE, DEFAULT_CODE_VISIBLE),
    graphVisible: loadBool(LS_GRAPH_VISIBLE, DEFAULT_GRAPH_VISIBLE),
    bottomVisible: loadBool(LS_BOTTOM_VISIBLE, DEFAULT_BOTTOM_VISIBLE),
    outerSizes: loadSizes(LS_OUTER_SIZES) ?? DEFAULT_OUTER_SIZES,
    innerSizes: loadSizes(LS_INNER_SIZES) ?? DEFAULT_INNER_SIZES,

    toggleCode: () => setPanelVisible("code", !get().codeVisible),
    toggleGraph: () => setPanelVisible("graph", !get().graphVisible),
    toggleBottom: () => setPanelVisible("bottom", !get().bottomVisible),
    togglePanel: (panel) => {
      if (panel === "palette") {
        usePaletteStore.getState().toggleOpen();
        return true;
      }
      return setPanelVisible(panel, !get()[keyFor[panel].field]);
    },
    setPanelVisible,

    applyPreset: (preset) => applyLayout(PRESETS[preset]),

    showEverythingForWalkthrough: () => {
      if (loadBeforeWalkthrough() === null) {
        localStorage.setItem(LS_BEFORE_WALKTHROUGH, JSON.stringify(currentLayout()));
      }
      layoutForThisWindow = loadBeforeWalkthrough();
      applyLayout(PRESETS.everything);
    },
    restoreLayoutAfterWalkthrough: () => {
      const before = layoutForThisWindow ?? loadBeforeWalkthrough();
      layoutForThisWindow = null;
      if (before === null) return;
      localStorage.removeItem(LS_BEFORE_WALKTHROUGH);
      applyLayout(before);
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
