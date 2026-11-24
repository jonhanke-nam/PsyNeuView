/**
 * UI preferences store — persisted to localStorage.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

const STORAGE_KEY = "psyneuview_ui_prefs";
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.5;
const STEP = 0.1;

function loadScale(): number {
  try {
    const val = parseFloat(localStorage.getItem(STORAGE_KEY + "_fontScale") || "1");
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, val));
  } catch {
    return 1;
  }
}

function loadEditorScale(): number {
  try {
    const val = parseFloat(localStorage.getItem(STORAGE_KEY + "_editorFontScale") || "1");
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, val));
  } catch {
    return 1;
  }
}

function loadEdgeLabels(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY + "_edgeLabels") !== "hover";
  } catch {
    return true;
  }
}

function loadDeveloperMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY + "_developerMode") === "true";
  } catch {
    return false;
  }
}

export type InputGrouping = "byNode" | "byTrial";

export const INPUT_GROUPING_KEY = STORAGE_KEY + "_inputGrouping";

/**
 * How the Run panel arranges its inputs (#570). By trial is the default
 * (#331): each trial's inputs read together, as one trial's line of
 * `Composition.run`'s inputs. Only a stored "byNode" is a choice kept from
 * before; anything else, a missing key included, is the default.
 */
export function loadInputGrouping(): InputGrouping {
  try {
    return localStorage.getItem(INPUT_GROUPING_KEY) === "byNode" ? "byNode" : "byTrial";
  } catch {
    return "byTrial";
  }
}

/**
 * Settings ▸ General ▸ Run inputs (#330): edit each element of a trial's
 * input in its own box, as before, instead of typing the whole array in
 * bracket notation. Off by default. A `psyneuview.` key, so the Mac app
 * keeps it across launches.
 */
export const INPUT_CELL_GRID_KEY = "psyneuview.run.inputCellGrid";

export function loadInputCellGrid(): boolean {
  try {
    return localStorage.getItem(INPUT_CELL_GRID_KEY) === "true";
  } catch {
    return false;
  }
}

// #786: the trial-to-trial Δ diff (#466) is only meaningful for sequential /
// converging runs; off by default so it doesn't add noise on unrelated trials.
function loadShowTrialDeltas(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY + "_showTrialDeltas") === "true";
  } catch {
    return false;
  }
}

interface UIState {
  inspectorFontScale: number;
  editorFontScale: number;
  edgeLabelsAlwaysVisible: boolean;
  developerMode: boolean;
  inputGrouping: InputGrouping;
  inputCellGrid: boolean;
  showTrialDeltas: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  editorZoomIn: () => void;
  editorZoomOut: () => void;
  toggleEdgeLabels: () => void;
  setDeveloperMode: (on: boolean) => void;
  setInputGrouping: (grouping: InputGrouping) => void;
  setInputCellGrid: (on: boolean) => void;
  toggleTrialDeltas: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  inspectorFontScale: loadScale(),
  editorFontScale: loadEditorScale(),
  edgeLabelsAlwaysVisible: loadEdgeLabels(),
  developerMode: loadDeveloperMode(),
  inputGrouping: loadInputGrouping(),
  inputCellGrid: loadInputCellGrid(),
  showTrialDeltas: loadShowTrialDeltas(),

  zoomIn: () => {
    const next = Math.min(MAX_SCALE, Math.round((get().inspectorFontScale + STEP) * 10) / 10);
    localStorage.setItem(STORAGE_KEY + "_fontScale", String(next));
    set({ inspectorFontScale: next });
  },

  zoomOut: () => {
    const next = Math.max(MIN_SCALE, Math.round((get().inspectorFontScale - STEP) * 10) / 10);
    localStorage.setItem(STORAGE_KEY + "_fontScale", String(next));
    set({ inspectorFontScale: next });
  },

  editorZoomIn: () => {
    const next = Math.min(MAX_SCALE, Math.round((get().editorFontScale + STEP) * 10) / 10);
    localStorage.setItem(STORAGE_KEY + "_editorFontScale", String(next));
    set({ editorFontScale: next });
  },

  editorZoomOut: () => {
    const next = Math.max(MIN_SCALE, Math.round((get().editorFontScale - STEP) * 10) / 10);
    localStorage.setItem(STORAGE_KEY + "_editorFontScale", String(next));
    set({ editorFontScale: next });
  },
  toggleEdgeLabels: () => {
    const next = !get().edgeLabelsAlwaysVisible;
    localStorage.setItem(STORAGE_KEY + "_edgeLabels", next ? "always" : "hover");
    recordSettingChanged("edge-labels", next ? "always" : "hover");
    set({ edgeLabelsAlwaysVisible: next });
  },

  setDeveloperMode: (on: boolean) => {
    localStorage.setItem(STORAGE_KEY + "_developerMode", String(on));
    if (get().developerMode !== on) recordSettingChanged("developer-mode", on);
    set({ developerMode: on });
  },

  setInputGrouping: (grouping: InputGrouping) => {
    try {
      localStorage.setItem(INPUT_GROUPING_KEY, grouping);
    } catch {
      // Storage blocked: the choice lasts this session.
    }
    recordSettingChanged("input-grouping", grouping);
    set({ inputGrouping: grouping });
  },

  setInputCellGrid: (on: boolean) => {
    try {
      localStorage.setItem(INPUT_CELL_GRID_KEY, String(on));
    } catch {
      // Storage blocked: the choice lasts this session.
    }
    if (get().inputCellGrid !== on) recordSettingChanged("run-input-cell-grid", on);
    set({ inputCellGrid: on });
  },

  toggleTrialDeltas: () => {
    const next = !get().showTrialDeltas;
    localStorage.setItem(STORAGE_KEY + "_showTrialDeltas", String(next));
    recordSettingChanged("trial-deltas", next);
    set({ showTrialDeltas: next });
  },
}));
