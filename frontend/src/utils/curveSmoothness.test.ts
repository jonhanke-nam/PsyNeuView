import { describe, expect, it } from "vitest";
import { curvePath } from "./showGraphLayout";
import { sharpestTurn } from "./curveSmoothness";

// The #63 shape: a course round the left of the graph, thinned out as
// `simplify` leaves it — closely spaced points at both bends, a long
// straight run between them.
const ROUND_THE_LEFT = [
  { x: 900, y: 40 }, { x: 600, y: 90 }, { x: 300, y: 170 }, { x: 120, y: 250 },
  { x: 40, y: 330 }, { x: 22, y: 360 }, { x: 20, y: 380 },
  { x: 20, y: 1200 },
  { x: 22, y: 1220 }, { x: 40, y: 1250 }, { x: 120, y: 1330 }, { x: 300, y: 1400 }, { x: 900, y: 1450 },
];

describe("curvePath draws without spikes (#63)", () => {
  it("a long straight run between close bends stays smooth", () => {
    expect(sharpestTurn(curvePath(ROUND_THE_LEFT))).toBeLessThan(45);
  });

  it("passes through every point it was given", () => {
    const d = curvePath(ROUND_THE_LEFT);
    for (const p of ROUND_THE_LEFT.slice(1)) expect(d).toContain(`${p.x} ${p.y}`);
  });

  it("a straight line stays straight", () => {
    expect(sharpestTurn(curvePath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 400, y: 0 }]))).toBeLessThan(1);
  });

  it("repeated points don't break it", () => {
    const d = curvePath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 50 }, { x: 200, y: 0 }]);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});

describe("sharpestTurn", () => {
  it("sees a spike", () => {
    expect(sharpestTurn("M 0 0 C 0 50 0 100 0 100 C 0 100 0 50 0 0")).toBeGreaterThan(170);
  });
});
