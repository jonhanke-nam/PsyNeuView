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
