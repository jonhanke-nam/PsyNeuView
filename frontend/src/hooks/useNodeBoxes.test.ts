import { describe, expect, it } from "vitest";
import { nodeBoxesSignature } from "./useNodeBoxes";

const lookup = (x: number, width: number, selected = false) =>
  new Map([
    ["a", { type: "mechanismNode", selected, internals: { positionAbsolute: { x, y: 5 } }, measured: { width, height: 39 } }],
  ]);

describe("nodeBoxesSignature", () => {
  it("changes when a node moves or changes size", () => {
    const base = nodeBoxesSignature(lookup(0, 100));
    expect(nodeBoxesSignature(lookup(1, 100))).not.toBe(base);
    expect(nodeBoxesSignature(lookup(0, 101))).not.toBe(base);
  });

  it("stays the same for anything else, so edges don't re-render for it", () => {
    expect(nodeBoxesSignature(lookup(0, 100, true))).toBe(nodeBoxesSignature(lookup(0, 100)));
  });

  it("uses the place on the canvas, not the place inside a frame", () => {
    const inFrame = (x: number) => new Map([["a", { position: { x: 0, y: 0 }, internals: { positionAbsolute: { x, y: 0 } } }]]);
    expect(nodeBoxesSignature(inFrame(10))).not.toBe(nodeBoxesSignature(inFrame(20)));
  });
});
