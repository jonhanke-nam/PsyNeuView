import { describe, it, expect } from "vitest";
import {
  ovalBoundaryPoint,
  offsetAttach,
  hubFanDirection,
  clusterLane,
  proximityLane,
  laneOffsetFor,
  FAN_MIN_GAP_RAD,
  LANE_GAP_PX,
  type Oval,
} from "./edgeLanes";

// ---- test scaffolding ---------------------------------------------------
// ovalOf reads (internals.positionAbsolute ?? position) + measured.{width,height}
// and returns the ellipse center. Build a plain node record whose CENTER is
// (cx, cy) so tests can reason in center coordinates.
const W = 150, H = 60;
function node(cx: number, cy: number) {
  return { position: { x: cx - W / 2, y: cy - H / 2 }, measured: { width: W, height: H } };
}
const deg = (d: number) => (d * Math.PI) / 180;
// A node whose center sits `dist` px from (ox,oy) at screen-angle `angleDeg`
// (negative = up-right, since screen y grows downward).
function at(ox: number, oy: number, angleDeg: number, dist: number) {
  const a = deg(angleDeg);
  return node(ox + Math.cos(a) * dist, oy + Math.sin(a) * dist);
}
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

describe("ovalBoundaryPoint / offsetAttach stay on the oval", () => {
  const o: Oval = { cx: 100, cy: 200, a: 75, b: 30 };
  const onOval = (p: { x: number; y: number }) =>
    ((p.x - o.cx) / o.a) ** 2 + ((p.y - o.cy) / o.b) ** 2;

  it("boundary point lies exactly on the ellipse", () => {
    for (const [tx, ty] of [[500, 200], [100, -50], [0, 500], [300, 400]]) {
      expect(onOval(ovalBoundaryPoint(o, tx, ty))).toBeCloseTo(1, 6);
    }
  });

  it("offsetAttach keeps the shifted attachment on the ellipse", () => {
    for (const arc of [-30, -10, 0, 10, 30]) {
      expect(onOval(offsetAttach(o, 500, 200, arc))).toBeCloseTo(1, 6);
    }
  });
});

describe("hubFanDirection: order-preserving + min-gap", () => {
  const hub: Oval = { cx: 0, cy: 0, a: 75, b: 30 };
  // three counterparts crowded within a few degrees of each other
  const members = [
    { id: "a", other: { cx: 100, cy: 0, a: 75, b: 30 } },
    { id: "b", other: { cx: 100, cy: 5, a: 75, b: 30 } },
    { id: "c", other: { cx: 100, cy: 10, a: 75, b: 30 } },
  ];

  it("spreads crowded aims to at least the min gap, preserving order", () => {
    const dirs = members.map((m) => hubFanDirection(m.id, hub, members, FAN_MIN_GAP_RAD)!);
    expect(dirs.every((d) => d != null)).toBe(true);
    // input order (a<b<c by natural angle) is preserved
    expect(dirs[0]).toBeLessThan(dirs[1]);
    expect(dirs[1]).toBeLessThan(dirs[2]);
    // adjacent directions are separated by at least the min gap
    expect(dirs[1] - dirs[0]).toBeGreaterThanOrEqual(FAN_MIN_GAP_RAD - 1e-9);
    expect(dirs[2] - dirs[1]).toBeGreaterThanOrEqual(FAN_MIN_GAP_RAD - 1e-9);
  });

  it("returns null for a lone edge (no real bundle)", () => {
    expect(hubFanDirection("a", hub, [members[0]], FAN_MIN_GAP_RAD)).toBeNull();
  });
});

describe("clusterLane: single-linkage over aim, order by angle", () => {
  // STATE at origin; two targets ~5° apart (near-collinear), both up-right.
  const nl = new Map<string, unknown>([
    ["STATE", node(0, 0)],
    ["CONTEXT", at(0, 0, -40, 600)],
    ["LOSS", at(0, 0, -35, 700)],
  ]);
  const edges: Edge[] = [
    { id: "e_ctx", source: "STATE", target: "CONTEXT" },
    { id: "e_loss", source: "STATE", target: "LOSS" },
  ];

  it("groups the two shared-source edges and orders them by aim angle", () => {
    const ctx = clusterLane("e_ctx", "STATE", null, "source", edges, nl);
    const loss = clusterLane("e_loss", "STATE", null, "source", edges, nl);
    expect(ctx.size).toBe(2);
    expect(loss.size).toBe(2);
    // CONTEXT aims more steeply up (-40°) than LOSS (-35°): smaller angle → index 0
    expect(ctx.index).toBe(0);
    expect(loss.index).toBe(1);
  });

  it("a tighter angle threshold still groups a ~5° pair; a wide split does not", () => {
    // 5° apart: inside the 12° tight bow angle
    expect(clusterLane("e_ctx", "STATE", null, "source", edges, nl, deg(12)).size).toBe(2);
    // now make the second target 40° away: outside a 12° threshold → not grouped
    const nlWide = new Map<string, unknown>([
      ["STATE", node(0, 0)],
      ["CONTEXT", at(0, 0, -40, 600)],
      ["FAR", at(0, 0, 0, 700)],
    ]);
    const wide: Edge[] = [
      { id: "e_ctx", source: "STATE", target: "CONTEXT" },
      { id: "e_far", source: "STATE", target: "FAR" },
    ];
    expect(clusterLane("e_ctx", "STATE", null, "source", wide, nlWide, deg(12)).size).toBe(1);
  });
});

