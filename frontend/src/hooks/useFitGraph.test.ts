import { describe, expect, it } from "vitest";
import { boundsWithPoints, fitViewport } from "./useFitGraph";

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

describe("fitViewport (#54)", () => {
  /** Where `b` lands on screen under viewport `v`. */
  const onScreen = (b: { x: number; y: number; width: number; height: number }, v: { x: number; y: number; zoom: number }) => ({
    left: b.x * v.zoom + v.x,
    top: b.y * v.zoom + v.y,
    right: (b.x + b.width) * v.zoom + v.x,
    bottom: (b.y + b.height) * v.zoom + v.y,
  });

  it("a wide graph fills the width, less the margin, and is centred", () => {
    const b = { x: 100, y: -50, width: 2000, height: 500 };
    const v = fitViewport(b, 1300, 944, { margin: 24 });
    const s = onScreen(b, v);
    expect(s.left).toBeCloseTo(24);
    expect(1300 - s.right).toBeCloseTo(24);
    // The vertical margins are just what's left, split evenly.
    expect(s.top).toBeCloseTo(944 - s.bottom);
    expect(s.top).toBeGreaterThan(24);
  });

  it("a tall graph fills the height, less the margin, and is centred", () => {
    const b = { x: 0, y: 0, width: 300, height: 1200 };
    const v = fitViewport(b, 1300, 944, { margin: 24 });
    const s = onScreen(b, v);
    expect(s.top).toBeCloseTo(24);
    expect(944 - s.bottom).toBeCloseTo(24);
    expect(s.left).toBeCloseTo(1300 - s.right);
  });

  it("keeps the zoom within the canvas's limits", () => {
    const tiny = { x: 0, y: 0, width: 10, height: 10 };
    expect(fitViewport(tiny, 1000, 800, { maxZoom: 2 }).zoom).toBe(2);
    const huge = { x: 0, y: 0, width: 1e6, height: 1e6 };
    expect(fitViewport(huge, 1000, 800, { minZoom: 0.02 }).zoom).toBe(0.02);
  });

  it("shrinks the margin on a very small canvas", () => {
    const b = { x: 0, y: 0, width: 100, height: 10 };
    const v = fitViewport(b, 100, 100, { margin: 24 });
    const s = onScreen(b, v);
    expect(s.left).toBeCloseTo(10);
    expect(100 - s.right).toBeCloseTo(10);
  });

  it("copes with a graph with no width or height", () => {
    const v = fitViewport({ x: 5, y: 5, width: 0, height: 0 }, 800, 600);
    expect(v).toEqual({ x: 395, y: 295, zoom: 1 });
  });
});
