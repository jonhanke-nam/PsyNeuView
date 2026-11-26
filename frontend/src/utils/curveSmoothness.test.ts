import { describe, expect, it } from "vitest";
import { resample, samplePath, sharpestTurn, smoothness } from "./curveSmoothness";

const line = (d: string) => resample(samplePath(d), 2);

describe("sharpestTurn", () => {
  it("sees a spike", () => {
    expect(sharpestTurn("M 0 0 C 0 50 0 100 0 100 C 0 100 0 50 0 0")).toBeGreaterThan(170);
  });
});

describe("smoothness (#416)", () => {
  it("a straight line and a single bend have no change of direction", () => {
    expect(smoothness(line("M 0 0 C 100 0 200 0 300 0"))).toEqual({ changes: 0, wiggles: 0, ripple: 0, hooks: 0 });
    expect(smoothness(line("M 0 0 C 200 0 300 100 300 300")).changes).toBe(0);
  });

  it("an S is one change of direction, and not a wiggle", () => {
    const s = smoothness(line("M 0 0 C 200 0 100 300 300 300"));
    expect(s.changes).toBe(1);
    expect(s.wiggles).toBe(0);
  });

  it("sees a short bump between two changes of direction as a wiggle", () => {
    const d = "M 0 0 C 50 0 100 0 150 0 C 165 0 175 12 190 12 C 205 12 215 0 230 0 C 280 0 330 0 380 0";
    const s = smoothness(line(d));
    expect(s.wiggles).toBe(1);
    expect(s.ripple).toBeGreaterThan(5);
  });

  it("sees a hairpin as a hook", () => {
    const s = smoothness(line("M 0 0 C 33 0 66 0 100 0 C 130 0 130 -30 100 -30 C 66 -30 33 -30 0 -30"));
    expect(s.hooks).toBeGreaterThan(0);
  });
});
