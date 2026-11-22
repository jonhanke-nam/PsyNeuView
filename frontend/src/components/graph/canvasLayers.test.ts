import { describe, expect, it } from "vitest";
import { inNodeLayer, nodeLayer, NODE_LAYER_Z } from "./canvasLayers";

// React Flow's highest arrow level: a selected arrow (+1000) to a selected
// node (+1000) nested a few frames deep.
const HIGHEST_ARROW_Z = 1000 + 1000 + 10;

describe("canvas layers (#250)", () => {
  it("puts every node other than an open frame above every arrow", () => {
    for (const type of ["mechanismNode", "cimNode", "danglingNode"]) {
      expect(nodeLayer({ type, selected: false })!).toBeGreaterThan(HIGHEST_ARROW_Z);
    }
  });
  it("keeps a selected node on top of the others", () => {
    expect(nodeLayer({ type: "mechanismNode", selected: true })).toBe(NODE_LAYER_Z + 1);
  });
  it("leaves an open frame at React Flow's level, under the arrows entering it", () => {
    const frame = { id: "f", type: "compositionNode", position: { x: 0, y: 0 }, data: {}, style: { width: 280, zIndex: 0 } };
    expect(nodeLayer(frame)).toBeUndefined();
    expect(inNodeLayer(frame)).toBe(frame);
  });
  it("keeps the rest of a node's drawn style", () => {
    const n = inNodeLayer({ id: "a", type: "mechanismNode", position: { x: 0, y: 0 }, data: {}, style: { width: 40 } });
    expect(n.style).toEqual({ width: 40, zIndex: NODE_LAYER_Z });
  });
});
