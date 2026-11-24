import { describe, it, expect } from "vitest";
import { EXPANDED_CLEARANCE, NODE_MIN_HEIGHT, NODE_MIN_WIDTH, expandedBoxFor, nameLineWidth, outlineThickness, ovalBoxFor } from "./nodeBox";

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

describe("an expanded node's box (#333)", () => {
  const K = Math.tan(Math.PI / 8);
  // How far round the shape a point is: 1 on the outline's inside edge.
  const reach = (shape: string, x: number, y: number) =>
    shape === "rectangle" ? Math.max(x, y)
    : shape === "octagon" || shape === "doubleoctagon" ? Math.max(x, y, (x + y) / (1 + K))
    : Math.hypot(x, y);

  it("holds the text's corners inside the outline, clear of it, for every shape", () => {
    for (const shape of ["oval", "doublecircle", "octagon", "doubleoctagon", "rectangle"]) {
      for (const content of [{ width: 60, height: 120 }, { width: 240, height: 140 }, { width: 330, height: 260 }]) {
        for (const outline of [1, 4, outlineThickness(true, 4)]) {
          const box = expandedBoxFor(content, shape, outline);
          const a = box.width / 2 - outline, b = box.height / 2 - outline;
          const corner = reach(shape, content.width / 2 / a, content.height / 2 / b);
          expect(corner, `${shape} ${content.width}×${content.height}, outline ${outline}`).toBeLessThan(1);
          // ...and with the clear space to spare along each axis.
          expect(a - content.width / 2).toBeGreaterThanOrEqual(EXPANDED_CLEARANCE);
          expect(b - content.height / 2).toBeGreaterThanOrEqual(EXPANDED_CLEARANCE);
        }
      }
    }
  });

  it("is no bigger than the shape needs: √2 for a round or cut shape, nothing for a rectangle", () => {
    const content = { width: 200, height: 100 };
    expect(expandedBoxFor(content, "oval", 0).width).toBe(Math.ceil(208 * Math.SQRT2));
    expect(expandedBoxFor(content, "rectangle", 2)).toEqual({ width: 212, height: 112 });
  });
});
