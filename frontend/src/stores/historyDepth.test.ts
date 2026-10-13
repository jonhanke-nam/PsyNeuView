import { describe, it, expect, beforeEach } from "vitest";
import type { Node } from "@xyflow/react";
import {
  DEFAULT_BUDGET,
  KEEP_FULL_MIN,
  KEYFRAME_EVERY,
  sameSource,
  useHistoryStore,
  type Snapshot,
} from "./historyStore";
import { depthLabel, onDiskIndex, saveAtPosition } from "@/utils/saveHistory";

// Unlimited undo depth (#558): every step is kept; older ones compactly (no
// graph, code as a delta from the next newer step), and only past a memory
// budget is the oldest dropped.

const BASE = Array.from({ length: 200 }, (_, i) => `node_${i} = pnl.TransferMechanism(name="n${i}")`).join("\n");

/** The code after edit `i`: the base with one line changed, as a small edit does. */
function codeAt(i: number): string {
  return `${BASE}\n# edit ${i}\nx = ${i}\n`;
}

function graph(i: number): Node[] {
  // A fresh graph per step, as a rebuilt model gives: big data, new objects.
  return Array.from({ length: 20 }, (_, k) => ({
    id: `n${k}`,
    position: { x: k * 10, y: i },
    data: { varName: `node_${k}`, params: { gain: i, noise: "x".repeat(500) } },
  }));
}

function step(i: number): Snapshot {
  return {
    source: codeAt(i),
    nodes: graph(i),
    edges: [],
    filePath: "/models/a.py",
    description: `Edit ${i}`,
    timestamp: Date.now(),
    positions: { node_0: { x: i, y: i * 2 } },
  };
}

const h = () => useHistoryStore.getState();

function pushSteps(n: number, from = 0) {
  for (let i = from; i < from + n; i++) h().pushSnapshot(step(i));
}

describe("undo depth (#558)", () => {
  beforeEach(() => {
    h().clear();
    h().setBudget(DEFAULT_BUDGET);
  });

  it("keeps every step past the old cap of 500", () => {
    pushSteps(1200);
    const { past } = h();
    expect(past.length).toBe(1200);
    expect(past[0].source).toBe(codeAt(0));
    expect(h().evicted).toBe(0);
  });

  it("compacts the oldest steps once the whole ones are over budget", () => {
    h().setBudget({ fullBytes: 200_000 });
    pushSteps(300);
    const { past } = h();
    const stats = h().stats();
    expect(past.length).toBe(300);
    expect(stats.compact).toBeGreaterThan(200);
    expect(stats.full).toBeGreaterThanOrEqual(KEEP_FULL_MIN);
    // The newest are whole; the oldest are compact, with no graph.
    expect(past[past.length - 1].compact).toBeFalsy();
    expect(past[past.length - 1].nodes.length).toBe(20);
    expect(past[0].compact).toBe(true);
    expect(past[0].nodes).toEqual([]);
    // Whole steps fit the budget, apart from the few always kept whole.
    expect(stats.fullBytes).toBeLessThanOrEqual(Math.max(200_000, past.slice(-KEEP_FULL_MIN).length * 50_000));
    // Every step still reads back its own code and positions.
    past.forEach((s, i) => {
      expect(s.source).toBe(codeAt(i));
      expect(s.positions).toEqual({ node_0: { x: i, y: i * 2 } });
    });
  });

  it("a compact step holds a small fraction of a whole one", () => {
    h().setBudget({ fullBytes: 200_000 });
    pushSteps(400);
    const { past } = h();
    const stats = h().stats();
    const compactBytes = stats.bytes - stats.fullBytes;
    // A whole step here is ~ 20 nodes × 1.5 KB of data + 8 KB of code.
    expect(compactBytes / stats.compact).toBeLessThan(1500);
    expect(stats.fullBytes / stats.full).toBeGreaterThan(20_000);
    // Code is kept whole at least every KEYFRAME_EVERY compact steps, so a
    // read never walks far.
    const plain = past.filter((s) => s.compact && Object.getOwnPropertyDescriptor(s, "source")?.value !== undefined);
    expect(plain.length).toBeGreaterThanOrEqual(Math.floor(stats.compact / KEYFRAME_EVERY));
  });

  it("undo walks back into compacted steps, restoring code and positions, and redo returns", () => {
    h().setBudget({ fullBytes: 200_000 });
    pushSteps(600);
    for (let i = 598; i >= 0; i--) {
      const s = h().undo();
      expect(s?.source).toBe(codeAt(i));
      expect(s?.positions).toEqual({ node_0: { x: i, y: i * 2 } });
    }
    expect(h().undo()).toBeNull();
    expect(h().past[0].source).toBe(codeAt(0));
    for (let i = 1; i < 600; i++) expect(h().redo()?.source).toBe(codeAt(i));
    expect(h().redo()).toBeNull();
  });

  it("a new edit after undoing into compacted steps keeps the older ones right", () => {
    h().setBudget({ fullBytes: 200_000 });
    pushSteps(300);
    for (let i = 0; i < 250; i++) h().undo();
    // Now at step 49, compact; its code was a delta from step 50.
    const top = h().past[h().past.length - 1];
    expect(top.compact).toBe(true);
    h().pushSnapshot({ ...step(1000), description: "New branch" });
    expect(h().future).toEqual([]);
    const { past } = h();
    expect(past.length).toBe(51);
    past.slice(0, 50).forEach((s, i) => expect(s.source).toBe(codeAt(i)));
    expect(past[50].source).toBe(codeAt(1000));
  });

  it("batching onto a compact current step keeps the step before it right", () => {
    h().setBudget({ fullBytes: 200_000 });
    pushSteps(300);
    for (let i = 0; i < 250; i++) h().undo();
    // Two edits with one batch key, inside 500 ms: the second replaces the first.
    h().pushSnapshot({ ...step(2000), description: "Modified gain in node_1" });
    h().pushSnapshot({ ...step(2001), description: "Modified gain in node_1" });
    const { past } = h();
    expect(past.length).toBe(51);
    past.slice(0, 50).forEach((s, i) => expect(s.source).toBe(codeAt(i)));
    expect(past[50].source).toBe(codeAt(2001));
  });

  it("an identical push onto a compact step adds nothing", () => {
    h().setBudget({ fullBytes: 200_000 });
    pushSteps(300);
    for (let i = 0; i < 250; i++) h().undo();
    // The graph rebuilt from the code records "Model updated" with the same code.
    h().pushSnapshot({ ...step(49), description: "Model updated" });
    expect(h().past.length).toBe(50);
    expect(h().future.length).toBe(250);
  });

  it("drops the oldest only past the total budget, and counts them", () => {
    h().setBudget({ fullBytes: 1_000_000, totalBytes: 1_300_000 });
    pushSteps(2000);
    const stats = h().stats();
    expect(h().evicted).toBeGreaterThan(0);
    expect(stats.bytes).toBeLessThanOrEqual(1_300_000);
    const { past } = h();
    expect(past.length + h().evicted).toBe(2000);
    // What is left is the newest, intact.
    past.forEach((s, i) => expect(s.source).toBe(codeAt(h().evicted + i)));
  });

  it("History says it keeps every step, or how many it dropped", () => {
    expect(depthLabel(0, DEFAULT_BUDGET.totalBytes).text).toBe("keeps every step");
    expect(depthLabel(12, 128 * 1024 * 1024).text).toBe("keeps about 128 MB; 12 oldest dropped");
  });
});

