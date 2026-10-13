/**
 * UI preferences store — persisted to localStorage.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

const STORAGE_KEY = "psynewview_ui_prefs";
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

function loadInputGrouping(): InputGrouping {
  try {
    return localStorage.getItem(STORAGE_KEY + "_inputGrouping") === "byTrial"
      ? "byTrial"
      : "byNode";
  } catch {
    return "byNode";
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
  showTrialDeltas: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  editorZoomIn: () => void;
  editorZoomOut: () => void;
  toggleEdgeLabels: () => void;
  setDeveloperMode: (on: boolean) => void;
  setInputGrouping: (grouping: InputGrouping) => void;
  toggleTrialDeltas: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  inspectorFontScale: loadScale(),
  editorFontScale: loadEditorScale(),
  edgeLabelsAlwaysVisible: loadEdgeLabels(),
  developerMode: loadDeveloperMode(),
  inputGrouping: loadInputGrouping(),
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
    localStorage.setItem(STORAGE_KEY + "_inputGrouping", grouping);
    recordSettingChanged("input-grouping", grouping);
    set({ inputGrouping: grouping });
  },

  toggleTrialDeltas: () => {
    const next = !get().showTrialDeltas;
    localStorage.setItem(STORAGE_KEY + "_showTrialDeltas", String(next));
    recordSettingChanged("trial-deltas", next);
    set({ showTrialDeltas: next });
  },
}));
