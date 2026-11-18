/**
 * Where a learner left each tutorial (#173), so starting it again can offer
 * **Resume at step N**.
 *
 * Kept per browser, one entry per tutorial, so it lasts between sessions and
 * starting a different tutorial loses nothing. Finishing a tutorial clears its
 * entry; so does starting it over.
 *
 * What's kept is the step and the code as that step began (#172's
 * `stepStart`), so the steps still match when the learner comes back. The
 * code goes into the tutorial's own fresh copy of its model, never into a
 * file of the learner's: a tutorial that has the learner create a model keeps
 * only that file's path, and resuming opens it as it is.
 *
 * A saved place may no longer fit: the tutorial's steps or its bundled model
 * changed in an update. Then the app says so and starts over, rather than
 * resuming into a broken step.
 */

import type { Walkthrough } from "./tourStep";

export const PROGRESS_KEY = "psyneuview.tutorials.progress";

export interface TutorialProgress {
  /** The step to resume at, 0-based. */
  step: number;
  /** That step's id, and every step's: a changed tutorial doesn't fit. */
  stepId: string;
  steps: string;
  /** The code as the step began, for the tutorial's own copy; null when no model was open yet. */
  code: string | null;
  /** A fingerprint of the bundled model as it opened fresh: a changed model doesn't fit. */
  fresh: string | null;
  /** A model the learner created in the tutorial (New Model): opened as it is, never written. */
  file: string | null;
  /** When it was saved, for the record. */
  at: number;
}

type Store = Record<string, TutorialProgress>;

function readAll(): Store {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Store): void {
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(PROGRESS_KEY);
    else localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked or full: the tutorial still runs, it just can't be resumed.
  }
}

export function loadProgress(id: string): TutorialProgress | null {
  const p = readAll()[id];
  return p && typeof p.step === "number" && typeof p.stepId === "string" ? p : null;
}

export function saveProgress(id: string, progress: TutorialProgress): void {
  const all = readAll();
  all[id] = progress;
  writeAll(all);
}

export function clearProgress(id: string): void {
  const all = readAll();
  if (!(id in all)) return;
  delete all[id];
  writeAll(all);
}

/** Every step's id, in order: the shape a saved place has to fit. */
export function stepsFingerprint(w: Walkthrough): string {
  return w.steps.map((s) => s.id).join("|");
}

/** A short fingerprint of a model's code (FNV-1a), to notice a bundled model that changed. */
export function codeFingerprint(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Whether a saved place still fits the tutorial as it is now. The model is
 * checked later, once its fresh copy has opened (`fresh`).
 */
export function fitsWalkthrough(w: Walkthrough, p: TutorialProgress): boolean {
  return p.step > 0 && p.step < w.steps.length && w.steps[p.step].id === p.stepId && p.steps === stepsFingerprint(w);
}

/** What the bar and the store need to note this place. */
export function progressFor(
  w: Walkthrough,
  stepIndex: number,
  code: string | null,
  fresh: string | null,
  file: string | null,
): TutorialProgress {
  return {
    step: stepIndex,
    stepId: w.steps[stepIndex]?.id ?? "",
    steps: stepsFingerprint(w),
    code,
    fresh,
    file,
    at: Date.now(),
  };
}

/** Said when a saved place no longer fits, and the tutorial starts over instead. */
export const STALE_MESSAGE = (title: string) =>
  `"${title}" changed since you left it, so it starts again from the beginning.`;
