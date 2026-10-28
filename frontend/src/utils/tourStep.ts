/**
 * A guided walkthrough, parsed from data (#1181).
 *
 * The walkthrough itself lives in `src/walkthroughs/*.yaml`, not here. This
 * module only knows how to read one and how to decide whether a step is
 * finished.
 *
 * Why data: #1181's design is **one list, two runners** — the in-app overlay
 * and a Playwright driver in CI walk the same steps, so a UI change that
 * breaks a walkthrough breaks the build. Two runners can only share a list if
 * the list is data; a `done` written as a JS closure could never be read by a
 * test that (rightly) refuses to compile app modules into itself.
 *
 * So `done` is a declarative condition and `act` a declarative action, and the
 * vocabulary of both is deliberately tiny. Every verb added is one two
 * independent runners have to agree on.
 */

import yaml from "js-yaml";

import buildYaml from "@/walkthroughs/build.yaml?raw";
import conflictYaml from "@/walkthroughs/conflict.yaml?raw";
import ddmYaml from "@/walkthroughs/ddm.yaml?raw";
import dynamicsYaml from "@/walkthroughs/dynamics.yaml?raw";
import egoYaml from "@/walkthroughs/ego.yaml?raw";
import hebbianYaml from "@/walkthroughs/hebbian.yaml?raw";
import hopfieldYaml from "@/walkthroughs/hopfield.yaml?raw";
import iscciYaml from "@/walkthroughs/iscci.yaml?raw";
import logisticYaml from "@/walkthroughs/logistic.yaml?raw";
import memoryYaml from "@/walkthroughs/memory.yaml?raw";
import perceptronYaml from "@/walkthroughs/perceptron.yaml?raw";
import pnlMechanismYaml from "@/walkthroughs/pnl-mechanism.yaml?raw";
import demoYaml from "@/walkthroughs/demo.yaml?raw";
import runYaml from "@/walkthroughs/run.yaml?raw";
import semanticYaml from "@/walkthroughs/semantic.yaml?raw";
import stroopYaml from "@/walkthroughs/stroop.yaml?raw";
import tdYaml from "@/walkthroughs/td.yaml?raw";
import vectorsYaml from "@/walkthroughs/vectors.yaml?raw";
// PsyNeuView First Steps (#1310), parts 1–8.
import orientationWindowYaml from "@/walkthroughs/orientation-window.yaml?raw";
import orientationOpenYaml from "@/walkthroughs/orientation-open.yaml?raw";
import orientationEditingYaml from "@/walkthroughs/orientation-editing.yaml?raw";
import orientationSavingYaml from "@/walkthroughs/orientation-saving.yaml?raw";
import orientationPsyneulinkYaml from "@/walkthroughs/orientation-psyneulink.yaml?raw";
import orientationRunningYaml from "@/walkthroughs/orientation-running.yaml?raw";
import orientationSettingsYaml from "@/walkthroughs/orientation-settings.yaml?raw";
import orientationDevelopersYaml from "@/walkthroughs/orientation-developers.yaml?raw";

/** The slice of app state a `done` condition can see. */
export interface TourState {
  /** Node the learner currently has selected, as the model names it. */
  selectedNodeId: string | null;
  /** Every node currently in the model, as the model names them. */
  nodeIds: string[];
  /** Trials in the most recent completed run; 0 if the model hasn't run. */
  trialCount: number;
  /** Completed runs this session — the only way to tell a re-run apart. */
  runCount: number;
  /** Current parameter values, by node name then parameter name. */
  nodeParams: Record<string, Record<string, string>>;
  /**
   * The inputs the most recent run actually submitted, by node name: one
   * vector per trial. Null until the model has run.
   */
  lastRunInputs: Record<string, number[][]> | null;
  /** Each node's function class ("Linear", "Logistic"), by node name. */
  nodeFunctions: Record<string, string>;
  /** The most recent completed training, or null if nothing has trained. */
  lastTraining: {
    epochs: number;
    finalLoss: number | null;
    targets: Record<string, number[][]>;
    inputs?: Record<string, number[][]>;
  } | null;
  /**
   * Whether an element with this `data-testid` is on screen right now (#1310).
   * The orientation walkthroughs teach the window itself, so "the Settings
   * panel is open" or "the Run tab is showing" are the facts their steps turn
   * on. Optional: a condition that needs it and has no answer is not met.
   */
  isVisible?: (testid: string) => boolean;
  /** The learner pressed the bar's Next button on the current step (#1310). */
  nextPressed?: boolean;
  /** The trace bar's current step, or null when no trace is active (#1310). */
  traceStep?: number | null;
  /** Path of the open model file, or null when none is open (#1310). */
  filePath?: string | null;
}

