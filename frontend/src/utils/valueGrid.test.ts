import { describe, expect, it } from "vitest";

import {
  cellColour,
  formatGridNumber,
  gridScale,
  inferGridShape,
  numericVector,
  scaleEnds,
  shadeOf,
} from "./valueGrid";

describe("inferGridShape (#1387)", () => {
  it("draws a perfect square as its square root", () => {
    expect(inferGridShape(25)).toEqual({ rows: 5, cols: 5, from: "square" });
    expect(inferGridShape(4)).toEqual({ rows: 2, cols: 2, from: "square" });
  });

  it("uses a declared 2-D shape over the square root", () => {
    expect(inferGridShape(12, [3, 4])).toEqual({ rows: 3, cols: 4, from: "declared" });
    expect(inferGridShape(25, [1, 5, 5])).toEqual({ rows: 5, cols: 5, from: "declared" });
  });

  it("treats a shape with leading 1s as the 1-D size it is", () => {
    expect(inferGridShape(25, [1, 25])).toEqual({ rows: 5, cols: 5, from: "square" });
    expect(inferGridShape(25, [25])).toEqual({ rows: 5, cols: 5, from: "square" });
  });

  it("ignores a declared shape that doesn't match the size", () => {
    expect(inferGridShape(25, [3, 4])).toEqual({ rows: 5, cols: 5, from: "square" });
  });

  it("lets the user's width win, with a short last row when it doesn't divide", () => {
    expect(inferGridShape(25, [5, 5], 10)).toEqual({ rows: 3, cols: 10, from: "width" });
    expect(inferGridShape(25, null, 25)).toEqual({ rows: 1, cols: 25, from: "width" });
  });

  it("ignores a width out of range", () => {
    expect(inferGridShape(25, null, 0)?.from).toBe("square");
    expect(inferGridShape(25, null, 26)?.from).toBe("square");
    expect(inferGridShape(25, null, 2.5)?.from).toBe("square");
  });

  it("falls back to the smallest square that holds a size with no shape", () => {
    expect(inferGridShape(10)).toEqual({ rows: 3, cols: 4, from: "fallback" });
    expect(inferGridShape(26)).toEqual({ rows: 5, cols: 6, from: "fallback" });
  });

  it("has no grid for nothing", () => {
    expect(inferGridShape(0)).toBeNull();
  });
});

describe("numericVector", () => {
  it("peels PsyNeuLink's wrapping of a one-port value", () => {
    expect(numericVector([[1, -1, 1, -1]])).toEqual({ values: [1, -1, 1, -1] });
    expect(numericVector([[[0.5, 0.25]]])).toEqual({ values: [0.5, 0.25] });
  });

  it("keeps a 2-D value's shape", () => {
    expect(numericVector([[1, 2], [3, 4], [5, 6]])).toEqual({ values: [1, 2, 3, 4, 5, 6], shape: [3, 2] });
  });

  it("reads numpy's repr", () => {
    expect(numericVector("[[ 1. -1.  0.5]]")).toEqual({ values: [1, -1, 0.5] });
  });

  it("is null for what isn't numbers", () => {
    expect(numericVector({ a: 1 })).toBeNull();
    expect(numericVector([])).toBeNull();
    expect(numericVector([[1, 2], [3]])).toBeNull();
    expect(numericVector(["a", "b"])).toBeNull();
  });
});

describe("value to shade", () => {
  it("runs from 0 (light) to the largest (dark) when nothing is negative", () => {
    const scale = gridScale([0, 0.25, 1]);
    expect(scale).toEqual({ kind: "sequential", min: 0, max: 1 });
    expect(shadeOf(0, scale)).toBe(0);
    expect(shadeOf(0.25, scale)).toBe(0.25);
    expect(shadeOf(1, scale)).toBe(1);
    expect(cellColour(0, scale)).toBe("var(--pnv-grid-low)");
    expect(cellColour(1, scale)).toBe("var(--pnv-grid-high)");
    expect(cellColour(0.25, scale)).toBe("color-mix(in srgb, var(--pnv-grid-high) 25%, var(--pnv-grid-low))");
  });

  it("centres on 0 when values go negative: Hopfield's +1 dark, -1 light", () => {
    const scale = gridScale([1, -1, 1, 0]);
    expect(scale).toEqual({ kind: "diverging", max: 1 });
    expect(shadeOf(1, scale)).toBe(1);
    expect(shadeOf(-1, scale)).toBe(-1);
    expect(shadeOf(0, scale)).toBe(0);
    expect(cellColour(1, scale)).toBe("var(--pnv-grid-high)");
    expect(cellColour(-1, scale)).toBe("var(--pnv-grid-neg)");
    expect(cellColour(0, scale)).toBe("var(--pnv-grid-mid)");
    expect(cellColour(-0.5, scale)).toBe("color-mix(in srgb, var(--pnv-grid-neg) 50%, var(--pnv-grid-mid))");
  });

  it("makes a diverging scale symmetric about 0", () => {
    expect(gridScale([-0.5, 2])).toEqual({ kind: "diverging", max: 2 });
    expect(shadeOf(-0.5, gridScale([-0.5, 2]))).toBe(-0.25);
    expect(scaleEnds({ kind: "diverging", max: 2 })).toEqual({ low: -2, mid: 0, high: 2 });
  });

  it("clamps values outside the scale and ignores non-numbers", () => {
    const scale = gridScale([0, 1, NaN]);
    expect(scale).toEqual({ kind: "sequential", min: 0, max: 1 });
    expect(shadeOf(3, scale)).toBe(1);
    expect(cellColour(NaN, scale)).toBe("var(--pnv-surface)");
  });

  it("copes with all zeros", () => {
    const scale = gridScale([0, 0]);
    expect(scale).toEqual({ kind: "sequential", min: 0, max: 1 });
    expect(cellColour(0, scale)).toBe("var(--pnv-grid-low)");
  });

  it("formats numbers short, without -0", () => {
    expect(formatGridNumber(-0)).toBe("0");
    expect(formatGridNumber(0.123456)).toBe("0.1235");
    expect(formatGridNumber(-1)).toBe("-1");
  });
});
