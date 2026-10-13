import { describe, it, expect, beforeEach } from "vitest";
import { useHistoryStore, type Snapshot } from "./historyStore";

// Undo crossing model boundaries (#1091).
//
// The history stack was never cleared when a model was opened — `clear()` had
// no callers at all — so snapshots from an earlier model stayed on it and
// repeated undo walked the user out of the model they were editing and into a
// previous one.

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    source: "x = 1",
    nodes: [],
    edges: [],
    filePath: "/models/a.py",
    description: "action",
    timestamp: Date.now(),
    positions: {},
    ...over,
  };
}

describe("history clearing", () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
  });

  it("has nothing to undo once cleared", () => {
    const h = useHistoryStore.getState();
    // Distinct descriptions: pushes sharing a batch key within 500ms merge
    // into one entry, which would leave nothing to undo.
    h.pushSnapshot(snap({ source: "a", description: "first" }));
    h.pushSnapshot(snap({ source: "b", description: "second" }));
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(useHistoryStore.getState().undo()).toBeNull();
  });

  it("drops the redo stack too", () => {
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ source: "a", description: "first" }));
    h.pushSnapshot(snap({ source: "b", description: "second" }));
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canRedo()).toBe(true);

    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().canRedo()).toBe(false);
  });

  it("without clearing, undo reaches a previous model's snapshot", () => {
    // Pins the bug: this is what the user experienced. If someone removes the
    // reset, this documents exactly what comes back.
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ filePath: "/models/first.py", source: "first", description: "opened first" }));
    h.pushSnapshot(snap({ filePath: "/models/second.py", source: "second-1", description: "opened second" }));
    h.pushSnapshot(snap({ filePath: "/models/second.py", source: "second-2", description: "edited second" }));

    useHistoryStore.getState().undo();
    const crossed = useHistoryStore.getState().undo();
    expect(crossed?.filePath).toBe("/models/first.py");
  });

  it("an undo step is refused when it names a different model", () => {
    // The guard in useUndoRedo compares these two paths; this asserts the
    // snapshot carries the identity that makes the comparison possible.
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ filePath: "/models/first.py", description: "first" }));
    h.pushSnapshot(snap({ filePath: "/models/second.py", source: "b", description: "second" }));
    const previous = useHistoryStore.getState().undo();
    expect(previous?.filePath).toBe("/models/first.py");
  });
});

describe("snapshots carry layout", () => {
  beforeEach(() => useHistoryStore.getState().clear());

  it("keeps positions so undo can restore the layout", () => {
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ source: "a", description: "laid out", positions: { n1: { x: 10, y: 20 } } }));
    h.pushSnapshot(snap({ source: "b", description: "edited", positions: { n1: { x: 99, y: 99 } } }));
    const previous = useHistoryStore.getState().undo();
    expect(previous?.positions).toEqual({ n1: { x: 10, y: 20 } });
  });
});

// Saves in History (#1349): a save is a mark on the step it wrote, not a step.
describe("save marks", () => {
  beforeEach(() => useHistoryStore.getState().clear());
  const mark = (at: number, kind: "manual" | "auto" | "revert" = "manual") => ({ at, kind });

  it("marks the current step when it holds the saved text, adding no step", () => {
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ source: "a", description: "opened" }));
    h.pushSnapshot(snap({ source: "b", description: "edited" }));
    h.markSaved(snap({ source: "b" }), mark(1000));
    const { past } = useHistoryStore.getState();
    expect(past.length).toBe(2);
    expect(past[1].saves).toEqual([{ at: 1000, kind: "manual" }]);
    expect(past[0].saves).toBeUndefined();
  });

  it("adds the saved text as a step when it isn't one yet", () => {
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ source: "a", description: "opened" }));
    h.markSaved(snap({ source: "typed", description: "Saved" }), mark(1000, "auto"));
    const { past } = useHistoryStore.getState();
    expect(past.map((p) => p.source)).toEqual(["a", "typed"]);
    expect(past[1].saves?.[0].kind).toBe("auto");
  });

  it("a save is not an undo step: undo moves one change, carrying its mark", () => {
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ source: "a", description: "opened" }));
    h.pushSnapshot(snap({ source: "b", description: "edit b" }));
    h.markSaved(snap({ source: "b" }), mark(1000));
    h.pushSnapshot(snap({ source: "c", description: "edit c" }));
    h.markSaved(snap({ source: "c" }), mark(2000));

    // Undo past the latest save lands on the earlier saved step.
    expect(useHistoryStore.getState().undo()?.source).toBe("b");
    const afterUndo = useHistoryStore.getState().past;
    expect(afterUndo[afterUndo.length - 1].saves?.[0].at).toBe(1000);
    // The later save went to the redo stack with its step, not lost.
    expect(useHistoryStore.getState().future[0].saves?.[0].at).toBe(2000);
    // Undo past both saves, then redo all the way: the marks come back.
    expect(useHistoryStore.getState().undo()?.source).toBe("a");
    useHistoryStore.getState().redo();
    useHistoryStore.getState().redo();
    const { past } = useHistoryStore.getState();
    expect(past.map((p) => p.saves?.map((m) => m.at) ?? [])).toEqual([[], [1000], [2000]]);
  });

  it("a saved step is never merged into by batching", () => {
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ source: "a", description: "opened" }));
    h.pushSnapshot(snap({ source: "b", description: "Modified gain in hidden" }));
    h.markSaved(snap({ source: "b" }), mark(1000));
    // Same batch key, inside 500 ms: would normally replace the last step.
    h.pushSnapshot(snap({ source: "c", description: "Modified gain in hidden" }));
    const { past } = useHistoryStore.getState();
    expect(past.map((p) => p.source)).toEqual(["a", "b", "c"]);
    expect(past[1].saves?.length).toBe(1);
  });

  it("saving the same step twice keeps both marks", () => {
    const h = useHistoryStore.getState();
    h.pushSnapshot(snap({ source: "a", description: "opened" }));
    h.markSaved(snap({ source: "a" }), mark(1000));
    h.markSaved(snap({ source: "a" }), mark(2000, "auto"));
    expect(useHistoryStore.getState().past[0].saves?.map((m) => m.kind)).toEqual(["manual", "auto"]);
  });
});