describe("saves on compact steps (#558, #1349)", () => {
  beforeEach(() => {
    h().clear();
    h().setBudget({ ...DEFAULT_BUDGET, fullBytes: 200_000 });
  });

  it("save marks survive compaction, and on disk still finds its step", () => {
    pushSteps(10);
    h().markSaved(step(9), { at: 1000, kind: "manual" });
    pushSteps(290, 10);
    const { past } = h();
    expect(past[9].compact).toBe(true);
    expect(past[9].saves).toEqual([{ at: 1000, kind: "manual" }]);
    expect(onDiskIndex(past, codeAt(9))).toBe(9);
    expect(sameSource(past[9], codeAt(9))).toBe(true);
    expect(sameSource(past[9], codeAt(8))).toBe(false);
    expect(onDiskIndex(past, "not in history")).toBe(-1);
  });

  it("undoing to a compact saved step offers it; saving it again marks it", () => {
    pushSteps(10);
    h().markSaved(step(9), { at: 1000, kind: "manual" });
    pushSteps(290, 10);
    for (let i = 0; i < 290; i++) h().undo();
    const { past } = h();
    expect(past[past.length - 1].compact).toBe(true);
    const at = saveAtPosition(past, codeAt(299));
    expect(at?.mark.at).toBe(1000);
    expect(at?.snapshot.source).toBe(codeAt(9));
    // An autosave of the same code marks the same step, adding none.
    h().markSaved({ ...step(9), description: "Saved" }, { at: 2000, kind: "auto" });
    const after = h().past;
    expect(after.length).toBe(10);
    expect(after[9].saves?.map((m) => m.kind)).toEqual(["manual", "auto"]);
    after.forEach((s, i) => expect(s.source).toBe(codeAt(i)));
    // Redo still walks forward from it.
    expect(h().redo()?.source).toBe(codeAt(10));
  });
});
