/**
 * How a walkthrough marks what a step points at: Settings ▸ Tutorials and
 * Voice ▸ Highlight (#100).
 *
 * The ring is the highlight: thicker than it was, and pulsing to draw the eye.
 * The gliding arrow is optional and off by default, since testers took it for
 * their own pointer, which changes into a hand or a text cursor as it moves.
 *
 * Remembered per browser, like the graph pointer (graphPointerStore.ts); the
 * Mac app keeps `psyneuview.*` keys across launches (#218). Storage can be
 * blocked, so every access is wrapped and the defaults stand in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export const RING_THICKNESSES = [
  { id: "thin", label: "Thin", px: 2 },
  { id: "medium", label: "Medium", px: 4 },
  { id: "thick", label: "Thick", px: 6 },
] as const;
export type RingThickness = (typeof RING_THICKNESSES)[number]["id"];

export const RING_PULSES = [
  { id: "off", label: "Off" },
  { id: "gentle", label: "Gentle" },
  { id: "strong", label: "Strong" },
] as const;
export type RingPulse = (typeof RING_PULSES)[number]["id"];

/** Each colour is a palette token (styles/palette.css), never a literal. */
export const RING_COLORS = [
  { id: "blue", label: "Blue", token: "var(--pnv-walkthrough-current)" },
  { id: "orange", label: "Orange", token: "var(--pnv-walkthrough-ring-orange)" },
  { id: "purple", label: "Purple", token: "var(--pnv-walkthrough-ring-purple)" },
  { id: "magenta", label: "Magenta", token: "var(--pnv-walkthrough-ring-magenta)" },
] as const;
export type RingColor = (typeof RING_COLORS)[number]["id"];

export const DEFAULT_RING_THICKNESS: RingThickness = "medium";
export const DEFAULT_RING_PULSE: RingPulse = "gentle";
export const DEFAULT_RING_COLOR: RingColor = "blue";
export const DEFAULT_SHOW_ARROW = false;

export const RING_THICKNESS_KEY = "psyneuview.tour.ringThickness";
export const RING_PULSE_KEY = "psyneuview.tour.ringPulse";
export const RING_COLOR_KEY = "psyneuview.tour.ringColor";
export const SHOW_ARROW_KEY = "psyneuview.tour.showArrow";

function load<T extends string>(key: string, allowed: readonly { id: T }[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.some((a) => a.id === v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadArrow(): boolean {
  try {
    const v = localStorage.getItem(SHOW_ARROW_KEY);
    return v === null ? DEFAULT_SHOW_ARROW : v === "on";
  } catch {
    return DEFAULT_SHOW_ARROW;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice holds for this page. Nothing else to do.
  }
}

/** The ring's border width in pixels. */
export function ringWidth(t: RingThickness): number {
  return RING_THICKNESSES.find((r) => r.id === t)?.px ?? 4;
}

/** The ring's colour, as a palette token. */
export function ringColor(c: RingColor): string {
  return RING_COLORS.find((r) => r.id === c)?.token ?? RING_COLORS[0].token;
}

interface TourHighlightState {
  thickness: RingThickness;
  pulse: RingPulse;
  color: RingColor;
  showArrow: boolean;
  setThickness: (t: RingThickness) => void;
  setPulse: (p: RingPulse) => void;
  setColor: (c: RingColor) => void;
  setShowArrow: (on: boolean) => void;
}

export const useTourHighlightStore = create<TourHighlightState>((set) => ({
  thickness: load(RING_THICKNESS_KEY, RING_THICKNESSES, DEFAULT_RING_THICKNESS),
  pulse: load(RING_PULSE_KEY, RING_PULSES, DEFAULT_RING_PULSE),
  color: load(RING_COLOR_KEY, RING_COLORS, DEFAULT_RING_COLOR),
  showArrow: loadArrow(),
  setThickness: (thickness) => {
    remember(RING_THICKNESS_KEY, thickness);
    recordSettingChanged("walkthrough-ring-thickness", thickness);
    set({ thickness });
  },
  setPulse: (pulse) => {
    remember(RING_PULSE_KEY, pulse);
    recordSettingChanged("walkthrough-ring-pulse", pulse);
    set({ pulse });
  },
  setColor: (color) => {
    remember(RING_COLOR_KEY, color);
    recordSettingChanged("walkthrough-ring-color", color);
    set({ color });
  },
  setShowArrow: (showArrow) => {
    remember(SHOW_ARROW_KEY, showArrow ? "on" : "off");
    recordSettingChanged("walkthrough-arrow", showArrow ? "on" : "off");
    set({ showArrow });
  },
}));
