/**
 * #353: a failing load is blamed on the last graph edit only when the line
 * that failed is one the edit wrote.
 */
import { describe, expect, it } from "vitest";
import { blameGraphEdit, writtenLines, type GraphEdit } from "./graphEditBlame";

const BEFORE = ["import psyneulink as pnl", "", "a = pnl.TransferMechanism(name='a')", "", "comp = pnl.Composition()", "comp.add_node(a)"].join("\n");

// An add: a declaration among the mechanisms (lines 5-8) and its add_node at the end (line 12).
const AFTER = [
  "import psyneulink as pnl",
  "",
  "a = pnl.TransferMechanism(name='a')",
  "",
  "b = pnl.TransferMechanism(",
  "    gain=oops,",
  "    name='b'",
  ")",
  "",
  "comp = pnl.Composition()",
  "comp.add_node(a)",
  "comp.add_node(b)",
].join("\n");

const ADD: GraphEdit = { kind: "add", label: "b", before: BEFORE };

describe("writtenLines", () => {
  it("is null when nothing changed", () => {
    expect(writtenLines(BEFORE, BEFORE)).toBeNull();
  });

  it("covers everything between the first and last line written", () => {
    expect(writtenLines(BEFORE, AFTER)).toEqual({ first: 5, last: 12 });
  });

  it("points at the place lines were taken out from", () => {
    const removed = BEFORE.replace("a = pnl.TransferMechanism(name='a')\n", "");
    expect(writtenLines(BEFORE, removed)).toEqual({ first: 3, last: 3 });
  });
});

describe("blameGraphEdit", () => {
  it("names the edit when the failing line is one it wrote", () => {
    expect(blameGraphEdit(ADD, AFTER, 6)).toBe("Adding b broke the model at line 6.");
  });

  it("uses the words for each kind of edit", () => {
    expect(blameGraphEdit({ ...ADD, kind: "function", label: "b's function to Logistic" }, AFTER, 5)).toBe(
      "Setting b's function to Logistic broke the model at line 5.",
    );
    expect(blameGraphEdit({ ...ADD, kind: "connect", label: "a to b" }, AFTER, 12)).toBe(
      "Connecting a to b broke the model at line 12.",
    );
  });

  it("blames nothing for a line the edit did not write", () => {
    expect(blameGraphEdit(ADD, AFTER, 1)).toBeNull();
    expect(blameGraphEdit(ADD, AFTER, 3)).toBeNull();
  });

  it("blames nothing without an edit, a line, or a change", () => {
    expect(blameGraphEdit(null, AFTER, 6)).toBeNull();
    expect(blameGraphEdit(ADD, AFTER, null)).toBeNull();
    expect(blameGraphEdit(ADD, BEFORE, 3)).toBeNull();
  });
});