/**
 * Per-trial inputs, by node name. A one-unit node may be written as plain
 * numbers (`[2, 0, 0]`) rather than one-element vectors (`[[2], [0], [0]]`) —
 * the course notebooks write them that way.
 */
export type TrialInputs = Record<string, Array<number | number[]>>;

/** Conditions a step can finish on. */
export interface TourCondition {
  /**
   * Finished once this node (by model name) is the selection. A projection's
   * name works too (#45): selecting the arrow selects the projection.
   */
  selectedNode?: string;
  /** Finished once a node of this name exists at all — i.e. it was added. */
  nodeExists?: string;
  /** Finished once the model has run and produced at least this many trials. */
  trialsAtLeast?: number;
  /**
   * Finished once the model has been run this many times.
   *
   * Distinct from `trialsAtLeast`, which cannot express "run it again": the
   * second run of a model produces the same trial count as the first.
   */
  runsAtLeast?: number;
  /**
   * Finished once a node's (or a projection's) parameter holds this value.
   * Numbers compare numerically, and so do matrices written as JSON.
   */
  paramEquals?: { node: string; param: string; value: string };
  /**
   * Finished once the most recent run used exactly these per-trial inputs.
   *
   * Judged on a completed run rather than on the Run panel's cells: the cells
   * are the panel's own state, and a step about *driving* a model is only done
   * once the learner has run it with the inputs, not merely typed them (#50).
   */
  lastRunInputs?: TrialInputs;
  /** Finished once a node's function is this class (e.g. "Logistic"). */
  functionIs?: { node: string; type: string };
  /**
   * Finished once the most recent training used exactly these per-trial
   * targets for at least `epochsAtLeast` epochs (#47). Judged on the finished
   * training, like `lastRunInputs` on a finished run. `inputs`, when given,
   * must match too; a model that learns without targets (Hebbian, #48) is
   * checked on its inputs alone. At least one of the two must be named.
   */
  lastTraining?: { targets?: TrialInputs; inputs?: TrialInputs; epochsAtLeast?: number };
  /**
   * Finished once an element with this `data-testid` is on screen (#1310): a
   * panel the learner opened, a tab they switched to, a tag that appeared.
   */
  visible?: string;
  /** Finished once no element with this `data-testid` is on screen (#1310). */
  hidden?: string;
  /**
   * Finished when the learner presses **Next** in the bar (#1310). For a step
   * that only explains, where there is nothing to do. Use sparingly: a step
   * that can turn on an action should.
   */
  next?: true;
  /** Finished once the trace bar is on at least this step (0-based) (#1310). */
  traceStepAtLeast?: number;
  /**
   * Finished once the open model's file has this name (`orientation_edit.py`)
   * (#1310): a new model was started, or a particular file opened. By name
   * only, since the folder is the person's own.
   */
  fileNamed?: string;
}

/** What the CI driver does to play the learner's part. The app ignores it. */
export interface TourAction {
  /** Click this node on the canvas, or this projection's arrow (#45). */
  selectNode?: string;
  /** Click this PsyNeuLink type in the Components palette. */
  addFromPalette?: string;
  /** Open the Run tab and run the model. */
  runModel?: boolean;
  /** Start a new model with this name, via Open ▾ → + New Model…. */
  newModel?: string;
  /** Open this model from the Open menu, by its menu label. */
  openModel?: string;
  /**
   * Select a node (or a projection, #45) and set one of its parameters in the
   * Inspector. For a projection, the row under "Projection Parameters".
   */
  setParameter?: { node: string; param: string; value: string };
  /** Fill each named node's trials in the Run panel, via its Paste CSV box. */
  setTrialInputs?: TrialInputs;
  /** Select a node and switch its function class in the Inspector. */
  setFunction?: { node: string; type: string };
  /** Fill the Learn tab's inputs and targets, set epochs, and train. */
  train?: { inputs: TrialInputs; targets: TrialInputs; epochs: number };
  /**
   * Choose a set the model declares (#1216) from the Run or Learn tab's
   * "From" menu. With `tab: learn` it also starts learning; with `tab: run`,
   * add `runModel: true` to run it.
   */
  pickSet?: { tab: "run" | "learn"; name: string };
  /** Click the element with this `data-testid` (#1310). */
  click?: string;
  /** Press the bar's Next button (#1310). */
  next?: true;
  /** Press a key, by its Playwright name ("Escape") (#1310). */
  pressKey?: string;
  /** Click the toolbar's Undo / Redo (#1310). */
  undo?: true;
  redo?: true;
  /**
   * Replace the first occurrence of `find` in the code editor with `replace`
   * (#1310). Combine with `pickSet` / `runModel` to run the edited model (#49).
   */
  replaceInCode?: { find: string; replace: string };
}

