/**
 * How big the app's text is: Settings ▸ Appearance ▸ Text size. (#111)
 *
 * One setting, three sizes. Every UI font size is written as a CSS variable
 * (`var(--pnv-fs-12)` in place of `12`), defined in index.css as that size
 * times `--pnv-text-scale`; this store sets the scale on <html>. Small is the
 * app's original size; Default is 10% larger, so body text reads at about
 * 14–15 px, the way Mac apps do. The code editor and the Inspector, which
 * have their own A− A+ steps, multiply this scale too, so they rise in step.
 * The graph's node and edge labels don't change: they belong to the canvas,
 * which has its own zoom.
 *
 * Remembered per browser, like the node outline width. Storage can be
 * blocked, so every access is wrapped and the default stands in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export const TEXT_SIZE_KEY = "psyneuview.appearance.textSize";

export const TEXT_SIZES = ["small", "default", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const DEFAULT_TEXT_SIZE: TextSize = "default";

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  small: "Small",
  default: "Default",
  large: "Large",
};

/** The multiplier each size applies to the app's base font sizes. */
export const TEXT_SCALES: Record<TextSize, number> = {
  small: 1,
  default: 1.1,
  large: 1.2,
};

export function isTextSize(v: unknown): v is TextSize {
  return typeof v === "string" && (TEXT_SIZES as readonly string[]).includes(v);
}

function load(): TextSize {
  try {
    const v = localStorage.getItem(TEXT_SIZE_KEY);
    return isTextSize(v) ? v : DEFAULT_TEXT_SIZE;
  } catch {
    return DEFAULT_TEXT_SIZE;
  }
}

/** Put the scale on <html>, where index.css's --pnv-fs-* read it. */
export function applyTextScale(size: TextSize): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--pnv-text-scale", String(TEXT_SCALES[size]));
}

interface TextSizeState {
  size: TextSize;
  setSize: (size: TextSize) => void;
}

export const useTextSizeStore = create<TextSizeState>((set, get) => ({
  size: load(),
  setSize: (size) => {
    if (!isTextSize(size)) return;
    try {
      localStorage.setItem(TEXT_SIZE_KEY, size);
    } catch {
      // Storage blocked: the choice holds for this page only.
    }
    if (get().size !== size) recordSettingChanged("text-size", size);
    applyTextScale(size);
    set({ size });
  },
}));

applyTextScale(useTextSizeStore.getState().size);

/** The multiplier in force, for sizes computed in script (editor, Inspector). */
export function useTextScale(): number {
  return useTextSizeStore((s) => TEXT_SCALES[s.size]);
}
