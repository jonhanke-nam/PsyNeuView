/** A node placed from the keyboard goes to the nearest spot that covers nothing (#411). */
import { describe, expect, it } from "vitest";
import { isFree, nearestFreeCentre } from "./freeSpot";

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
