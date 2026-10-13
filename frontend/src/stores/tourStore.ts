/**
 * Which guided walkthrough is running (#1181), and how it is being played
 * (#1310: paused, narrated, pointed).
 *
 * Previously the only way to start one was `?tour=<id>` on the URL, which made
 * the walkthroughs invisible to anyone who had not been told the parameter.
 * Holding it in a store instead means a menu can start one in place, without a
 * navigation — and a learner can stop one without reloading and losing the
 * model they were working on.
 *
 * The URL parameter still works, and still wins on first load: it is how a
 * walkthrough gets linked to from a doc or an issue.
 */

import { create } from "zustand";

import { recordSettingChanged } from "@/utils/activityLog";
import { loadNarrationPref, saveNarrationPref } from "@/utils/narration";

interface TourState {
  /** Id of the running walkthrough, or null when none is. */
  activeTourId: string | null;
  /** Which step of it the learner is on. */
  stepIndex: number;
  /**
   * Bumped every time a walkthrough is started, even the one already running.
   * Picking the current walkthrough again from the menu has to restart it;
   * without this the id would not change and nothing would happen.
   */
  startCount: number;
  /**
   * Whether the current step's anchor has left the canvas.
   *
   * Reported by the overlay, which owns the geometry, and consumed by the bar,
   * which owns the text — so the bar can offer a fit instead of the learner
   * hunting for a node that is not on screen.
   */
  anchorOffScreen: boolean;
  /**
   * Paused (#1310): the walkthrough stops moving on by itself, and narration
   * stops mid-line. The learner's own actions still count; a step they finish
   * while paused advances once they resume.
   */
  paused: boolean;
  /** The learner pressed Next on the current step; cleared on every advance. */
  nextPressed: boolean;
  /**
   * Bumped by Replay: the pointer glides again and the caption is read again.
   * Keyed per step by the overlay and the bar, so a replay never leaks into
   * the step after it.
   */
  replayCount: number;
  /**
   * For a pointer step, whether the pointer has reached the anchor. The bar
   * holds the instruction until then — the glide says "look here" before the
   * words do.
   */
  pointerArrived: boolean;
  /** Read captions aloud (Web Speech). Off by default; remembered per browser. */
  narration: boolean;
  startTour: (id: string) => void;
  stopTour: () => void;
  advance: () => void;
  setAnchorOffScreen: (off: boolean) => void;
  setPaused: (paused: boolean) => void;
  pressNext: () => void;
  replay: () => void;
  setPointerArrived: (arrived: boolean) => void;
  setNarration: (on: boolean) => void;
}

export const useTourStore = create<TourState>((set) => ({
  activeTourId: null,
  stepIndex: 0,
  startCount: 0,
  anchorOffScreen: false,
  paused: false,
  nextPressed: false,
  replayCount: 0,
  pointerArrived: false,
  narration: loadNarrationPref(),
  startTour: (id) =>
    set((s) => ({
      activeTourId: id,
      stepIndex: 0,
      startCount: s.startCount + 1,
      anchorOffScreen: false,
      paused: false,
      nextPressed: false,
      pointerArrived: false,
    })),
  stopTour: () =>
    set({ activeTourId: null, stepIndex: 0, anchorOffScreen: false, paused: false, nextPressed: false, pointerArrived: false }),
  advance: () =>
    set((s) => ({ stepIndex: s.stepIndex + 1, anchorOffScreen: false, nextPressed: false, pointerArrived: false })),
  setAnchorOffScreen: (off) => set({ anchorOffScreen: off }),
  setPaused: (paused) => set({ paused }),
  pressNext: () => set({ nextPressed: true }),
  replay: () => set((s) => ({ replayCount: s.replayCount + 1, pointerArrived: false })),
  setPointerArrived: (arrived) => set({ pointerArrived: arrived }),
  setNarration: (on) => {
    saveNarrationPref(on);
    recordSettingChanged("walkthrough-narration", on);
    set({ narration: on });
  },
}));

/** The `?tour=<id>` seed, read once at startup. */
export function tourIdFromUrl(search: string): string | null {
  return new URLSearchParams(search).get("tour");
}
