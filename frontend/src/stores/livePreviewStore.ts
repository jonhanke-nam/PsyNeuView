/**
 * When the graph updates from the code you are typing (#255).
 *
 * The editor rebuilds the graph from its unsaved text once typing pauses: the
 * "live preview" (#1029). It had no setting, and it ran whatever autosave was
 * set to. Off means the graph updates when you save.
 */
import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export const LIVE_PREVIEW_KEY = "psyneuview.editor.livePreviewMs";
export const DEFAULT_LIVE_PREVIEW_MS = 1500;
export const LIVE_PREVIEW_DELAYS: { ms: number; label: string }[] = [
  { ms: 0, label: "Off: when you save" },
  { ms: 500, label: "After 0.5 s" },
  { ms: 1000, label: "After 1 s" },
  { ms: 1500, label: "After 1.5 s" },
  { ms: 3000, label: "After 3 s" },
];

export function loadLivePreviewMs(): number {
  try {
    const stored = localStorage.getItem(LIVE_PREVIEW_KEY);
    const n = Number(stored);
    return stored !== null && LIVE_PREVIEW_DELAYS.some((d) => d.ms === n) ? n : DEFAULT_LIVE_PREVIEW_MS;
  } catch {
    return DEFAULT_LIVE_PREVIEW_MS;
  }
}

interface LivePreviewState {
  /** Milliseconds after typing pauses; 0 is off. */
  delayMs: number;
  setDelayMs: (ms: number) => void;
}

export const useLivePreviewStore = create<LivePreviewState>((set) => ({
  delayMs: loadLivePreviewMs(),
  setDelayMs: (ms) => {
    try {
      localStorage.setItem(LIVE_PREVIEW_KEY, String(ms));
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("live-preview", String(ms));
    set({ delayMs: ms });
  },
}));
