import { describe, expect, it } from "vitest";
import { selfLoopGeometry, selfLoopSide } from "./selfLoop";

// #425: a node's projection to itself is a loop on the node.
const oval = { cx: 100, cy: 100, a: 40, b: 40 };

describe("a self-loop", () => {
  it("goes on the right, as Graphviz puts it, when nothing else is there", () => {
    expect(selfLoopSide(oval, [])).toBe(0);
    // Arrows above and below (a bottom-to-top layout): the right is free.
    expect(selfLoopSide(oval, [{ x: 100, y: 0 }, { x: 100, y: 200 }])).toBe(0);
  });

  it("stays on the right when the nearest arrow there is clear of it (Gilzenrat's RESPONSE)", () => {
    // LC's control projection comes in 60° below the right.
    expect(selfLoopSide(oval, [{ x: 100, y: 300 }, { x: 100 + 100, y: 100 + 173 }])).toBe(0);
  });

  it("moves off the right when another arrow leaves there", () => {
    expect(selfLoopSide(oval, [{ x: 300, y: 100 }])).toBe(Math.PI);
    // Gilzenrat's DECISION LAYER: an arrow up and to the right, others above and below: the left.
    expect(selfLoopSide(oval, [{ x: 300, y: 10 }, { x: 100, y: -200 }, { x: 100, y: 300 }])).toBe(Math.PI);
    // Left and right both taken (a left-to-right layout): below.
    expect(selfLoopSide(oval, [{ x: 300, y: 100 }, { x: -100, y: 100 }])).toBe(Math.PI / 2);
  });

  it("leaves and comes back at two different points on the outline, and reaches out from the node", () => {
    const loop = selfLoopGeometry(oval, 0);
    expect(Math.hypot(loop.start.x - loop.end.x, loop.start.y - loop.end.y)).toBeGreaterThan(20);
    for (const p of [loop.start, loop.end]) {
      expect(Math.hypot(p.x - oval.cx, p.y - oval.cy)).toBeCloseTo(40, 5);
      expect(p.x).toBeGreaterThan(oval.cx);
    }
    expect(loop.apex.x).toBeGreaterThan(oval.cx + oval.a + 20);
    expect(loop.path.startsWith(`M ${loop.start.x} ${loop.start.y} C`)).toBe(true);
  });

  it("ends on the node's drawn outline", () => {
    const loop = selfLoopGeometry(oval, Math.PI, (p) => ({ x: p.x - 5, y: p.y }));
    expect(loop.start.x).toBeLessThan(oval.cx - oval.a + 1);
  });
});
