/**
 * Where the learner is in the running walkthrough (#1181).
 *
 * Two components need this and neither should own it: the **bar** renders the
 * instruction and progress, the **overlay** draws the ring on the canvas. Both
 * read from here so they cannot disagree about which step is showing.
 */

import { useEffect, useState } from "react";

import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useModelStore } from "@/stores/modelStore";
import { useLearnResults } from "@/stores/learnResultsStore";
import { useRunRecords } from "@/stores/runRecordsStore";
import { useRunResults } from "@/stores/runResultsStore";
import { useTourStore } from "@/stores/tourStore";
import { getWalkthrough, isDone, watchesDom, type TourStep, type Walkthrough } from "@/utils/tourStep";

/**
 * Whether an element with this test id is on screen: present, and laid out
 * with some size. `display: none` wrappers (the bottom panel keeps every tab
 * mounted) give their children no box, so a hidden tab's panel reads as not
 * visible, which is what a learner would say.
 */
export function isTestIdVisible(testid: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
  if (!el) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

export interface TourProgress {
  walkthrough: Walkthrough | null;
  step: TourStep | null;
  stepIndex: number;
  /** True once the learner has done what the current step asked. */
  complete: boolean;
  /** True when the walkthrough has run past its last step. */
  finished: boolean;
}

export function useTourProgress(): TourProgress {
  const activeTourId = useTourStore((s) => s.activeTourId);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const nextPressed = useTourStore((s) => s.nextPressed);
  const traceStep = useModelStore((s) => s.traceStep);
  const filePath = useModelStore((s) => s.filePath);
  // A selected projection counts as the selection (#45): `selectedNode` names
  // either. Selecting one clears the other, so at most one is set.
  const selectedNodeId = useModelStore((s) => s.selectedNodeId ?? s.selectedEdgeId);
  const nodes = useModelStore((s) => s.nodes);
  const edges = useModelStore((s) => s.edges);
  const trialCount = useRunResults((s) => s.results?.results.length ?? 0);
  const runCount = useRunResults((s) => s.runCount);
  // Newest record first. Keyed by the node's model name, as walkthroughs are.
  const lastRecord = useRunRecords((s) => s.records[0] ?? null);
  const lastTraining = useLearnResults((s) => s.last);
  const catalogIsOpen = useCatalogOpener((s) => s.isOpen);
  const catalogSectionOf = useCatalogOpener((s) => s.sectionOf);
  const lastRunInputs = lastRecord
    ? Object.fromEntries(lastRecord.inputs.map((inp) => [inp.name, inp.trials]))
    : null;

  const walkthrough = getWalkthrough(activeTourId);
  const step = walkthrough?.steps[stepIndex] ?? null;

  // A step judged on what is on screen (#1310) has no store to subscribe to:
  // the Settings panel opening is a DOM fact. So while such a step is current,
  // look again a few times a second. Cheap (one querySelector), and only
  // while needed.
  const domWatched = step ? watchesDom(step.done) : false;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!domWatched) return;
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [domWatched, step]);
  // Parameter values as the Inspector shows them.
  //
  // Both sections count: a mechanism's own params AND its function's. The
  // parameters a course actually varies are usually the function's — a DDM's
  // threshold and drift rate live on DriftDiffusionAnalytical, not on the DDM
  // — so a walkthrough that could only see mechanism params would be unable to
  // teach the interesting half. Function params win a name clash, because
  // that is the row the learner just edited.
  //
  // Entries are either a { value } record or the bare value depending on how
  // the backend described them, so read tolerantly rather than assume.
  const flatten = (params: Record<string, unknown> | undefined): Record<string, string> => {
    const flat: Record<string, string> = {};
    for (const [key, raw] of Object.entries(params ?? {})) {
      const v =
        raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)
          ? (raw as { value: unknown }).value
          : raw;
      // A matrix is kept as JSON, "[[1,4],[2,5]]": String() would flatten
      // it to "1,4,2,5" and lose its shape (#45).
      if (v !== undefined && v !== null) flat[key] = typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    return flat;
  };

  const nodeParams: Record<string, Record<string, string>> = {};
  const nodeFunctions: Record<string, string> = {};
  // Input port shapes, as the Inspector's Inputs rows show them (#9).
  const nodeInputShapes: Record<string, number[][]> = {};
  for (const node of nodes) {
    const data = node.data as
      | {
          params?: Record<string, unknown>;
          function?: { type?: string; params?: Record<string, unknown> } | null;
          inputPorts?: { shape?: number[] }[];
        }
      | undefined;
    if (data?.function?.type) nodeFunctions[node.id] = data.function.type;
    if (data?.inputPorts) nodeInputShapes[node.id] = data.inputPorts.map((p) => p.shape ?? []);
    nodeParams[node.id] = {
      ...flatten(data?.params),
      ...flatten(data?.function?.params),
    };
  }
  // Projections count too, by name (#45): a lesson about a weight matrix is a
  // lesson about a projection. Its own parameters win a name clash here, since
  // the Inspector's "Projection Parameters" row is the one that edits the code.
  for (const edge of edges) {
    if (edge.id in nodeParams) continue;
    const data = edge.data as
      | { params?: Record<string, unknown>; function?: { params?: Record<string, unknown> } | null }
      | undefined;
    if (!data?.params && !data?.function?.params) continue;
    nodeParams[edge.id] = {
      ...flatten(data?.function?.params),
      ...flatten(data?.params),
    };
  }

  // A step that teaches opening a catalog model is done only once *that*
  // model is open (#1392). Its own check (a node it has) can be met by
  // another model: the PsyNeuLink Library's EGO has the Coffee Shop demo's
  // nodes. A label the catalog doesn't know keeps the step's own check.
  const wantsModel = step?.act?.openModel;
  const rightModelOpen =
    !wantsModel || !catalogIsOpen || !catalogSectionOf?.(wantsModel) || catalogIsOpen(wantsModel);

  const complete = step
    ? rightModelOpen && isDone(step.done, {
        selectedNodeId,
        nodeIds: nodes.map((n) => n.id),
        trialCount,
        runCount,
        nodeParams,
        lastRunInputs,
        nodeFunctions,
        lastTraining,
        isVisible: isTestIdVisible,
        nextPressed,
        traceStep,
        filePath,
        nodeInputShapes,
      })
    : false;

  return {
    walkthrough,
    step,
    stepIndex,
    complete,
    finished: Boolean(walkthrough) && !step,
  };
}
