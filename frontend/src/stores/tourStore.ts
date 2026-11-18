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
import type { TutorialProgress } from "@/utils/tutorialProgress";

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
  /**
   * The model file this walkthrough is using (#172): its own fresh copy of a
   * bundled model, or the file the learner created in a step that teaches New
   * Model. Null until it has one, and for a walkthrough that uses none.
   */
  modelPath: string | null;
  /**
   * The code as the current step began (#172), so the bar can offer to undo
   * the learner's edits since then. Taken when the step starts, or when the
   * walkthrough's model opens during it; `key` names the step.
   */
  stepStart: { key: string; filePath: string; source: string } | null;
  /** A fingerprint of the walkthrough's model as its fresh copy opened (#173). */
  modelFresh: string | null;
  /**
   * Resuming a saved place (#173): the step is set at once; its code goes into
   * the walkthrough's own copy once that has opened. Null when not resuming.
   */
  resuming: TutorialProgress | null;
  /** A word from the app in the bar until the step moves on (#173: why it started over). */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  startTour: (id: string) => void;
  /** Start the walkthrough at a saved place (#173). */
  resumeTour: (id: string, progress: TutorialProgress) => void;
  /** The saved place is in, or turned out not to fit. */
  doneResuming: () => void;
  stopTour: () => void;
  advance: () => void;
  setAnchorOffScreen: (off: boolean) => void;
  setPaused: (paused: boolean) => void;
  pressNext: () => void;
  replay: () => void;
  setPointerArrived: (arrived: boolean) => void;
  setNarration: (on: boolean) => void;
  setModelPath: (path: string | null, fresh?: string | null) => void;
  setStepStart: (start: TourState["stepStart"]) => void;
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
  modelPath: null,
  stepStart: null,
  modelFresh: null,
  resuming: null,
  notice: null,
  setNotice: (notice) => set({ notice }),
  startTour: (id) =>
    set((s) => ({
      activeTourId: id,
      stepIndex: 0,
      startCount: s.startCount + 1,
      anchorOffScreen: false,
      paused: false,
      nextPressed: false,
      pointerArrived: false,
      modelPath: null,
      stepStart: null,
      modelFresh: null,
      resuming: null,
      notice: null,
    })),
  resumeTour: (id, progress) =>
    set((s) => ({
      activeTourId: id,
      stepIndex: progress.step,
      startCount: s.startCount + 1,
      anchorOffScreen: false,
      paused: false,
      nextPressed: false,
      pointerArrived: false,
      modelPath: null,
      stepStart: null,
      modelFresh: null,
      resuming: progress,
      notice: null,
    })),
  doneResuming: () => set({ resuming: null }),
  stopTour: () =>
    set({
      activeTourId: null,
      stepIndex: 0,
      anchorOffScreen: false,
      paused: false,
      nextPressed: false,
      pointerArrived: false,
      modelPath: null,
      stepStart: null,
      modelFresh: null,
      resuming: null,
      notice: null,
    }),
  advance: () =>
    set((s) => ({ stepIndex: s.stepIndex + 1, anchorOffScreen: false, nextPressed: false, pointerArrived: false, notice: null })),
  setAnchorOffScreen: (off) => set({ anchorOffScreen: off }),
  setPaused: (paused) => set({ paused }),
  pressNext: () => set({ nextPressed: true }),
  replay: () => set((s) => ({ replayCount: s.replayCount + 1, pointerArrived: false })),
  setPointerArrived: (arrived) => set({ pointerArrived: arrived }),
  setModelPath: (path, fresh) => set(fresh === undefined ? { modelPath: path } : { modelPath: path, modelFresh: fresh }),
  setStepStart: (start) => set({ stepStart: start }),
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