/** One trial's value as a vector, whichever way the walkthrough wrote it. */
function asVector(trial: number | number[]): number[] {
  return Array.isArray(trial) ? trial : [trial];
}

/**
 * What a step points at.
 *
 * A walkthrough that can only ring canvas nodes can only teach *looking*.
 * Teaching someone to **build** means pointing at the palette too — which is
 * why this is a shape rather than a bare node name, and why the overlay
 * positions itself against the window instead of the canvas pane (the palette
 * is a sibling of the canvas, not inside it).
 *
 * `testid` keeps walkthroughs off raw CSS selectors: a test id is a contract
 * the app already maintains, whereas a selector would couple a walkthrough to
 * markup that is free to change.
 */
export interface TourAnchor {
  /** Model name of a canvas node. */
  node?: string;
  /** `data-testid` of any element in the app. */
  testid?: string;
}

export interface TourStep {
  id: string;
  anchor: TourAnchor;
  instruct: string;
  /**
   * The step's caption: one short spoken line (#1310). Shown under the
   * instruction, always; read aloud when narration is on. Absent, the
   * instruction itself is what narration reads.
   */
  say?: string;
  /**
   * The caption as the recorded narration should say it (#1407): the same
   * words, with eSpeak phonemes in `[[ ]]` where a recording needs a stress
   * or sound changed, e.g. "where the model has [[ bˈɪn ]]". Only the
   * recording script reads it; the screen and live voices use `say`.
   */
  say_phonemes?: string;
  /**
   * Glide the pointer to the anchor before showing the instruction (#1310),
   * for a step whose point is "look here". The ring is drawn either way.
   */
  pointer?: boolean;
  done: TourCondition;
  act?: TourAction;
}

export interface Walkthrough {
  id: string;
  title: string;
  /**
   * Open-menu label of the model the walkthrough runs against.
   *
   * Omitted when the walkthrough *builds* its model rather than opening one —
   * which is the case #1180 actually cares about.
   */
  model?: string;
  /**
   * The course lesson this walkthrough teaches, numbered the way the course
   * numbers its notebooks ("0.3" is 0_primer/3_perceptron_and_xor). Absent for
   * the general walkthroughs that teach the app itself.
   */
  course?: string;
  /**
   * Its place in **PsyNeuView First Steps**, the new-user orientation
   * (#1310): 1 for the first part, and so on. Absent for every other
   * walkthrough.
   */
  orientation?: number;
  /**
   * Its place in **PsyNeuLink Tutorials** (#9), the walkthroughs that follow
   * PsyNeuLink's own Tutorial notebook and Basics and Primer: 1 for the first
   * lesson, and so on. Absent for every other walkthrough.
   */
  psyneulink?: number;
  /** The docs pages the walkthrough relies on, as paths under `docs/` (#1310). */
  docs?: string[];
  /**
   * Turn developer mode on while the walkthrough runs, and put it back as it
   * was afterwards (#1318). For the developer track only.
   */
  developerMode?: boolean;
  /** About how long it takes, in minutes, for the menu (#1310). */
  minutes?: number;
  steps: TourStep[];
}

/**
 * Node ids pick up a session-counter suffix once several models have loaded in
 * one run ("color_hidden-7"). Match the name or name + "-<n>", never a bare
 * prefix — that would also match "color_hidden_extra", and is the mistake the
 * e2e helpers were consolidated to stop repeating.
 */
