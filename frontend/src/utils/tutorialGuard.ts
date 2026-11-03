/**
 * Keep a walkthrough and its model together (#172).
 *
 * A walkthrough is written for one model, but nothing stopped the learner
 * opening another mid-way: it carried on, and only a step pointing at a missing
 * node said anything. Nor did starting one ask about the work it replaced.
 *
 * So everything that replaces the model asks `guardOpen` first, and the
 * Tutorials menu asks `chooseTutorialStart`. Each answers at once when there is
 * nothing to protect, and otherwise waits on the choice TutorialChoiceDialog
 * shows.
 *
 * The app reads a step's `act` here, as the bar does for `openModel`: a step
 * that teaches opening a model is the one place opening it isn't leaving.
 */

import { create } from "zustand";

import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useModelStore } from "@/stores/modelStore";
import { useTourStore } from "@/stores/tourStore";
import { canOpenAppWindow, openAppWindow } from "./appWindow";
import { getWalkthrough, type TourStep, type Walkthrough } from "./tourStep";

/** What the learner is about to open. */
export type OpenTarget =
  /** A model from the Open menu's catalog. */
  | { kind: "catalog"; label: string; file?: string | null }
  /** A file by its path: a new window can open it too. */
  | { kind: "path"; path: string }
  | { kind: "newModel" }
  /** A file only this window holds (a drop, a picker, GitHub), by its name. */
  | { kind: "file"; name: string };

export type LeaveChoice = "newWindow" | "here" | "stay";
export type StartChoice = "newWindow" | "here" | "cancel";

export type PendingChoice =
  | {
      type: "leave";
      tutorial: string;
      step: number;
      steps: number;
      what: string;
      canOpenWindow: boolean;
      resolve: (choice: LeaveChoice) => void;
    }
  | {
      type: "start";
      tutorial: string;
      /** Why it can't have a window of its own, when it can't. */
      noWindowReason: string | null;
      resolve: (choice: StartChoice) => void;
    };

export const useTutorialChoice = create<{ pending: PendingChoice | null }>(() => ({ pending: null }));

const baseName = (p: string | null | undefined) => (p ? p.split("/").pop() ?? null : null);

/** Whether the walkthrough works on a model, one it opens or one it has the learner start. */
export function needsModel(w: Walkthrough): boolean {
  return !!w.model || w.steps.some((s) => s.act?.openModel || s.act?.newModel);
}

/** Whether this step is the one that asks for this very thing to be opened. */
export function stepAsksFor(step: TourStep | null, target: OpenTarget): boolean {
  if (!step?.act) return false;
  if (target.kind === "catalog") return step.act.openModel === target.label;
  if (target.kind === "newModel") return !!step.act.newModel;
  return false;
}

/** Whether the target is the file already open: reloading it leaves nothing. */
export function isSameFile(target: OpenTarget, filePath: string | null | undefined): boolean {
  const open = baseName(filePath);
  if (!open) return false;
  if (target.kind === "path") return target.path === filePath;
  if (target.kind === "catalog") return baseName(target.file) === open;
  return false;
}

/** The address that opens the target in a window of its own, if one can. */
export function windowUrlFor(target: OpenTarget): string | null {
  if (target.kind === "catalog") return `?openModel=${encodeURIComponent(target.label)}`;
  if (target.kind === "path") return `?open=${encodeURIComponent(target.path)}`;
  if (target.kind === "newModel") return "?newModel=1";
  return null;
}

function nameOf(target: OpenTarget): string {
  if (target.kind === "catalog") return target.label;
  if (target.kind === "path") return baseName(target.path) ?? target.path;
  if (target.kind === "newModel") return "a new model";
  return target.name;
}

function ask<C>(build: (resolve: (choice: C) => void) => PendingChoice): Promise<C> {
  return new Promise((resolve) => {
    const pending = build((choice) => {
      useTutorialChoice.setState({ pending: null });
      resolve(choice);
    });
    useTutorialChoice.setState({ pending });
  });
}

/**
 * Asks before something replaces the model a walkthrough is using. True means
 * go ahead and open it here; false means it was handled or declined.
 */
export async function guardOpen(target: OpenTarget): Promise<boolean> {
  const { activeTourId, stepIndex, stopTour } = useTourStore.getState();
  const walkthrough = getWalkthrough(activeTourId);
  if (!walkthrough || !needsModel(walkthrough)) return true;
  const step = walkthrough.steps[stepIndex] ?? null;
  // Past the last step: the bar is only saying it's finished.
  if (!step) return true;
  if (stepAsksFor(step, target) || isSameFile(target, useModelStore.getState().filePath)) return true;

  const url = windowUrlFor(target);
  const choice = await ask<LeaveChoice>((resolve) => ({
    type: "leave",
    tutorial: walkthrough.title,
    step: stepIndex + 1,
    steps: walkthrough.steps.length,
    what: nameOf(target),
    canOpenWindow: url !== null && canOpenAppWindow(),
    resolve,
  }));
  if (choice === "newWindow" && url) openAppWindow(url);
  if (choice !== "here") return false;
  stopTour();
  return true;
}

/** Whether the window holds work a walkthrough shouldn't replace unasked. */
export function hasWorkInProgress(): boolean {
  const { filePath, source, savedSource } = useModelStore.getState();
  if (!filePath) return false;
  if (source !== savedSource) return true;
  return !useCatalogOpener.getState().isUntouched?.();
}

/**
 * Starts a walkthrough: here when nothing is in progress, and otherwise where
 * the learner chooses.
 */
export async function chooseTutorialStart(id: string): Promise<void> {
  const { activeTourId, startTour } = useTourStore.getState();
  const walkthrough = getWalkthrough(id);
  const running = activeTourId !== id ? getWalkthrough(activeTourId) : null;
  const inProgress =
    (running !== null && needsModel(running)) || (!!walkthrough && needsModel(walkthrough) && hasWorkInProgress());
  if (!walkthrough || !inProgress) {
    startTour(id);
    return;
  }

  // A second window on the same file would overwrite the copy this one has.
  const sameModel = !!walkthrough.model && !!useCatalogOpener.getState().isOpen?.(walkthrough.model);
  const noWindowReason = sameModel
    ? "It uses the model that's open here, so it can't run in a second window."
    : canOpenAppWindow()
      ? null
      : "This version of the app can't open a second window from here.";
  const choice = await ask<StartChoice>((resolve) => ({
    type: "start",
    tutorial: walkthrough.title,
    noWindowReason,
    resolve,
  }));
  if (choice === "newWindow") openAppWindow(`?tour=${encodeURIComponent(id)}`);
  else if (choice === "here") startTour(id);
}
