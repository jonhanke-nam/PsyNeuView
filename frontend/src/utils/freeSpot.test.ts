/** A node placed from the keyboard goes to the nearest spot that covers nothing (#411). */
import { describe, expect, it } from "vitest";
import { besideGraph, boundsOf, isFree, nearestFreeCentre } from "./freeSpot";

const size = { width: 100, height: 40 };

describe("the nearest free spot (#411)", () => {
  it("is the point itself when nothing is there", () => {
    expect(nearestFreeCentre({ x: 10, y: 20 }, size, [])).toEqual({ x: 10, y: 20 });
    expect(nearestFreeCentre({ x: 10, y: 20 }, size, [{ x: 500, y: 500, w: 50, h: 50 }])).toEqual({ x: 10, y: 20 });
  });

  it("moves clear of a node that covers the point, by the shortest way", () => {
    // A wide, short node over the point: up or down is nearer than sideways.
    const taken = [{ x: -200, y: -20, w: 400, h: 40 }];
    const p = nearestFreeCentre({ x: 0, y: 0 }, size, taken, { gap: 10 });
    expect(isFree(p, size, taken, 10)).toBe(true);
    expect(p.x).toBe(0);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(80);
  });

  it("never lands on any of several nodes, keeping the gap", () => {
    const taken = [
      { x: -60, y: -30, w: 120, h: 60 },
      { x: 70, y: -30, w: 120, h: 60 },
      { x: -60, y: 40, w: 120, h: 60 },
      { x: -200, y: -30, w: 120, h: 60 },
    ];
    const p = nearestFreeCentre({ x: 0, y: 0 }, size, taken, { gap: 24 });
    expect(isFree(p, size, taken, 24)).toBe(true);
    expect(isFree({ x: 0, y: 0 }, size, taken, 24)).toBe(false);
  });

  it("finds the nearest free spot, not just any", () => {
    // Only to the right is open nearby; far to the left is open too.
    const taken = [{ x: -1000, y: -1000, w: 1000 + 30, h: 2000 }];
    const p = nearestFreeCentre({ x: 0, y: 0 }, size, taken, { gap: 0 });
    expect(p.y).toBe(0);
    expect(p.x).toBe(80); // 30 + half the width, on the 20px grid
  });
});

describe("beside the graph, with nothing selected (#411)", () => {
  // Two nodes with a gap between them: the gap is never chosen.
  const graph = [
    { x: 0, y: 0, w: 100, h: 40 },
    { x: 0, y: 200, w: 100, h: 40 },
  ];
  const outside = (p: { x: number; y: number }) =>
    p.x - size.width / 2 >= 100 || p.x + size.width / 2 <= 0 || p.y - size.height / 2 >= 240 || p.y + size.height / 2 <= 0;

  it("goes just right of the graph, centred on it, when that is showing", () => {
    const p = besideGraph(graph, size, { x: -500, y: -500, w: 2000, h: 2000 }, 24);
    expect(p).toEqual({ x: 100 + 24 + 50, y: 120 });
    expect(outside(p)).toBe(true);
    expect(boundsOf(graph)).toEqual({ x: 0, y: 0, w: 100, h: 240 });
  });

  it("goes below when the right is off-screen, then left", () => {
    expect(besideGraph(graph, size, { x: -500, y: -100, w: 600, h: 1000 }, 24)).toEqual({ x: 50, y: 240 + 24 + 20 });
    expect(besideGraph(graph, size, { x: -500, y: -100, w: 600, h: 345 }, 24)).toEqual({ x: -24 - 50, y: 120 });
  });

  it("falls back to the right (to be brought into view) when none is showing", () => {
    expect(besideGraph(graph, size, { x: 10, y: 10, w: 20, h: 20 }, 24)).toEqual({ x: 174, y: 120 });
  });

  it("is the middle of the view with no graph", () => {
    expect(besideGraph([], size, { x: 0, y: 0, w: 400, h: 200 })).toEqual({ x: 200, y: 100 });
  });
});
