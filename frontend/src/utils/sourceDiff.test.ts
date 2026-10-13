import { describe, it, expect } from "vitest";
import { diffSource, condense, summarize } from "./sourceDiff";

// Showing how a graph edit changed the code (#1093).

const BEFORE = `import psyneulink as pnl

a = pnl.TransferMechanism(name="a")
b = pnl.TransferMechanism(name="b")

comp = pnl.Composition()
comp.add_node(a)
comp.add_node(b)
`;

describe("diffSource", () => {
  it("reports an identical source as unchanged", () => {
    const d = diffSource(BEFORE, BEFORE);
    expect(d.unchanged).toBe(true);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it("shows the lines a node deletion removed", () => {
    // The #1092 case: deleting `b` drops its declaration and its add_node.
    const after = BEFORE.replace('b = pnl.TransferMechanism(name="b")\n', "")
      .replace("comp.add_node(b)\n", "");
    const d = diffSource(BEFORE, after);
    expect(d.removed).toBe(2);
    expect(d.added).toBe(0);
    const removed = d.lines.filter((l) => l.kind === "removed").map((l) => l.text);
    expect(removed).toEqual([
      'b = pnl.TransferMechanism(name="b")',
      "comp.add_node(b)",
    ]);
  });

  it("shows the lines an addition introduced", () => {
    const after = BEFORE.replace(
      "comp.add_node(b)",
      'comp.add_node(b)\nc = pnl.TransferMechanism(name="c")',
    );
    const d = diffSource(BEFORE, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(d.lines.find((l) => l.kind === "added")?.text)
      .toBe('c = pnl.TransferMechanism(name="c")');
  });

  it("treats a modified line as a removal plus an addition", () => {
    const after = BEFORE.replace('name="a"', 'name="renamed"');
    const d = diffSource(BEFORE, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it("keeps context lines so the change can be located", () => {
    const after = BEFORE.replace("comp.add_node(b)\n", "");
    const d = diffSource(BEFORE, after);
    expect(d.lines.some((l) => l.kind === "context")).toBe(true);
  });

  it("numbers added lines against the new file and removed against the old", () => {
    const after = "x\n" + BEFORE;
    const d = diffSource(BEFORE, after);
    const firstAdded = d.lines.find((l) => l.kind === "added");
    expect(firstAdded?.lineNumber).toBe(1);
  });

  it("degrades rather than hanging on a pathologically large file", () => {
    // The table is quadratic; past the bound report the size change only.
    const huge = new Array(2100).fill("line").join("\n");
    const d = diffSource(huge, huge + "\nextra");
    expect(d.unchanged).toBe(false);
    expect(d.lines).toEqual([]);
    expect(d.added).toBe(1);
  });

  it("handles an empty starting file", () => {
    const d = diffSource("", 'a = pnl.TransferMechanism(name="a")');
    expect(d.added).toBe(1);
  });
});

describe("condense", () => {
  it("elides context far from any change", () => {
    const before = new Array(40).fill(0).map((_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 20", "line 20 changed");
    const condensed = condense(diffSource(before, after), 2);
    // Far-away lines are replaced by gap markers, so the result is much
    // shorter than the file.
    expect(condensed.length).toBeLessThan(15);
    expect(condensed.some((l) => l.text === "…")).toBe(true);
    expect(condensed.some((l) => l.text === "line 20 changed")).toBe(true);
  });

  it("returns nothing for an unchanged source", () => {
    expect(condense(diffSource(BEFORE, BEFORE))).toEqual([]);
  });

  it("collapses a run of elided lines into one marker", () => {
    const before = new Array(40).fill(0).map((_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 1\n", "");
    const condensed = condense(diffSource(before, after), 1);
    const markers = condensed.filter((l) => l.text === "…");
    expect(markers.length).toBe(1);
  });
});

describe("summarize", () => {
  it("counts both directions", () => {
    const after = BEFORE.replace('name="a"', 'name="renamed"');
    expect(summarize(diffSource(BEFORE, after))).toBe("+1 −1");
  });

  it("omits a side that saw no change", () => {
    const after = BEFORE.replace("comp.add_node(b)\n", "");
    expect(summarize(diffSource(BEFORE, after))).toBe("−1");
  });

  it("says so plainly when the edit changed nothing", () => {
    // Exactly the #1092 situation, now visible instead of silent.
    expect(summarize(diffSource(BEFORE, BEFORE))).toBe("no change to the code");
  });
});
