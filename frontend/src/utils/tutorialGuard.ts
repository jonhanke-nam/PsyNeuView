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
 * A step that teaches opening a model says so with `opens:` in the tutorial
 * file, and is the one place opening it isn't leaving. (It used to be read
 * from `act`, which is the test driver's.)
 *
 * The rest of #172 lives here too: which file the walkthrough is using (its
 * own fresh copy of a bundled model), the offer to save before replacing
 * unsaved work, and the bar's ways back: undo this step's edits, start over,
 * go back to the tutorial's model. And #173's question on starting one that
 * was left part-way: resume at step N, or start over.
 */

import { create } from "zustand";

import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useModelStore } from "@/stores/modelStore";
import { useTourStore } from "@/stores/tourStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { canOpenAppWindow, openAppWindow, openPathAddress } from "./appWindow";
import { recordAction } from "./history";
import { requestSave } from "./saveRequest";
import { getWalkthrough, OPENS_NEW_MODEL, type TourStep, type Walkthrough } from "./tourStep";
import {
  clearProgress,
  codeFingerprint,
  fitsWalkthrough,
  loadProgress,
  STALE_MESSAGE,
  type TutorialProgress,
} from "./tutorialProgress";

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
export type SaveChoice = "save" | "discard" | "cancel";
export type ResumeChoice = "resume" | "over" | "cancel";

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
    }
  | {
      /** A tutorial left part-way (#173): resume at its step, or start over? */
      type: "resume";
      tutorial: string;
      step: number;
      steps: number;
      resolve: (choice: ResumeChoice) => void;
    }
  | {
      /** Replacing unsaved work (#172): save it first? */
      type: "save";
      what: string;
      resolve: (choice: SaveChoice) => void;
    };

export const useTutorialChoice = create<{ pending: PendingChoice | null }>(() => ({ pending: null }));

const baseName = (p: string | null | undefined) => (p ? p.split("/").pop() ?? null : null);

/** Whether the walkthrough works on a model, one it opens or one it has the learner start. */
export function needsModel(w: Walkthrough): boolean {
  return !!w.model || w.steps.some((s) => !!s.opens);
}

/** The catalog model this step teaches opening, if it teaches opening one. */
export function stepOpensCatalog(step: TourStep | null | undefined): string | null {
  return step?.opens && step.opens !== OPENS_NEW_MODEL ? step.opens : null;
}

/** Whether this step is the one that asks for this very thing to be opened. */
export function stepAsksFor(step: TourStep | null, target: OpenTarget): boolean {
  if (!step?.opens) return false;
  if (target.kind === "catalog") return step.opens === target.label;
  if (target.kind === "newModel") return step.opens === OPENS_NEW_MODEL;
  return false;
}

/** The running walkthrough and its current step, if one is running. */
function current(): { walkthrough: Walkthrough; step: TourStep | null } | null {
  const { activeTourId, stepIndex } = useTourStore.getState();
  const walkthrough = getWalkthrough(activeTourId);
  return walkthrough ? { walkthrough, step: walkthrough.steps[stepIndex] ?? null } : null;
}

/**
 * The walkthrough to open this catalog model for, as a fresh copy of its own
 * (#172): the running one, when the model is its model or the one this step
 * teaches opening. Null opens the shared working copy, as outside a tutorial.
 */
export function tutorialCopyFor(label: string): string | null {
  const now = current();
  if (!now) return null;
  return now.walkthrough.model === label || stepOpensCatalog(now.step) === label ? now.walkthrough.id : null;
}

/** Files this window opened as a walkthrough's own copy. */
const tutorialCopies = new Set<string>();

/** Whether this file is a walkthrough's own copy, opened in this window. */
export function isTutorialCopy(path: string | null | undefined): boolean {
  return !!path && tutorialCopies.has(path);
}

/** The walkthrough's model is now this file: its own copy opened, or the model a step had the learner create. */
export function noteTutorialModel(
  path: string,
  { copy = false, source }: { copy?: boolean; source?: string } = {},
): void {
  if (!useTourStore.getState().activeTourId) return;
  if (copy) tutorialCopies.add(path);
  // A fresh copy's fingerprint lets a resume notice the bundled model changed (#173).
  useTourStore.getState().setModelPath(path, copy && source !== undefined ? codeFingerprint(source) : undefined);
}

/**
 * The open file was saved as another, which is now the open one. A
 * walkthrough using it follows it there, rather than warning that its model
 * went away.
 */
