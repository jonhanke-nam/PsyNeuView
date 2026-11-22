import { describe, expect, it } from "vitest";
import {
  LEGACY_TENSION, SOFT_TENSION, anchorHandles, handlePath, handleTip, hasPinnedHandles, pinFromDrag,
} from "./curveHandles";
import { renderStyledPath } from "./edgeRouter";

const pts = [{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 0 }];

/** The numbers in an SVG path, in order. */
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);

describe("curve handles (#39)", () => {
  it("unpinned handles draw the same curve the spline renderer draws", () => {
    for (const t of [LEGACY_TENSION, SOFT_TENSION]) {
      expect(nums(handlePath(pts, t))).toEqual(nums(renderStyledPath(pts, "spline", t)));
    }
  });

  it("the softer default reaches further than the old tension", () => {
    expect(SOFT_TENSION).toBeGreaterThan(LEGACY_TENSION);
    const soft = anchorHandles(pts, SOFT_TENSION)[1].out!;
    const old = anchorHandles(pts, LEGACY_TENSION)[1].out!;
    expect(Math.hypot(soft.x, soft.y)).toBeGreaterThan(Math.hypot(old.x, old.y));
  });

  it("renders the spline style with the softer tension by default", () => {
    expect(renderStyledPath(pts, "spline")).toBe(renderStyledPath(pts, "spline", SOFT_TENSION));
    expect(renderStyledPath(pts, "spline")).not.toBe(renderStyledPath(pts, "spline", LEGACY_TENSION));
  });

  it("a bend's handles stay in line: the in handle is the out handle reversed", () => {
    const hs = anchorHandles([pts[0], { ...pts[1], h: { x: 30, y: -10 } }, pts[2]], 1);
    expect(hs[1].out).toEqual({ x: 30, y: -10 });
    expect(hs[1].in).toEqual({ x: -30, y: 10 });
    expect(hs[0].in).toBeNull();
    expect(hs[2].out).toBeNull();
  });

  it("pinned handles are the control points of the curve", () => {
    const d = handlePath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 1, { s: { x: 10, y: 40 }, t: { x: -20, y: 50 } });
    expect(nums(d)).toEqual([0, 0, 10, 40, 80, 50, 100, 0]);
  });

  it("a pinned handle moves with its anchor", () => {
    const a = handlePath([pts[0], { ...pts[1], h: { x: 30, y: 0 } }, pts[2]], 1);
    const b = handlePath([pts[0], { x: 110, y: 70, h: { x: 30, y: 0 } }, pts[2]], 1);
    // Segment 1's first control is anchor + h either way.
    expect(nums(a).slice(8, 10)).toEqual([130, 60]);
    expect(nums(b).slice(8, 10)).toEqual([140, 70]);
  });

  it("knows when an arrow has pinned handles", () => {
    expect(hasPinnedHandles(undefined, undefined)).toBe(false);
    expect(hasPinnedHandles([{ x: 1, y: 2 }], {})).toBe(false);
    expect(hasPinnedHandles([{ x: 1, y: 2, h: { x: 0, y: 1 } }], undefined)).toBe(true);
    expect(hasPinnedHandles(undefined, { t: { x: 1, y: 0 } })).toBe(true);
  });

  it("turns a handle drag into the offset to pin", () => {
    expect(pinFromDrag(pts, 0, "out", { x: 5, y: 7 })).toEqual({ end: "s", h: { x: 5, y: 7 } });
    expect(pinFromDrag(pts, 2, "in", { x: 190, y: 20 })).toEqual({ end: "t", h: { x: -10, y: 20 } });
    expect(pinFromDrag(pts, 1, "out", { x: 130, y: 60 })).toEqual({ bend: 0, h: { x: 30, y: 0 } });
    // Dragging the in handle pins the reverse as the out handle.
    expect(pinFromDrag(pts, 1, "in", { x: 70, y: 60 })).toEqual({ bend: 0, h: { x: 30, y: -0 } });
  });

  it("draws a short handle far enough out to grab", () => {
    expect(handleTip({ x: 0, y: 0 }, { x: 3, y: 4 }, 10)).toEqual({ x: 6, y: 8 });
    expect(handleTip({ x: 0, y: 0 }, { x: 30, y: 40 }, 10)).toEqual({ x: 30, y: 40 });
  });
});
