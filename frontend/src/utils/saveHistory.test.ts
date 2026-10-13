import { describe, expect, it } from "vitest";
import type { SaveMark, Snapshot } from "@/stores/historyStore";
import {
  canRevertTo,
  latestSave,
  needsSeconds,
  listSaves,
  onDiskIndex,
  revertBlock,
  saveAtPosition,
  saveLabel,
} from "./saveHistory";

function step(source: string, saves?: SaveMark[]): Snapshot {
  return { source, nodes: [], edges: [], filePath: "/m.py", description: source, timestamp: 0, saves };
}

// 14:32 local time on some day, whatever the machine's zone.
const at = (h: number, m: number) => new Date(2026, 9, 10, h, m).getTime();
const hhmm = (h: number, m: number) =>
  new Date(2026, 9, 10, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

describe("saves in History (#1349)", () => {
  it("labels a save by kind", () => {
    expect(saveLabel({ at: at(14, 32), kind: "manual" })).toBe(`Saved ${hhmm(14, 32)}`);
    expect(saveLabel({ at: at(14, 32), kind: "auto" })).toBe(`Autosaved ${hhmm(14, 32)}`);
    expect(saveLabel({ at: at(14, 40), kind: "revert", revertedTo: at(14, 32) })).toBe(
      `Saved ${hhmm(14, 40)} (reverted to ${hhmm(14, 32)})`,
    );
  });

  it("lists the saves in order, and finds the latest by time", () => {
    const entries = [step("a"), step("b", [{ at: 1, kind: "manual" }]), step("c", [{ at: 2, kind: "auto" }, { at: 3, kind: "manual" }])];
    expect(listSaves(entries).map((s) => [s.index, s.mark.at])).toEqual([[1, 1], [2, 2], [2, 3]]);
    expect(latestSave(entries)?.mark.at).toBe(3);
    expect(latestSave([step("a")])).toBeNull();
  });

  it("offers a revert only for a save the file no longer holds", () => {
    const entries = [step("a"), step("b", [{ at: 1, kind: "manual" }]), step("c", [{ at: 2, kind: "manual" }])];
    const [earlier, latest] = listSaves(entries);
    // On disk: the latest save. Reverting to it would change nothing.
    expect(canRevertTo(latest, "c")).toBe(false);
    expect(canRevertTo(earlier, "c")).toBe(true);
    // A graph edit wrote something else since: the latest save is revertable too.
    expect(canRevertTo(latest, "c-plus-graph-edit")).toBe(true);
  });

  it("says when undo has left you at a save the file doesn't hold", () => {
    const past = [step("a"), step("b", [{ at: 1, kind: "manual" }])];
    // Undone from c (saved, on disk) to b.
    expect(saveAtPosition(past, "c")?.mark.at).toBe(1);
    // At the save that is on disk: nothing to offer.
    expect(saveAtPosition(past, "b")).toBeNull();
    // At a step that isn't a save.
    expect(saveAtPosition([step("a"), step("x")], "c")).toBeNull();
  });

  it("tags the newest step holding the text on disk", () => {
    const entries = [step("a"), step("b"), step("a")];
    expect(onDiskIndex(entries, "a")).toBe(2);
    expect(onDiskIndex(entries, "b")).toBe(1);
    expect(onDiskIndex(entries, "z")).toBe(-1);
  });

  it("is never offered for a locked, protected, or file-less model", () => {
    expect(revertBlock({ filePath: "/m.py", viewOnly: false, pnlProtected: false })).toBeNull();
    expect(revertBlock({ filePath: "/m.py", viewOnly: true, pnlProtected: false })).toBe("locked");
    expect(revertBlock({ filePath: "/m.py", viewOnly: false, pnlProtected: true })).toBe("protected");
    expect(revertBlock({ filePath: null, viewOnly: false, pnlProtected: false })).toBe("noFile");
  });

  it("shows seconds only when two saves share a minute", () => {
    expect(needsSeconds([{ at: at(14, 32), kind: "manual" }, { at: at(14, 33), kind: "auto" }])).toBe(false);
    expect(needsSeconds([{ at: at(14, 32), kind: "manual" }, { at: at(14, 32) + 20_000, kind: "manual" }])).toBe(true);
    expect(saveLabel({ at: at(14, 32) + 7_000, kind: "manual" }, true)).toMatch(/:07/);
  });
});
