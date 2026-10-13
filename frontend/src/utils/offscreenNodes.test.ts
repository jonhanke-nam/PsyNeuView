import { describe, expect, it } from "vitest";

import { offscreenNodeIds, type CanvasViewport, type NodeBox } from "./offscreenNodes";

const box = (id: string, x: number, y: number): NodeBox => ({ id, x, y, width: 100, height: 40 });

/** Untransformed 800x600 canvas. */
const view = (over: Partial<CanvasViewport> = {}): CanvasViewport => ({
  transform: [0, 0, 1],
  width: 800,
  height: 600,
  ...over,
});

describe("offscreenNodeIds", () => {
  it("reports nothing when every node is in view", () => {
    expect(offscreenNodeIds([box("a", 10, 10), box("b", 400, 300)], view())).toEqual([]);
  });

  /**
   * The bug this exists to prevent (#1183): the results panel grows, the canvas
   * gets shorter, and a node that was visible silently leaves. Same nodes, same
   * transform — only the height changed.
   */
  it("notices a node that left because the canvas got shorter", () => {
    const nodes = [box("color_input", 10, 10), box("color_hidden", 10, 520)];
    expect(offscreenNodeIds(nodes, view())).toEqual([]);
    expect(offscreenNodeIds(nodes, view({ height: 300 }))).toEqual(["color_hidden"]);
  });

  it("does not report a node that is only partly visible", () => {
    // Bottom half clipped: still something to see, so not "off-screen".
    expect(offscreenNodeIds([box("a", 10, 580)], view())).toEqual([]);
  });

  it("counts a node flush against the edge as gone", () => {
    // Right edge lands exactly on x=0 — zero visible pixels.
    expect(offscreenNodeIds([box("a", -100, 10)], view())).toEqual(["a"]);
  });

  it("accounts for pan", () => {
    const nodes = [box("a", 10, 10)];
    expect(offscreenNodeIds(nodes, view())).toEqual([]);
    expect(offscreenNodeIds(nodes, view({ transform: [-900, 0, 1] }))).toEqual(["a"]);
  });

  it("accounts for zoom", () => {
    // At 1x this sits inside the canvas; at 4x it is pushed off the right edge.
    const nodes = [box("a", 300, 10)];
    expect(offscreenNodeIds(nodes, view())).toEqual([]);
    expect(offscreenNodeIds(nodes, view({ transform: [0, 0, 4] }))).toEqual(["a"]);
  });

  it("stays quiet before the container has been measured", () => {
    // Every node is outside a 0x0 viewport; saying so during load is noise.
    expect(offscreenNodeIds([box("a", 10, 10)], view({ width: 0, height: 0 }))).toEqual([]);
  });

  it("handles an unmeasured node as a point", () => {
    const unmeasured: NodeBox = { id: "a", x: 900, y: 10, width: 0, height: 0 };
    expect(offscreenNodeIds([unmeasured], view())).toEqual(["a"]);
  });

  it("preserves input order so the caller can report stable ids", () => {
    const nodes = [box("z", -500, 10), box("a", -500, 100)];
    expect(offscreenNodeIds(nodes, view())).toEqual(["z", "a"]);
  });
});
