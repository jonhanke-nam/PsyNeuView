import { describe, it, expect } from "vitest";
import { NODE_MIN_HEIGHT, NODE_MIN_WIDTH, nameLineWidth, outlineThickness, ovalBoxFor } from "./nodeBox";

/** Whether the corners of a name's box lie inside an oval this size, inset by the outline. */
const fits = (name: string, outline: number) => {
  const box = ovalBoxFor(name, outline);
  const rx = box.width / 2 - outline, ry = box.height / 2 - outline;
  return (nameLineWidth(name) / 2 / rx) ** 2 + (17 / 2 / ry) ** 2 <= 1;
};

describe("a node's oval (#210)", () => {
  it("is never smaller than Graphviz's least oval", () => {
    expect(ovalBoxFor("")).toEqual({ width: NODE_MIN_WIDTH, height: NODE_MIN_HEIGHT });
    expect(ovalBoxFor("A")).toEqual({ width: NODE_MIN_WIDTH, height: NODE_MIN_HEIGHT });
  });

  it("grows with the name", () => {
    expect(ovalBoxFor("PREVIOUS STATE [WEIGHTED SCORES]").width).toBeGreaterThan(ovalBoxFor("STATE").width);
    expect(ovalBoxFor("two\nlines").height).toBeGreaterThan(ovalBoxFor("one line").height);
  });

  it("holds the name inside the outline at every width, single or double", () => {
    for (const name of ["A", "STATE", "RESPONSE_LAYER", "PREVIOUS STATE [WEIGHTED SCORES]"]) {
      for (let width = 1; width <= 10; width++) {
        for (const double of [false, true]) {
          expect(fits(name, outlineThickness(double, width)), `${name}, ${width}px, double ${double}`).toBe(true);
        }
      }
    }
  });
});