export function matchesNodeName(nodeId: string | null | undefined, name: string): boolean {
  if (!nodeId) return false;
  return nodeId === name || nodeId.startsWith(`${name}-`);
}

/**
 * Whether a step's condition is satisfied.
 *
 * An empty or unrecognised condition is **never** satisfied. A walkthrough
 * that silently auto-advances because of a typo in a verb would be worse than
 * one that visibly sticks.
 */
export function isDone(condition: TourCondition, state: TourState): boolean {
  if (condition.selectedNode !== undefined) {
    return matchesNodeName(state.selectedNodeId, condition.selectedNode);
  }
  if (condition.nodeExists !== undefined) {
    const name = condition.nodeExists;
    return state.nodeIds.some((id) => matchesNodeName(id, name));
  }
  if (condition.trialsAtLeast !== undefined) {
    return state.trialCount >= condition.trialsAtLeast;
  }
  if (condition.runsAtLeast !== undefined) {
    return state.runCount >= condition.runsAtLeast;
  }
  if (condition.paramEquals !== undefined) {
    const { node, param, value } = condition.paramEquals;
    const owner = Object.keys(state.nodeParams).find((id) => matchesNodeName(id, node));
    if (!owner) return false;
    const actual = state.nodeParams[owner]?.[param];
    // Compared numerically when both sides are numbers, so "2.5" satisfies a
    // step asking for 2.50 — the learner typed the right thing either way.
    const a = Number(actual);
    const b = Number(value);
    if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
    // A matrix likewise: "[[10, 4], [2, 5]]" satisfies "[[10,4],[2,5]]" (#45).
    const am = parseMatrix(actual);
    const bm = parseMatrix(value);
    if (am !== null && bm !== null) return sameNumbers(am, bm);
    return actual === value;
  }
  if (condition.functionIs !== undefined) {
    const { node, type } = condition.functionIs;
    const owner = Object.keys(state.nodeFunctions).find((id) => matchesNodeName(id, node));
    return owner !== undefined && state.nodeFunctions[owner] === type;
  }
  if (condition.lastTraining !== undefined) {
    const trained = state.lastTraining;
    if (!trained) return false;
    const { targets, inputs, epochsAtLeast } = condition.lastTraining;
    if (targets === undefined && inputs === undefined) return false;
    if (epochsAtLeast !== undefined && trained.epochs < epochsAtLeast) return false;
    if (targets !== undefined && !sameTrials(targets, trained.targets)) return false;
    if (inputs !== undefined && !sameTrials(inputs, trained.inputs ?? {})) return false;
    return true;
  }
  if (condition.lastRunInputs !== undefined) {
    const ran = state.lastRunInputs;
    if (!ran) return false;
    return sameTrials(condition.lastRunInputs, ran);
  }
  if (condition.visible !== undefined) {
    return state.isVisible?.(condition.visible) ?? false;
  }
  if (condition.hidden !== undefined) {
    if (!state.isVisible) return false;
    return !state.isVisible(condition.hidden);
  }
  if (condition.next !== undefined) {
    return condition.next === true && state.nextPressed === true;
  }
  if (condition.traceStepAtLeast !== undefined) {
    const at = state.traceStep;
    return typeof at === "number" && at >= condition.traceStepAtLeast;
  }
  if (condition.fileNamed !== undefined) {
    const path = state.filePath;
    if (!path) return false;
    return path.split("/").pop() === condition.fileNamed;
  }
  return false;
}

/** A list or matrix of numbers written as JSON ("[[1, 4], [2, 5]]"), or null. */
function parseMatrix(text: string | undefined): unknown[] | null {
  if (typeof text !== "string" || !text.trim().startsWith("[")) return null;
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Same shape, same numbers, all the way down. */
function sameNumbers(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameNumbers(x, b[i]));
  }
  return typeof a === "number" && typeof b === "number" && a === b;
}

/** Whether a condition is judged on what is on screen, and so needs re-checking as the DOM changes. */
export function watchesDom(condition: TourCondition): boolean {
  return condition.visible !== undefined || condition.hidden !== undefined;
}

/**
 * Whether per-trial values match what was actually submitted, node by node.
 * An empty spec never matches: a typo must not auto-advance.
 */
