import { describe, expect, it } from "vitest";
import { boundsWithPoints } from "./useFitGraph";

describe("boundsWithPoints (#52)", () => {
  const rect = { x: 0, y: 0, width: 100, height: 50 };

  it("keeps the nodes' box when there are no curves", () => {
    expect(boundsWithPoints(rect, [])).toEqual(rect);
  });

  it("grows to take in a curve that swings outside the nodes", () => {
    expect(boundsWithPoints(rect, [{ x: -40, y: 10 }, { x: 50, y: 80 }])).toEqual({
      x: -40,
      y: 0,
      width: 140,
      height: 80,
    });
  });
});
