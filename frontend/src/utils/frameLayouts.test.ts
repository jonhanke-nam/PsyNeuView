import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { applyForceLayout, applyRadialLayout, topLevelEdges } from "./layout";

// EGO flattened (#35), reduced: EM is an inset frame of a real size whose
// members carry every edge to it; the rest of the model is top-level.
const frame: Node = {
  id: "cluster::EM", type: "compositionNode", position: { x: 0, y: 0 },
  data: { inset: true }, style: { width: 1100, height: 1384 },
};
const member = (id: string): Node => ({ id, type: "mechanismNode", parentId: "cluster::EM", position: { x: 20, y: 40 }, data: {} });
const mech = (id: string): Node => ({ id, type: "mechanismNode", position: { x: 0, y: 0 }, data: {} });
const NODES: Node[] = [
  frame, member("STATE [VALUE]"), member("PREVIOUS STATE [QUERY]"), member("CONTEXT [QUERY]"), member("STATE [RETRIEVED]"),
  mech("STATE"), mech("PREVIOUS STATE"), mech("CONTEXT"), mech("CONTEXT [NORMALIZED]"), mech("CONTEXT [BIAS]"),
  mech("PREDICTION"), mech("LOSS for PREDICTION"),
];
const e = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target });
const EDGES: Edge[] = [
  e("STATE", "STATE [VALUE]"), e("PREVIOUS STATE", "PREVIOUS STATE [QUERY]"), e("CONTEXT [NORMALIZED]", "CONTEXT [QUERY]"),
  e("STATE [RETRIEVED]", "PREDICTION"), e("PREDICTION", "LOSS for PREDICTION"), e("STATE", "PREVIOUS STATE"),
  e("STATE", "CONTEXT"), e("CONTEXT", "CONTEXT [NORMALIZED]"), e("CONTEXT [BIAS]", "CONTEXT [NORMALIZED]"),
  e("STATE [VALUE]", "STATE [RETRIEVED]"),
];

const boxes = (laid: Node[]) =>
  laid.filter((n) => !n.parentId).map((n) => ({
    id: n.id, x: n.position.x, y: n.position.y,
    w: (n.style?.width as number) ?? 180, h: (n.style?.height as number) ?? 60,
  }));

describe("Radial and Force with frames (#35)", () => {
  it("count an edge to a frame's member as an edge to the frame", () => {
    const top = topLevelEdges(NODES, EDGES).map((x) => `${x.source}>${x.target}`);
    expect(top).toContain("STATE>cluster::EM");
    expect(top).toContain("cluster::EM>PREDICTION");
    expect(top).not.toContain("cluster::EM>cluster::EM"); // member-to-member stays inside
  });

  it("Force keeps a frame with the rest of the model: finite, compact, nothing on top of it", () => {
    const b = boxes(applyForceLayout(NODES, EDGES));
    for (const x of b) {
      expect(Number.isFinite(x.x) && Number.isFinite(x.y)).toBe(true);
    }
    const span = Math.max(...b.map((x) => x.x + x.w)) - Math.min(...b.map((x) => x.x));
    expect(span).toBeLessThan(4000); // was ~9,000 px: beyond the furthest zoom
    const f = b.find((x) => x.id === "cluster::EM")!;
    for (const x of b.filter((y) => y.id !== f.id)) {
      const overlap = x.x < f.x + f.w && f.x < x.x + x.w && x.y < f.y + f.h && f.y < x.y + x.h;
      expect(overlap, `${x.id} on top of EM`).toBe(false);
    }
  });

  it("Radial puts the frame by what it connects to, not on the outer ring", () => {
    const laid = applyRadialLayout(NODES, EDGES);
    const at = (id: string) => laid.find((n) => n.id === id)!.position;
    const dist = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    // EM sits between its feeders and PREDICTION, nearer them than the far end of the model.
    expect(Number.isFinite(at("cluster::EM").x)).toBe(true);
    expect(dist("cluster::EM", "PREDICTION")).toBeLessThan(dist("CONTEXT [BIAS]", "LOSS for PREDICTION"));
  });
});
