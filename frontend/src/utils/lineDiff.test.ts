import { describe, expect, it } from "vitest";

import { collapseUnchanged, countChanges, describeChanges, diffLines, hasChanges, toSideBySide } from "./lineDiff";

const texts = (rows: ReturnType<typeof diffLines>, kind: string) =>
  rows.filter((r) => r.kind === kind).map((r) => r.text);

describe("diffLines", () => {
  it("reports no changes for identical text", () => {
    const rows = diffLines("a\nb\n", "a\nb\n");
    expect(hasChanges(rows)).toBe(false);
    expect(rows.every((r) => r.kind === "same")).toBe(true);
  });

  it("finds an inserted line without rewriting its neighbours", () => {
    const rows = diffLines("a\nc\n", "a\nb\nc\n");
    expect(texts(rows, "added")).toEqual(["b"]);
    expect(texts(rows, "removed")).toEqual([]);
  });

  it("finds a removed line", () => {
    const rows = diffLines("a\nb\nc\n", "a\nc\n");
    expect(texts(rows, "removed")).toEqual(["b"]);
    expect(texts(rows, "added")).toEqual([]);
  });

  it("shows a changed line as a removal and an addition", () => {
    const rows = diffLines("x = 1\n", "x = 2\n");
    expect(texts(rows, "removed")).toEqual(["x = 1"]);
    expect(texts(rows, "added")).toEqual(["x = 2"]);
  });

  it("keeps line numbers that point back at each version", () => {
    const rows = diffLines("a\nb\nc", "a\nB\nc");
    const removed = rows.find((r) => r.kind === "removed")!;
    const added = rows.find((r) => r.kind === "added")!;
    expect(removed.leftNo).toBe(2);
    expect(removed.rightNo).toBeNull();
    expect(added.rightNo).toBe(2);
    expect(added.leftNo).toBeNull();
  });

  /** The case this exists for: a half-typed line mid-file. */
  it("isolates one broken line in a longer file", () => {
    const before = ["import x", "", "a = Thing()", "b = Thing()", "", "run()"].join("\n");
    const after = ["import x", "", "a = Thing(", "b = Thing()", "", "run()"].join("\n");
    const rows = diffLines(before, after);
    expect(texts(rows, "removed")).toEqual(["a = Thing()"]);
    expect(texts(rows, "added")).toEqual(["a = Thing("]);
  });

  it("handles one side being empty", () => {
    expect(texts(diffLines("", "a\nb"), "added")).toEqual(["a", "b"]);
    expect(texts(diffLines("a\nb", ""), "removed")).toEqual(["a", "b"]);
  });
});

describe("collapseUnchanged", () => {
  it("hides long runs of unchanged lines and says how many", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 20", "line 20 changed");
    const collapsed = collapseUnchanged(diffLines(before, after), 2);

    const gaps = collapsed.filter((r) => r.kind === "gap") as Array<{ hidden: number }>;
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.hidden > 0)).toBe(true);
    // The change and its context survive.
    const kept = collapsed.filter((r) => "text" in r) as Array<{ text: string }>;
    expect(kept.some((r) => r.text === "line 20 changed")).toBe(true);
    expect(kept.some((r) => r.text === "line 19")).toBe(true);
  });

  it("collapses nothing when everything is near a change", () => {
    const collapsed = collapseUnchanged(diffLines("a\nb", "a\nB"), 3);
    expect(collapsed.some((r) => r.kind === "gap")).toBe(false);
  });

  /** A gap must never stand in for a change. */
  it("never hides a changed line", () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l5", "l5!").replace("l25", "l25!");
    const collapsed = collapseUnchanged(diffLines(before, after), 1);
    const kept = collapsed.filter((r) => "text" in r) as Array<{ text: string; kind: string }>;
    expect(kept.filter((r) => r.kind === "added").map((r) => r.text)).toEqual(["l5!", "l25!"]);
  });
});

describe("countChanges and describeChanges (#1348)", () => {
  const summary = (before: string, after: string) => describeChanges(countChanges(diffLines(before, after)));

  it("says No changes when the two texts match", () => {
    expect(countChanges(diffLines("a\nb\n", "a\nb\n"))).toEqual({ added: 0, removed: 0 });
    expect(summary("a\nb\n", "a\nb\n")).toBe("No changes");
  });

  it("counts a changed line once each way", () => {
    expect(countChanges(diffLines("x = 1\n", "x = 2\n"))).toEqual({ added: 1, removed: 1 });
    expect(summary("x = 1\n", "x = 2\n")).toBe("1 line added, 1 removed");
  });

  it("leaves out the side that has nothing", () => {
    expect(summary("a\n", "a\nb\nc\n")).toBe("2 lines added");
    expect(summary("a\nb\n", "a\n")).toBe("1 line removed");
  });

  it("counts several changes across the file", () => {
    const before = "a\nb\nc\nd\ne\n";
    const after = "a\nB\nc\ne\nf\ng\n";
    expect(countChanges(diffLines(before, after))).toEqual({ added: 3, removed: 2 });
    expect(summary(before, after)).toBe("3 lines added, 2 removed");
  });
});

describe("toSideBySide (#1348)", () => {
  it("pairs a removal with the addition that replaced it", () => {
    const split = toSideBySide(diffLines("a\nx = 1\nc", "a\nx = 2\nc"));
    expect(split).toHaveLength(3);
    const middle = split[1];
    expect(middle.kind).toBe("pair");
    if (middle.kind !== "pair") return;
    expect(middle.left?.text).toBe("x = 1");
    expect(middle.right?.text).toBe("x = 2");
  });

  it("leaves a blank on the shorter side", () => {
    const split = toSideBySide(diffLines("a\nc", "a\nb1\nb2\nc"));
    const pairs = split.filter((r) => r.kind === "pair") as Array<Extract<ReturnType<typeof toSideBySide>[number], { kind: "pair" }>>;
    const inserted = pairs.filter((p) => p.left === null);
    expect(inserted.map((p) => p.right?.text)).toEqual(["b1", "b2"]);
  });

  it("keeps a gap as a gap", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const split = toSideBySide(collapseUnchanged(diffLines(before, after), 2));
    expect(split[0]).toEqual({ kind: "gap", hidden: 8 });
    expect(split[split.length - 1]).toEqual({ kind: "gap", hidden: 7 });
  });
});
