import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { boxesOverlap, overlapNotice, separateOverlappingNodes, NUDGE_GAP } from "./nodeOverlap";

const mech = (id: string, x: number, y: number, parentId?: string): Node => ({
  id,
  type: "mechanismNode",
  position: { x, y },
  data: { label: id },
  ...(parentId ? { parentId } : {}),
});
const frame = (id: string, x: number, y: number): Node => ({
  id,
  type: "compositionNode",
  position: { x, y },
  style: { width: 400, height: 300 },
  data: {},
});
// Drawn sizes: a 170-wide node, and BIAS's small oval.
const SIZES: Record<string, { w: number; h: number }> = { BIAS: { w: 64, h: 40 } };
const sizeOf = (n: Node) =>
  n.type === "compositionNode"
    ? { w: n.style!.width as number, h: n.style!.height as number }
    : SIZES[n.id] ?? { w: 170, h: 40 };
const boxOf = (n: Node) => ({ ...n.position, ...sizeOf(n) });
const noOverlaps = (nodes: Node[]) => {
  const mechs = nodes.filter((n) => n.type === "mechanismNode");
  for (let i = 0; i < mechs.length; i++)
    for (let j = i + 1; j < mechs.length; j++)
      if ((mechs[i].parentId ?? "") === (mechs[j].parentId ?? "") && boxesOverlap(boxOf(mechs[i]), boxOf(mechs[j])))
        return false;
  return true;
};

describe("nudging overlapping nodes apart (#389)", () => {
  it("leaves a layout with no overlaps exactly as saved", () => {
    const nodes = [mech("A", 0, 0), mech("B", 200, 0), mech("C", 0, 100)];
    const before = nodes.map((n) => n.position);
    expect(separateOverlappingNodes(nodes, sizeOf)).toEqual([]);
    nodes.forEach((n, i) => expect(n.position).toBe(before[i]));
  });

  it("ignores boxes that only touch or overlap by a border's width", () => {
    const nodes = [mech("A", 0, 0), mech("B", 167, 0)]; // 3px overlap
    expect(separateOverlappingNodes(nodes, sizeOf)).toEqual([]);
    expect(nodes[1].position).toEqual({ x: 167, y: 0 });
  });

  it("moves only the later node, the shortest way, just clear of the other", () => {
    // WORDS_INPUT drawn 200 wide over BIAS at x=188: 30px to clear going right.
    const nodes = [mech("WORDS_INPUT", 18, 900), mech("BIAS", 188, 900), mech("COLORS_INPUT", 358, 900)];
    SIZES.WORDS_INPUT = { w: 200, h: 40 };
    try {
      expect(separateOverlappingNodes(nodes, sizeOf)).toEqual(["BIAS"]);
      expect(nodes[0].position).toEqual({ x: 18, y: 900 });
      expect(nodes[1].position).toEqual({ x: 18 + 200 + NUDGE_GAP, y: 900 });
      expect(nodes[2].position).toEqual({ x: 358, y: 900 });
      expect(noOverlaps(nodes)).toBe(true);
    } finally {
      delete SIZES.WORDS_INPUT;
    }
  });

  it("gives the same result whatever order the nodes arrive in", () => {
    const make = () => [mech("A", 0, 0), mech("B", 100, 10), mech("C", 150, 20), mech("D", 0, 30)];
    const forward = make();
    const backward = make().reverse();
    separateOverlappingNodes(forward, sizeOf);
    separateOverlappingNodes(backward, sizeOf);
    const at = (ns: Node[]) => Object.fromEntries(ns.map((n) => [n.id, n.position]));
    expect(at(backward)).toEqual(at(forward));
    expect(noOverlaps(forward)).toBe(true);
  });

  it("a node pushed onto another pushes that one the same way", () => {
    // Three tall nodes (type and role tags on) packed too tight in a row:
    // the row opens up rightwards.
    const tall = () => ({ w: 170, h: 80 });
    const nodes = [mech("A", 0, 0), mech("B", 100, 0), mech("C", 200, 0)];
    const moved = separateOverlappingNodes(nodes, tall);
    expect(moved).toEqual(["B", "C"]);
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 170 + NUDGE_GAP, y: 0 },
      { x: 2 * (170 + NUDGE_GAP), y: 0 },
    ]);
  });

  it("separates two nodes saved at the same spot", () => {
    const nodes = [mech("A", 50, 50), mech("B", 50, 50)];
    expect(separateOverlappingNodes(nodes, sizeOf)).toEqual(["B"]);
    // 40 high vs 170 wide: down is the shorter way out.
    expect(nodes[1].position).toEqual({ x: 50, y: 50 + 40 + NUDGE_GAP });
  });

  it("compares nodes only with their siblings and leaves open frames alone", () => {
    const f = frame("F", 0, 0);
    // Inside the frame, relative coordinates: these overlap.
    const inner = [mech("I1", 20, 50, "F"), mech("I2", 30, 55, "F")];
    // Outside, at the same numbers but a different parent: no clash with I1.
    const outer = mech("O", 20, 50);
    const nodes = [f, ...inner, outer];
    const moved = separateOverlappingNodes(nodes, sizeOf);
    expect(moved).toEqual(["I2"]);
    expect(f.position).toEqual({ x: 0, y: 0 });
    expect(outer.position).toEqual({ x: 20, y: 50 });
  });

  it("settles a pile of nodes saved on top of one another", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => mech(`N${i}`, (i % 3) * 20, (i % 4) * 10));
    separateOverlappingNodes(nodes, sizeOf);
    expect(noOverlaps(nodes)).toBe(true);
  });

  it("is fast on a graph the size of EGO's and well beyond", () => {
    // EGO draws 21 mechanisms; a 200-node grid packed too tight is the stress case.
    const grid = Array.from({ length: 200 }, (_, i) => mech(`G${i}`, (i % 20) * 150, Math.floor(i / 20) * 35));
    const t0 = performance.now();
    separateOverlappingNodes(grid, sizeOf);
    const ms = performance.now() - t0;
    expect(noOverlaps(grid)).toBe(true);
    expect(ms).toBeLessThan(50);
  });

  it("says once, in plain words, which nodes moved", () => {
    expect(overlapNotice(["BIAS"])).toMatch(/^Two nodes overlapped in the saved layout; moved BIAS slightly/);
    expect(overlapNotice(["A", "B", "C", "D", "E"])).toMatch(/moved A, B, C and 2 more slightly/);
    expect(overlapNotice(["BIAS"])).toMatch(/unchanged until you next move a node/);
  });
});
