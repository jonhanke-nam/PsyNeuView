import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useHistoryStore, type Snapshot } from "@/stores/historyStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useModelStore } from "@/stores/modelStore";
import { applyHistoryStep, goToHistoryStep } from "@/hooks/useUndoRedo";
import { BURST_MS, NOTICE_MS, resetBurst } from "./historyNotice";

// Undo and redo: one notice for a burst, not one per step (#1377).

const STEPS = 57;

function step(i: number): Snapshot {
  return {
    source: `x = ${i}\n`,
    nodes: [],
    edges: [],
    filePath: null,
    description: `Edit ${i}`,
    timestamp: Date.now(),
    positions: {},
  };
}

const h = () => useHistoryStore.getState();
const notices = () => useNotificationStore.getState().notifications;
const current = () => h().past[h().past.length - 1].description;

/** Press undo (or redo) `n` times, `gap` ms apart. */
async function press(n: number, redo = false, gap = 100) {
  for (let i = 0; i < n; i++) {
    await applyHistoryStep(redo);
    vi.advanceTimersByTime(gap);
  }
}

describe("undo and redo notices (#1377)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBurst();
    useNotificationStore.getState().clearAll();
    useModelStore.setState({ filePath: null });
    h().clear();
    h().setRestoring(false); // an undo holds recording off for a moment
    for (let i = 0; i <= STEPS; i++) {
      h().pushSnapshot(step(i));
      vi.advanceTimersByTime(1000); // past the history's own batching window
    }
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("20 undos in quick succession leave one notice, with the count and where they went back to", async () => {
    await press(20);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe("Undid 20 edits: back to Edit 37");
    expect(notices()[0].action?.label).toBe("Redo");
    expect(current()).toBe("Edit 37");
  });

  it("a single undo is a quiet one-line notice naming the step undone", async () => {
    await press(1);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe("Undid Edit 57");
    expect(notices()[0].action?.label).toBe("Redo");
  });

  it("a gap longer than the burst window starts a new burst", async () => {
    await press(3);
    expect(notices()[0].message).toBe("Undid 3 edits: back to Edit 54");
    vi.advanceTimersByTime(BURST_MS + 100);
    await press(2);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe("Undid 2 edits: back to Edit 52");
  });

  it("the notice's Redo redoes the whole burst, as one notice", async () => {
    await press(20);
    notices()[0].action!.onClick();
    expect(current()).toBe("Edit 57");
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe("Redid 20 edits: forward to Edit 57");
    expect(notices()[0].action?.label).toBe("Undo");
  });

  it("redo bursts the same way", async () => {
    await press(10);
    vi.advanceTimersByTime(BURST_MS + 100);
    await press(3, true);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe("Redid 3 edits: forward to Edit 50");
    await press(1, true);
    expect(notices()[0].message).toBe("Redid 4 edits: forward to Edit 51");
  });

  it("the notice clears itself a few seconds after the burst's last step", async () => {
    await press(5, false, 1000); // each step restarts the dwell
    expect(notices()).toHaveLength(1);
    vi.advanceTimersByTime(NOTICE_MS - 1100);
    expect(notices()).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(notices()).toHaveLength(0);
  });

  it("holding undo past the start keeps the burst's notice", async () => {
    await press(STEPS + 5);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe(`Undid ${STEPS} edits: back to the start`);
  });

  it("an edit between undos starts a new burst", async () => {
    await press(2);
    h().setRestoring(false);
    h().pushSnapshot(step(100));
    await press(1);
    expect(notices()[0].message).toBe("Undid Edit 100");
  });

  it("a jump in History is one action with one notice", async () => {
    await goToHistoryStep(37);
    expect(current()).toBe("Edit 37");
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe("Went back 20 steps, to Edit 37");
    expect(notices()[0].action?.label).toBe("Redo");

    vi.advanceTimersByTime(BURST_MS + 100);
    await goToHistoryStep(40);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].message).toBe("Went forward 3 steps, to Edit 40");

    // Undo straight after a jump is its own burst, not more of the jump.
    await press(1);
    expect(notices()[0].message).toBe("Undid Edit 40");
  });
});

describe("notices with a key (#1377)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.getState().clearAll();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("a notice with the same key replaces the old one in its place", () => {
    const add = useNotificationStore.getState().addNotification;
    add("info", "first");
    add("info", "one", { key: "k" });
    add("info", "last");
    const id = notices()[1].id;
    add("info", "two", { key: "k" });
    expect(notices().map((n) => n.message)).toEqual(["first", "two", "last"]);
    expect(notices()[1].id).toBe(id);
  });

  it("a replaced notice's dwell starts again", () => {
    const add = useNotificationStore.getState().addNotification;
    add("info", "one", { key: "k", durationMs: 1000 });
    vi.advanceTimersByTime(800);
    add("info", "two", { key: "k", durationMs: 1000 });
    vi.advanceTimersByTime(800);
    expect(notices()).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(notices()).toHaveLength(0);
  });

  it("notices without a key still stack, and errors still stay", () => {
    const add = useNotificationStore.getState().addNotification;
    add("info", "a", 1000);
    add("info", "a", 1000);
    add("error", "e");
    expect(notices()).toHaveLength(3);
    vi.advanceTimersByTime(10_000);
    expect(notices().map((n) => n.message)).toEqual(["e"]);
  });
});