function sameTrials(wanted: TrialInputs, actual: Record<string, number[][]>): boolean {
  const entries = Object.entries(wanted);
  if (entries.length === 0) return false;
  return entries.every(([node, trials]) => {
    const owner = Object.keys(actual).find((id) => matchesNodeName(id, node));
    if (!owner) return false;
    const got = actual[owner];
    if (got.length !== trials.length) return false;
    return trials.every((trial, t) => {
      const want = asVector(trial);
      const row = got[t] ?? [];
      return want.length === row.length && want.every((v, i) => v === row[i]);
    });
  });
}

/** Parse a walkthrough, failing loudly rather than half-working. */
export function parseWalkthrough(text: string): Walkthrough {
  const raw = yaml.load(text) as Partial<Walkthrough> | undefined;
  if (!raw || typeof raw !== "object") throw new Error("walkthrough: not a mapping");
  const { id, title, model, course, orientation, psyneulink, docs, developerMode, minutes, steps } = raw;
  if (!id || !title) throw new Error("walkthrough: needs id and title");
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("walkthrough: needs steps");
  steps.forEach((step, i) => {
    if (!step.id || !step.anchor || !step.instruct) {
      throw new Error(`walkthrough: step ${i} needs id, anchor and instruct`);
    }
    if (!step.anchor.node && !step.anchor.testid) {
      throw new Error(`walkthrough: step "${step.id}" anchor needs a node or a testid`);
    }
    if (!step.done || typeof step.done !== "object") {
      throw new Error(`walkthrough: step "${step.id}" needs a done condition`);
    }
    if (step.say !== undefined && typeof step.say !== "string") {
      throw new Error(`walkthrough: step "${step.id}" say must be text`);
    }
    if (step.say_phonemes !== undefined && (typeof step.say_phonemes !== "string" || step.say === undefined)) {
      throw new Error(`walkthrough: step "${step.id}" say_phonemes must be text, and needs a say`);
    }
    if (step.pointer !== undefined && typeof step.pointer !== "boolean") {
      throw new Error(`walkthrough: step "${step.id}" pointer must be true or false`);
    }
  });
  if (course !== undefined && !/^\d+\.\d+$/.test(String(course))) {
    throw new Error(`walkthrough "${id}": course must look like "0.3", got ${JSON.stringify(course)}`);
  }
  if (orientation !== undefined && (!Number.isInteger(orientation) || orientation < 1)) {
    throw new Error(`walkthrough "${id}": orientation must be a whole number from 1, got ${JSON.stringify(orientation)}`);
  }
  if (psyneulink !== undefined && (!Number.isInteger(psyneulink) || psyneulink < 1)) {
    throw new Error(`walkthrough "${id}": psyneulink must be a whole number from 1, got ${JSON.stringify(psyneulink)}`);
  }
  if ([course, orientation, psyneulink].filter((x) => x !== undefined).length > 1) {
    throw new Error(`walkthrough "${id}": belongs to one section only (course, orientation or psyneulink)`);
  }
  const docList =
    docs === undefined ? undefined : (Array.isArray(docs) ? docs : [docs]).map((d) => String(d));
  if (docList?.some((d) => !/^[\w./-]+\.md$/.test(d))) {
    throw new Error(`walkthrough "${id}": docs must be paths under docs/, like where-things-live.md`);
  }
  if (developerMode !== undefined && typeof developerMode !== "boolean") {
    throw new Error(`walkthrough "${id}": developerMode must be true or false`);
  }
  if (minutes !== undefined && (typeof minutes !== "number" || minutes <= 0)) {
    throw new Error(`walkthrough "${id}": minutes must be a number`);
  }
  return {
    id,
    title,
    model,
    course: course === undefined ? undefined : String(course),
    orientation,
    psyneulink,
    docs: docList,
    developerMode,
    minutes,
    steps,
  };
}

/**
 * Every walkthrough the app ships, by id. `?tour=<id>` picks one.
 *
 * Parsed at module load deliberately: a malformed walkthrough should break
 * loudly at startup, not halfway through teaching someone.
 */