export function followSavedCopy(from: string | null, to: string): void {
  if (from && useTourStore.getState().modelPath === from) useTourStore.getState().setModelPath(to);
}

/** A New Model created while the step teaching it shows is the walkthrough's model. */
export function noteNewModel(path: string): void {
  const now = current();
  if (now && now.step?.opens === OPENS_NEW_MODEL) noteTutorialModel(path);
}

/**
 * Whether the window has moved off the walkthrough's model (#172) by a route
 * nothing asked about. The steps wait, and the bar offers the way back.
 */
export function offTutorialModel(
  walkthrough: Walkthrough | null,
  modelPath: string | null,
  filePath: string | null,
): boolean {
  return !!walkthrough && !!modelPath && needsModel(walkthrough) && filePath !== modelPath;
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
  if (target.kind === "path") return openPathAddress(target.path);
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

/** Opens the window. A browser can block one, and the learner chose this, so say so. */
function openWindowOrSay(search: string | null) {
  if (search !== null && openAppWindow(search)) return;
  useNotificationStore.getState().addNotification("error", "The new window didn't open. Your browser may have blocked it.");
}

/**
 * Asks before something replaces the model a walkthrough is using. True means
 * go ahead and open it here; false means it was handled or declined.
 */
export async function guardOpen(target: OpenTarget): Promise<boolean> {
  const { activeTourId, stepIndex, stopTour, modelPath } = useTourStore.getState();
  const walkthrough = getWalkthrough(activeTourId);
  if (!walkthrough || !needsModel(walkthrough)) return true;
  const step = walkthrough.steps[stepIndex] ?? null;
  // Past the last step: the bar is only saying it's finished.
  if (!step) return true;
  if (stepAsksFor(step, target) || isSameFile(target, useModelStore.getState().filePath)) return true;
  // Going back to the walkthrough's own model is staying, not leaving.
  if (target.kind === "path" && target.path === modelPath) return true;

  const choice = await ask<LeaveChoice>((resolve) => ({
    type: "leave",
    tutorial: walkthrough.title,
    step: stepIndex + 1,
    steps: walkthrough.steps.length,
    what: nameOf(target),
    canOpenWindow: target.kind !== "file" && canOpenAppWindow(),
    resolve,
  }));
  if (choice === "newWindow") openWindowOrSay(windowUrlFor(target));
  if (choice !== "here") return false;
  if (!(await offerToSave())) return false;
  stopTour();
  return true;
}

/**
 * The open file and its unsaved text the learner chose not to save (#172), so
 * the unsaved-changes prompt doesn't ask the same question again.
 */
let discardApproved: { filePath: string; source: string } | null = null;

/** Whether the learner already chose to discard exactly these unsaved changes. */
export function discardIsApproved(): boolean {
  const { filePath, source } = useModelStore.getState();
  return !!discardApproved && discardApproved.filePath === filePath && discardApproved.source === source;
}

/**
 * Before replacing what's in this window (#172): with unsaved changes, offer
 * to save them first, rather than only warning they will be lost. True means
 * go ahead: saved, nothing to save, or the learner chose not to.
 */
export async function offerToSave(): Promise<boolean> {
  const { filePath, source, savedSource } = useModelStore.getState();
  if (!filePath || source === savedSource) return true;
  const choice = await ask<SaveChoice>((resolve) => ({
    type: "save",
    what: baseName(filePath) ?? filePath,
    resolve,
  }));
  if (choice === "cancel") return false;
  if (choice === "discard") {
    discardApproved = { filePath, source };
    return true;
  }
  const heard = await requestSave();
  const after = useModelStore.getState();
  if (heard && after.source === after.savedSource) return true;
  useNotificationStore
    .getState()
    .addNotification("error", "Your changes weren't saved, so nothing was replaced. Save them, then try again.");
  return false;
}

/**
 * Undo my edits since this step began (#172): put the code back as it was when
 * the step started, through Save, as reverting to a save does. The edits are
 * one Undo away in History.
 */
export async function undoStepEdits(): Promise<boolean> {
  const start = useTourStore.getState().stepStart;
  const store = useModelStore.getState();
  if (!start || store.filePath !== start.filePath) return false;
  if (store.source === start.source && store.savedSource === start.source) return true;
  store.setSource(start.source);
  recordAction("Undid my edits since this tutorial step began");
  const heard = await requestSave({ source: start.source });
  if (!heard) {
    useNotificationStore
      .getState()
      .addNotification("error", "Couldn't save: the code editor isn't open. The editor holds the step's code; press Save to write it.");
    return false;
  }
  return useModelStore.getState().savedSource === start.source;
}

/** Start the tutorial over (#172): step 1, and a fresh copy of its model. */
export function startTutorialOver(): void {
  const { activeTourId, startTour } = useTourStore.getState();
  if (!activeTourId) return;
  clearProgress(activeTourId); // #173: no place to resume at either
  startTour(activeTourId);
}

/** Go back to the tutorial's model (#172), after something else replaced it. */
export async function returnToTutorialModel(): Promise<void> {
  const { modelPath } = useTourStore.getState();
  const openPath = useCatalogOpener.getState().openPath;
  if (modelPath && openPath) await openPath(modelPath);
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
  const { activeTourId } = useTourStore.getState();
  const walkthrough = getWalkthrough(id);

  // #173: left part-way before? Resume at that step (the default), or start over.
  // Not when picking the one already running: that is starting it over.
  let resume: TutorialProgress | null = null;
  if (walkthrough && activeTourId !== id) {
    const saved = savedPlace(walkthrough);
    if (saved) {
      const choice = await ask<ResumeChoice>((resolve) => ({
        type: "resume",
        tutorial: walkthrough.title,
        step: saved.step + 1,
        steps: walkthrough.steps.length,
        resolve,
      }));
      if (choice === "cancel") return;
      if (choice === "over") clearProgress(id);
      else resume = saved;
    }
  }
  const begin = () => {
    if (resume) useTourStore.getState().resumeTour(id, resume);
    else useTourStore.getState().startTour(id);
    sayWhyItStartedOver();
  };

  const running = activeTourId !== id ? getWalkthrough(activeTourId) : null;
  const inProgress =
    (running !== null && needsModel(running)) || (!!walkthrough && needsModel(walkthrough) && hasWorkInProgress());
  if (!walkthrough || !inProgress) {
    begin();
    return;
  }

  // The walkthrough opens its own copy (#172), so a second window doesn't
  // touch the learner's. Unless the copy is the file open here: it is
  // emptied for the new start, under this window.
  const sameModel = !!useModelStore.getState().filePath?.includes(`/tutorials/${id}/`);
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
  if (choice === "newWindow") openWindowOrSay(`?tour=${encodeURIComponent(id)}${resume ? "&resume=1" : ""}`);
  else if (choice === "here" && (await offerToSave())) begin();
}

/**
 * The place this tutorial was left at, if it still fits (#173). One that no
 * longer does (the tutorial changed in an update) is forgotten, and the
 * learner told why it starts from the beginning.
 */
function savedPlace(w: Walkthrough): TutorialProgress | null {
  const saved = loadProgress(w.id);
  if (!saved) return null;
  if (fitsWalkthrough(w, saved)) return saved;
  clearProgress(w.id);
  staleNotice = STALE_MESSAGE(w.title);
  return null;
}

/** Why the tutorial about to start begins at step 1, for its bar (#173). */
let staleNotice: string | null = null;

function sayWhyItStartedOver(): void {
  if (staleNotice) useTourStore.getState().setNotice(staleNotice);
  staleNotice = null;
}

/**
 * `?tour=<id>` (a link, or a window opened to run a tutorial). With
 * `&resume=1`, the window that asked already chose to resume (#173).
 */
export function startFromAddress(id: string, resume: boolean): void {
  const w = getWalkthrough(id);
  const saved = resume && w ? savedPlace(w) : null;
  if (saved) useTourStore.getState().resumeTour(id, saved);
  else useTourStore.getState().startTour(id);
  sayWhyItStartedOver();
}

/**
 * For the e2e suite only (a browser under automation, as `__pnvUndoTest`):
 * where the walkthrough and the window are, and a way to change the open file
 * by a route nothing asks about, which the app itself no longer has.
 */
if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.webdriver) {
  (window as unknown as { __pnvTourTest?: unknown }).__pnvTourTest = {
    state: () => {
      const { activeTourId, stepIndex, modelPath, stepStart } = useTourStore.getState();
      const { filePath, source, savedSource } = useModelStore.getState();
      return { activeTourId, stepIndex, modelPath, stepStart, filePath, source, savedSource };
    },
    switchFileUnasked: (path: string) => useModelStore.getState().setFilePath(path),
  };
}
