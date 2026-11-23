import { describe, expect, it } from "vitest";
import { placeInWindow } from "./useMenuInWindow";

// A 160×120 menu in a 1000×700 window (#109).
describe("placeInWindow", () => {
  it("opens at the pointer when it fits", () => {
    expect(placeInWindow(100, 100, 160, 120, 1000, 700)).toEqual({ left: 100, top: 100 });
  });
  it("opens upward from the pointer near the bottom edge", () => {
    expect(placeInWindow(100, 650, 160, 120, 1000, 700)).toEqual({ left: 100, top: 530 });
  });
  it("opens to the left of the pointer near the right edge", () => {
    expect(placeInWindow(950, 100, 160, 120, 1000, 700)).toEqual({ left: 790, top: 100 });
  });
  it("stays inside a window too short for it to open upward", () => {
    expect(placeInWindow(100, 60, 160, 120, 1000, 100).top).toBe(4);
  });
  it("never leaves the bottom edge even when the space above is short", () => {
    const { top } = placeInWindow(100, 90, 160, 120, 1000, 200);
    expect(top + 120).toBeLessThanOrEqual(196);
    expect(top).toBeGreaterThanOrEqual(4);
  });
});
