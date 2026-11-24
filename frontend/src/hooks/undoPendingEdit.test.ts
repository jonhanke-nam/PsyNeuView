import { describe, it, expect, beforeEach, vi } from "vitest";
import { useModelStore } from "@/stores/modelStore";
import { useHistoryStore } from "@/stores/historyStore";
import { applyHistoryStep, historyMoveCount, recordPendingCodeEdit } from "./useUndoRedo";
import { recordAction } from "@/utils/history";

// #366: a code edit becomes a History step only once its live preview has
// rebuilt the model (the 1.5 s pause, then the build). ⌘Z before then said
// "Nothing to undo" and left the edit in place, so a run's results stayed
// marked as from an earlier version.

const FILE = "/models/stroop.py";
const RAN = "gain = 1.1\n";
const EDITED = "gain = 1.7\n";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  useHistoryStore.getState().clear();
  useHistoryStore.getState().setRestoring(false);
  useModelStore.setState({ filePath: FILE, source: RAN, savedSource: RAN, nodes: [], edges: [] });
  recordAction("Model loaded", { edit: false });
});

describe("Undo with an edit still waiting for its preview (#366)", () => {
  it("takes back the edit", async () => {
    useModelStore.getState().setSource(EDITED);
    const moves = historyMoveCount();

    await applyHistoryStep(false);

    expect(useModelStore.getState().source).toBe(RAN);
    // The edit is a step Redo can bring back.
    expect(useHistoryStore.getState().canRedo()).toBe(true);
    expect(useHistoryStore.getState().future[0]?.source).toBe(EDITED);
    // The preview sent before the Undo is dropped when it lands.
    expect(historyMoveCount()).toBe(moves + 1);
  });

  it("records nothing when History already has the code", () => {
    recordPendingCodeEdit();
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("records nothing while a step is being put back", () => {
    useModelStore.getState().setSource(EDITED);
    useHistoryStore.getState().setRestoring(true);
    recordPendingCodeEdit();
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("records nothing for another model's history", () => {
    useModelStore.setState({ filePath: "/models/other.py", source: EDITED });
    recordPendingCodeEdit();
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });
});

describe("Redo with an edit still waiting for its preview (#391)", () => {
  const TYPED = "gain = 2.5\n";

  it("keeps the typed edit: Undo after the Redo brings it back", async () => {
    // A step, undone: Redo has it to put back.
    useModelStore.getState().setSource(EDITED);
    recordAction("Edited the code");
    await applyHistoryStep(false);
    expect(useModelStore.getState().source).toBe(RAN);
    useHistoryStore.getState().setRestoring(false);

    // Type, then Redo at once, before the preview has made it a step.
    useModelStore.getState().setSource(TYPED);
    await applyHistoryStep(true);
    expect(useModelStore.getState().source).toBe(EDITED);
    useHistoryStore.getState().setRestoring(false);

    // The typed edit is a step, just before the one Redo put back.
    const past = useHistoryStore.getState().past;
    expect(past.map((s) => s.source)).toEqual([RAN, TYPED, EDITED]);

    await applyHistoryStep(false);
    expect(useModelStore.getState().source).toBe(TYPED);
  });

  it("with nothing to redo, records the edit and leaves it in the editor", async () => {
    useModelStore.getState().setSource(TYPED);
    await applyHistoryStep(true);
    expect(useModelStore.getState().source).toBe(TYPED);
    expect(useHistoryStore.getState().past.map((s) => s.source)).toEqual([RAN, TYPED]);
  });
});