describe("laneOffsetFor: the near-collinear regression (STATE→CONTEXT / STATE→LOSS)", () => {
  // Two edges leaving the SAME source only ~5° apart, to targets at different
  // distances (so their midpoints are far apart and proximity would miss them).
  const nl = new Map<string, unknown>([
    ["STATE", node(0, 0)],
    ["CONTEXT", at(0, 0, -40, 600)],
    ["LOSS", at(0, 0, -35, 700)],
  ]);
  const edges: Edge[] = [
    { id: "e_ctx", source: "STATE", target: "CONTEXT" },
    { id: "e_loss", source: "STATE", target: "LOSS" },
  ];

  it("gives near-collinear shared-hub edges opposite, nonzero bows (they diverge, never join)", () => {
    const ctx = laneOffsetFor("e_ctx", "STATE", null, "CONTEXT", null, edges, nl);
    const loss = laneOffsetFor("e_loss", "STATE", null, "LOSS", null, edges, nl);
    expect(ctx.hub).toBe("source");
    expect(loss.hub).toBe("source");
    // both bowed, and in OPPOSITE directions so the pair splays apart
    expect(ctx.bowOffset).not.toBe(0);
    expect(loss.bowOffset).not.toBe(0);
    expect(Math.sign(ctx.bowOffset)).toBe(-Math.sign(loss.bowOffset));
    // adjacent lane-mates are exactly one lane gap apart in bow offset
    expect(Math.abs(ctx.bowOffset - loss.bowOffset)).toBeCloseTo(LANE_GAP_PX, 6);
    // hub spread also opposite (launch points split too)
    expect(Math.sign(ctx.hubOffset)).toBe(-Math.sign(loss.hubOffset));
  });

  it("respects a custom lane gap", () => {
    const ctx = laneOffsetFor("e_ctx", "STATE", null, "CONTEXT", null, edges, nl, 30);
    const loss = laneOffsetFor("e_loss", "STATE", null, "LOSS", null, edges, nl, 30);
    expect(Math.abs(ctx.bowOffset - loss.bowOffset)).toBeCloseTo(30, 6);
  });
});

describe("laneOffsetFor: divergent fan-outs get a hub spread but NO bow", () => {
  // Two shared-source edges 16° apart: inside the 20° hub-spread cluster but
  // outside the 12° tight bow angle → spread launch points, no spurious kink.
  const nl = new Map<string, unknown>([
    ["STATE", node(0, 0)],
    ["A", at(0, 0, -40, 600)],
    ["B", at(0, 0, -24, 600)],
  ]);
  const edges: Edge[] = [
    { id: "e_a", source: "STATE", target: "A" },
    { id: "e_b", source: "STATE", target: "B" },
  ];

  it("hub spread nonzero, bow zero", () => {
    const a = laneOffsetFor("e_a", "STATE", null, "A", null, edges, nl);
    const b = laneOffsetFor("e_b", "STATE", null, "B", null, edges, nl);
    expect(a.hub).toBe("source");
    expect(a.hubOffset).not.toBe(0);
    expect(b.hubOffset).not.toBe(0);
    expect(a.bowOffset).toBe(0);
    expect(b.bowOffset).toBe(0);
  });
});

describe("laneOffsetFor: fully independent edges are left untouched", () => {
  // Two edges >20° apart sharing a source: neither clusters → no offsets at all.
  const nl = new Map<string, unknown>([
    ["STATE", node(0, 0)],
    ["UP", at(0, 0, -90, 600)],
    ["RIGHT", at(0, 0, 0, 600)],
  ]);
  const edges: Edge[] = [
    { id: "e_up", source: "STATE", target: "UP" },
    { id: "e_right", source: "STATE", target: "RIGHT" },
  ];

  it("no hub, no offsets", () => {
    const up = laneOffsetFor("e_up", "STATE", null, "UP", null, edges, nl);
    expect(up.hub).toBeNull();
    expect(up.hubOffset).toBe(0);
    expect(up.bowOffset).toBe(0);
  });
});

describe("proximityLane: independent near-parallel edges that run close", () => {
  // Two edges sharing NO endpoint, both pointing right, midpoints 30px apart.
  const nl = new Map<string, unknown>([
    ["A", node(0, 0)],
    ["B", node(200, 0)],
    ["C", node(0, 30)],
    ["D", node(200, 30)],
  ]);
  const edges: Edge[] = [
    { id: "ab", source: "A", target: "B" },
    { id: "cd", source: "C", target: "D" },
  ];

  it("groups them into a 2-lane bundle with distinct indices", () => {
    const ab = proximityLane("ab", "A", "B", edges, nl);
    const cd = proximityLane("cd", "C", "D", edges, nl);
    expect(ab.size).toBe(2);
    expect(cd.size).toBe(2);
    expect(ab.index).not.toBe(cd.index);
  });

  it("does not group edges that are far apart", () => {
    const nlFar = new Map<string, unknown>([
      ["A", node(0, 0)],
      ["B", node(200, 0)],
      ["C", node(0, 500)], // 500px away, well past the proximity threshold
      ["D", node(200, 500)],
    ]);
    expect(proximityLane("ab", "A", "B", edges, nlFar).size).toBe(1);
  });
});
