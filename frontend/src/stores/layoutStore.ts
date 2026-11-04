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
 * Except by choice (#215): Settings ▸ Appearance ▸ Allow a blank screen, off
 * by default, lets all three be hidden. While it is on, hiding the last panel
 * is not refused and a hint on the blank screen says how to bring one back
 * (BlankScreen.tsx). A model loaded onto a blank screen opens the panels
 * chosen in the dependent setting, the graph by default; loading with panels
 * showing changes nothing. Turning the setting off while the screen is blank
 * brings the graph back, and a stored blank layout read while it is off falls
 * back to the graph too, so nobody is left with a blank screen they can't
 * explain. The two settings live under `psyneuview.` keys, which the Mac app
 * keeps across launches like the layout keys.
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
import { recordSettingChanged } from "@/utils/activityLog";
import { usePaletteStore } from "./paletteStore";

const LS_CODE_VISIBLE = "psynewview_layout_code_visible";
const LS_GRAPH_VISIBLE = "psynewview_layout_graph_visible";
const LS_BOTTOM_VISIBLE = "psynewview_layout_bottom_visible";
const LS_OUTER_SIZES = "psynewview_layout_outer_sizes";
const LS_INNER_SIZES = "psynewview_layout_inner_sizes";
/** The layout from before a walkthrough, while one runs (or was interrupted). */
export const LS_BEFORE_WALKTHROUGH = "psynewview_layout_before_walkthrough";
/** Settings ▸ Appearance ▸ Allow a blank screen (#215): "true" or absent. */
export const LS_ALLOW_BLANK = "psyneuview.layout.allowBlank";
/** The panels a model opens onto a blank screen (#215): a JSON list of panel ids. */
export const LS_BLANK_LOAD_PANELS = "psyneuview.layout.blankLoadPanels";

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

const TOP_LEVEL_PANELS: LayoutPanel[] = ["graph", "code", "bottom"];

export function isLayoutPanel(v: unknown): v is LayoutPanel {
  return v === "code" || v === "graph" || v === "bottom";
}

export function isAnyPanel(v: unknown): v is AnyPanel {
  return isLayoutPanel(v) || v === "palette";
}

/** The panels on offer for opening onto a blank screen (#215), in Settings' order. */
export const BLANK_LOAD_PANEL_OPTIONS: { id: AnyPanel; label: string }[] = [
  { id: "graph", label: "The graph" },
  { id: "code", label: "The code editor" },
  { id: "bottom", label: "The Inspector panel" },
  { id: "palette", label: "The Components panel" },
];

export const DEFAULT_ALLOW_BLANK = false;
export const DEFAULT_BLANK_LOAD_PANELS: readonly AnyPanel[] = ["graph"];

/** A set of panels to open on load is usable when it holds a graph, code or Inspector panel. */
export function isUsableBlankLoadPanels(panels: readonly AnyPanel[]): boolean {
  return panels.some((p) => isLayoutPanel(p));
}

function loadAllowBlank(): boolean {
  try {
    // Anything but "true" (absent, "false", garbage) is the default: off.
    return localStorage.getItem(LS_ALLOW_BLANK) === "true";
  } catch {
    return DEFAULT_ALLOW_BLANK;
  }
}

/**
 * The stored choice of panels to open, cleaned: unknown entries dropped,
 * duplicates folded, and the default (the graph) when what is left could
 * not show a model (no graph, code editor or Inspector panel), or the value
 * is not a list at all.
 */
function loadBlankLoadPanels(): AnyPanel[] {
  try {
    const raw = localStorage.getItem(LS_BLANK_LOAD_PANELS);
    if (raw === null) return [...DEFAULT_BLANK_LOAD_PANELS];
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [...DEFAULT_BLANK_LOAD_PANELS];
    const panels = BLANK_LOAD_PANEL_OPTIONS.map((o) => o.id).filter((id) => v.includes(id));
    return isUsableBlankLoadPanels(panels) ? panels : [...DEFAULT_BLANK_LOAD_PANELS];
  } catch {
    return [...DEFAULT_BLANK_LOAD_PANELS];
  }
}
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
  /** Settings ▸ Appearance ▸ Allow a blank screen (#215). Off by default. */
  allowBlank: boolean;
  /** The panels a model opens onto a blank screen (#215). The graph by default. */
  blankLoadPanels: AnyPanel[];

  /** None of the graph, the code editor and the Inspector panel is showing. */
  isBlank: () => boolean;
  /**
   * Turn the blank-screen setting on or off. Turning it off while the screen
   * is blank brings the graph back (#215).
   */
  setAllowBlank: (v: boolean) => void;
  /**
   * Choose the panels a model opens onto a blank screen. Refused (returns
   * false) unless the set holds the graph, the code editor or the Inspector
   * panel, since a model needs one of them to show in.
   */
  setBlankLoadPanels: (panels: AnyPanel[]) => boolean;
  /**
   * A model is being opened (#215): when the screen is blank, show the panels
   * chosen for that; with any panel showing, nothing changes. Returns whether
   * anything changed.
   */
  showPanelsForOpen: () => boolean;

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
  // last-pane hide so the workspace never goes fully empty, unless a blank
  // screen is allowed, #215.)
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
    if (!v && !get().allowBlank && wouldEmpty(panel)) return false; // refuse to hide the last pane
    const { field, ls } = keyFor[panel];
    persistVisible(field, ls, v);
    return true;
  };

  const isBlank = (): boolean => {
    const s = get();
    return !s.codeVisible && !s.graphVisible && !s.bottomVisible;
  };

  // A layout to put on screen, made safe: with a blank screen not allowed, a
  // blank one becomes the graph alone (#215).
  const withGraphUnlessBlankAllowed = (p: PanelLayout): PanelLayout =>
    !get().allowBlank && !p.code && !p.graph && !p.bottom ? { ...p, graph: true } : p;

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

  const allowBlank = loadAllowBlank();
  const stored = {
    code: loadBool(LS_CODE_VISIBLE, DEFAULT_CODE_VISIBLE),
    graph: loadBool(LS_GRAPH_VISIBLE, DEFAULT_GRAPH_VISIBLE),
    bottom: loadBool(LS_BOTTOM_VISIBLE, DEFAULT_BOTTOM_VISIBLE),
  };
  // A blank layout stored while the setting was on, read now that it is off
  // (#215): the graph, so the window never opens on an unexplained blank. Not
  // written back; the next choice is stored as usual.
  if (!allowBlank && !stored.code && !stored.graph && !stored.bottom) stored.graph = true;

  return {
    codeVisible: stored.code,
    graphVisible: stored.graph,
    bottomVisible: stored.bottom,
    outerSizes: loadSizes(LS_OUTER_SIZES) ?? DEFAULT_OUTER_SIZES,
    innerSizes: loadSizes(LS_INNER_SIZES) ?? DEFAULT_INNER_SIZES,
    allowBlank,
    blankLoadPanels: loadBlankLoadPanels(),

    isBlank,
    setAllowBlank: (v) => {
      try {
        localStorage.setItem(LS_ALLOW_BLANK, String(v));
      } catch {
        // Storage blocked: the choice holds for this page.
      }
      recordSettingChanged("allow-blank-screen", v);
      set({ allowBlank: v });
      // Off while blank: the graph comes back, so the blank is never left unexplained.
      if (!v && isBlank()) persistVisible("graphVisible", LS_GRAPH_VISIBLE, true);
    },
    setBlankLoadPanels: (panels) => {
      const cleaned = BLANK_LOAD_PANEL_OPTIONS.map((o) => o.id).filter((id) => panels.includes(id));
      if (!isUsableBlankLoadPanels(cleaned)) return false;
      try {
        localStorage.setItem(LS_BLANK_LOAD_PANELS, JSON.stringify(cleaned));
      } catch {
        // Storage blocked: the choice holds for this page.
      }
      recordSettingChanged("blank-load-panels", cleaned);
      set({ blankLoadPanels: cleaned });
      return true;
    },
    showPanelsForOpen: () => {
      if (!isBlank()) return false;
      const chosen = get().blankLoadPanels;
      for (const panel of TOP_LEVEL_PANELS) {
        if (chosen.includes(panel)) persistVisible(keyFor[panel].field, keyFor[panel].ls, true);
      }
      // The Components panel opens only when chosen; otherwise it stays as it was.
      if (chosen.includes("palette")) usePaletteStore.getState().setOpen(true);
      return true;
    },

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
      applyLayout(PRESETS.everything);
    },
    restoreLayoutAfterWalkthrough: () => {
      const before = loadBeforeWalkthrough();
      if (before === null) return;
      localStorage.removeItem(LS_BEFORE_WALKTHROUGH);
      // A walkthrough started from a blank screen ends on one, unless the
      // setting was turned off meanwhile: then the graph (#215).
      applyLayout(withGraphUnlessBlankAllowed(before));
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