export const WALKTHROUGHS: Record<string, Walkthrough> = {
  demo: parseWalkthrough(demoYaml),
  build: parseWalkthrough(buildYaml),
  run: parseWalkthrough(runYaml),
  ddm: parseWalkthrough(ddmYaml),
  stroop: parseWalkthrough(stroopYaml),
  dynamics: parseWalkthrough(dynamicsYaml),
  logistic: parseWalkthrough(logisticYaml),
  perceptron: parseWalkthrough(perceptronYaml),
  memory: parseWalkthrough(memoryYaml),
  semantic: parseWalkthrough(semanticYaml),
  conflict: parseWalkthrough(conflictYaml),
  ego: parseWalkthrough(egoYaml),
  iscci: parseWalkthrough(iscciYaml),
  hebbian: parseWalkthrough(hebbianYaml),
  td: parseWalkthrough(tdYaml),
  vectors: parseWalkthrough(vectorsYaml),
  hopfield: parseWalkthrough(hopfieldYaml),
  "pnl-mechanism": parseWalkthrough(pnlMechanismYaml),
  "orientation-window": parseWalkthrough(orientationWindowYaml),
  "orientation-open": parseWalkthrough(orientationOpenYaml),
  "orientation-editing": parseWalkthrough(orientationEditingYaml),
  "orientation-saving": parseWalkthrough(orientationSavingYaml),
  "orientation-psyneulink": parseWalkthrough(orientationPsyneulinkYaml),
  "orientation-running": parseWalkthrough(orientationRunningYaml),
  "orientation-settings": parseWalkthrough(orientationSettingsYaml),
  "orientation-developers": parseWalkthrough(orientationDevelopersYaml),
};

/** Sort key for a course lesson: "1.3" before "2.1", "0.10" after "0.9". */
function lessonKey(lesson: string): [number, number] {
  const [module, n] = lesson.split(".").map(Number);
  return [module, n];
}

/**
 * The Tutorials menu's sections: the general walkthroughs in the order they
 * were written, then the course's in the course's own order. A flat list in
 * registration order put Dynamics (1.3) above Logistic (0.2) and gave no sign
 * which rows were course lessons.
 */
export const ORIENTATION_GROUP = "PsyNeuView First Steps";
export const PSYNEULINK_GROUP = "PsyNeuLink Tutorials";

export interface MenuGroup {
  /** Stable, for the test id `walkthrough-group-<id>`. */
  id: "orientation" | "general" | "psyneulink" | "course";
  title: string;
  walkthroughs: Walkthrough[];
}

export function menuGroups(all: Walkthrough[] = Object.values(WALKTHROUGHS)): MenuGroup[] {
  // The orientation first (#1310): it is what a new user should meet before
  // anything else, in its own numbered order.
  const orientation = all
    .filter((w) => w.orientation !== undefined)
    .sort((a, b) => a.orientation! - b.orientation!);
  const general = all.filter((w) => !w.course && w.orientation === undefined && w.psyneulink === undefined);
  // #9: PsyNeuLink's own tutorials, in lesson order, between the app's own
  // walkthroughs and the course.
  const psyneulink = all
    .filter((w) => w.psyneulink !== undefined)
    .sort((a, b) => a.psyneulink! - b.psyneulink!);
  const course = all
    .filter((w) => w.course)
    .sort((a, b) => {
      const [am, an] = lessonKey(a.course!);
      const [bm, bn] = lessonKey(b.course!);
      return am - bm || an - bn;
    });
  return [
    { id: "orientation" as const, title: ORIENTATION_GROUP, walkthroughs: orientation },
    { id: "general" as const, title: "Getting started", walkthroughs: general },
    { id: "psyneulink" as const, title: PSYNEULINK_GROUP, walkthroughs: psyneulink },
    { id: "course" as const, title: "Cognitive Neuroscience Course", walkthroughs: course },
  ].filter((g) => g.walkthroughs.length > 0);
}

/** The orientation's parts in order; the first is what the first-launch offer starts. */
export function orientationWalkthroughs(all: Walkthrough[] = Object.values(WALKTHROUGHS)): Walkthrough[] {
  return menuGroups(all).find((g) => g.id === "orientation")?.walkthroughs ?? [];
}

export function getWalkthrough(id: string | null): Walkthrough | null {
  if (!id) return null;
  return WALKTHROUGHS[id] ?? null;
}
