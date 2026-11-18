/**
 * How the canvas's Fit button looks: Settings ▸ Appearance ▸ Canvas controls.
 * (#289)
 *
 * The corner-brackets icon by default, because a picture needs no
 * translation; the word "Fit" for anyone who finds the icon too easy to miss.
 * Either way the button is the same 26px square as the zoom buttons, and its
 * tooltip names the keys. Remembered per browser like the other appearance
 * settings; inside the Mac app the app keeps `psyneuview.` keys across
 * launches. Storage can be blocked, so every access is wrapped and the default
 * stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export type FitButtonStyle = "icon" | "word";

export const FIT_BUTTON_STYLE_KEY = "psyneuview.graph.fitButtonStyle";
export const DEFAULT_FIT_BUTTON_STYLE: FitButtonStyle = "icon";

export const FIT_BUTTON_STYLES: { id: FitButtonStyle; label: string }[] = [
  { id: "icon", label: "Icon (corner brackets)" },
  { id: "word", label: "The word “Fit”" },
];

export function isFitButtonStyle(v: unknown): v is FitButtonStyle {
  return v === "icon" || v === "word";
}

export function loadFitButtonStyle(): FitButtonStyle {
  try {
    const stored = localStorage.getItem(FIT_BUTTON_STYLE_KEY);
    return isFitButtonStyle(stored) ? stored : DEFAULT_FIT_BUTTON_STYLE;
  } catch {
    return DEFAULT_FIT_BUTTON_STYLE;
  }
}

interface FitButtonStyleState {
  style: FitButtonStyle;
  setStyle: (style: FitButtonStyle) => void;
}

export const useFitButtonStyleStore = create<FitButtonStyleState>((set) => ({
  style: loadFitButtonStyle(),
  setStyle: (style) => {
    try {
      localStorage.setItem(FIT_BUTTON_STYLE_KEY, style);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("graph-fit-button-style", style);
    set({ style });
  },
}));
