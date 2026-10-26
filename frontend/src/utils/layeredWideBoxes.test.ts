import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { applyDagreLayout, layoutInsetInternals } from "./layout";
import { autoSizeGroups } from "@/stores/modelStore";

// One node feeding three in a row, as EGO's STATE feeds its EM fields. The
// boxes are drawn wider than the 180px Layered assumes when `width` is given.
const mech = (id: string, width?: number, parentId?: string): Node => ({
  id,
  type: "mechanismNode",
  position: { x: 0, y: 0 },
  data: { label: id },
  ...(width ? { measured: { width, height: 73 } } : {}),
  ...(parentId ? { parentId } : {}),
});
const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target });
const row = (width?: number, parentId?: string) => [
  mech("SOURCE", width, parentId),
  mech("A", width, parentId),
  mech("B", width, parentId),
  mech("C", width, parentId),
];
const EDGES = [edge("SOURCE", "A"), edge("SOURCE", "B"), edge("SOURCE", "C")];

function overlapsInRow(nodes: Node[], width: number): string[] {
  const xs = nodes.filter((n) => n.id !== "SOURCE").map((n) => ({ id: n.id, x: n.position.x }));
  xs.sort((a, b) => a.x - b.x);
  return xs.slice(1).flatMap((b, i) => (b.x < xs[i].x + width ? [`${xs[i].id} / ${b.id}`] : []));
}

describe("Layered with boxes wider than it assumes (#72)", () => {
  it("spaces wide boxes so they don't overlap", () => {
    const laid = applyDagreLayout(row(320), EDGES);
    expect(overlapsInRow(laid, 320)).toEqual([]);
  });

  it("keeps the layout of boxes no wider than it assumes", () => {
    const unsized = applyDagreLayout(row(), EDGES).map((n) => n.position);
    const narrow = applyDagreLayout(row(150), EDGES).map((n) => n.position);
    expect(narrow).toEqual(unsized);
  });

  it("sizes an inset frame to hold its wide members", () => {
    const frame: Node = {
      id: "EM",
      type: "compositionNode",
      position: { x: 0, y: 0 },
      data: { label: "EM", inset: true },
    };
    const nodes = [frame, ...row(320, "EM")];
    const width = layoutInsetInternals(nodes, EDGES).get("EM")!.width;
    for (const m of nodes.slice(1)) expect(m.position.x + 320).toBeLessThanOrEqual(width);
  });

  it("fits a frame to a wide member when frames are sized to their members", () => {
    const frame: Node = { id: "EM", type: "compositionNode", position: { x: 0, y: 0 }, data: {} };
    const member = { ...mech("A", 320, "EM"), position: { x: 400, y: 50 } };
    const nodes = [frame, member];
    autoSizeGroups(nodes);
    expect(frame.style?.width).toBeGreaterThanOrEqual(400 + 320);
  });
});
